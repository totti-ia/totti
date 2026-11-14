/**
 * Interviewer: fala com o candidato por voz, numa pergunta do Totti (blip) ou numa fala livre dele.
 * Um turno por chamada. Erro do LLM nunca vira erro de API: volta uma fala de reserva.
 */
import { InterviewerOutput } from "@/lib/agents/interviewerSchema";
import { buildInterviewerSystem, buildInterviewerUser, candidatoPerguntou, type InterviewerTurnInput } from "@/lib/agents/prompts/interviewer";
import { recordOutcome, uncoveredCriteria } from "@/lib/agents/coverage";
import { empecilhoAnunciado, empecilhoDaQuestao, mudancaParaPrompt, mudancaPendente, testesIde } from "@/lib/agents/empecilho";
import { CONVERSA_LIVRE, conversasFeitas, faseDaEntrevista, formatarConversas, linesWrittenBeyondStarter } from "@/lib/agents/fase";
import { findBlipQuestion, nextHint, perdeuAVez } from "@/lib/agents/policy";
import { disseQueJaTerminou, disseQueTerminou, disseSoQueTerminou } from "@/lib/agents/conclusao";
import { checkReply } from "@/lib/agents/spoilerFilter";
import type { ChatMessage, ChatResponse, EditorCommand, LineRange } from "@/lib/contracts";
import { FALAS_DE_REPETICAO } from "@/lib/conversa/falasDeReserva";
import { completeJson } from "@/lib/llm";
import { registrarUsoLlm } from "./uso";
import {
  aplicarGuardas, emPortugues, ePerguntaDePorque, eSoReacao, escolherConvite, falaNaoRepetida, perguntaDePorque, reacaoAoPensar, reacaoNeutra,
  semConviteDeSeguir, semReacaoRepetida,
} from "@/lib/totti/guardas";
import {
  avisoDePerguntaSemResposta, avisosDeQueVaiOlhar, comRespostaDeReserva, decidirTurno, deSaidaDoLiveCoding, paraSaidaDoLiveCoding, pedePorque,
  type SituacaoDoTurno,
} from "@/lib/totti/turno";
import { appendEvent, latestCode, numberCode, sessionNow } from "@/lib/session/store";
import type { SessionState } from "@/lib/session/types";
import { getProblem } from "@/problems";
import { candidatasDoFechamento, candidatasDoPedidoDeFim } from "@/lib/agents/fechamento";
import { gatilhoDoFechamento, iniciarFechamento, limiarDoFechamentoNaIde, proximoPasso, type EstadoFechamento, type GatilhoDoFechamento } from "@/lib/totti/fechamento";
import type { LeituraDoTurno } from "@/lib/totti/turno";

/** Falha do LLM: pede para repetir. Varia para não soar como gravação quando acontece mais de uma vez. */
const FALLBACK_REPLIES = FALAS_DE_REPETICAO;
/** Fala barrada duas vezes pelo filtro: uma pergunta aberta que não entrega nada (e sem repetir a mesma frase).
 * Não fecha o assunto: o candidato ainda tem a vez. Sem validar e sem pedir para ele bolar testes. */
/** Fala barrada quando ele tinha feito uma pergunta: uma resposta que não entrega nada, e não outra pergunta
 * (devolver "o que você quer que esse trecho faça?" a quem perguntou soava como ignorar a pergunta). */
const SAFE_ANSWER_REPLIES = [
  "Essa eu deixo com você: vale olhar com calma o que cada variável guarda nesse ponto.",
  "Essa parte eu prefiro que você descubra no código, é justamente o que eu quero ver.",
  "Aí eu não vou entregar, mas você tem tudo o que precisa no código e nos testes.",
];
const SAFE_CLOSE_REPLIES = [
  "Certo. O que você quer que esse trecho faça?",
  "Entendi. Qual é o seu próximo passo agora?",
  "Saquei. Por que você escolheu esse caminho?",
];

/** Orçamento de um turno: o candidato está esperando a voz. Passou disso, sai a fala de reserva. */
const PRAZO_TURNO_MS = 7_000;
/** Cada geração tem no máximo isto; o filtro de fala, bem menos. */
const PRAZO_GERACAO_MS = 4_500;
const PRAZO_FILTRO_MS = 1_800;
/** Só gera de novo (fala barrada) se ainda couber uma geração e um filtro no orçamento. */
const MIN_PARA_REGERAR_MS = 3_000;

export { falaNaoRepetida };

/** O que o agente já falou: nesta conversa e nas falas gravadas da sessão. */
function falasDoAgente(session: SessionState, messages: ChatMessage[]): string[] {
  const gravadas = session.events.flatMap((e) => (e.type === "speech" && e.role === "agent" ? [e.text] : []));
  return [...gravadas, ...messages.filter((m) => m.role === "agent").map((m) => m.text)];
}

export async function runInterviewerTurn(
  session: SessionState,
  req: { blipId?: string; messages: ChatMessage[]; reconheceu?: boolean },
): Promise<ChatResponse> {
  const resposta = await turno(session, req);
  if (!resposta.reply) return resposta;
  // Toda fala que sai (a gerada, a pergunta preparada e as de reserva) passa pela trava comum da reação repetida:
  // não abre com outro reconhecimento depois do "uhum" da IDE nem repete o da fala anterior. E pelo português claro
  // (#130, item 14): o termo em inglês que a vaga não usa sai antes de a fala ir ao candidato.
  const semRepetir = semReacaoRepetida(resposta.reply, falasDoTottiNaConversa(req.messages), req.reconheceu === true) || resposta.reply;
  return { ...resposta, reply: emPortugues(semRepetir, session.config.jobDescription ?? "") };
}

/**
 * Começa o fechamento e devolve a primeira fala dele. Numa conversa aberta o fechamento segue nela, sem abrir outro
 * balão por cima (`fechamentoBlipId`). Com `etapa`, o fechamento começa já nessa etapa (pedido de fim com pergunta).
 */
function abrirFechamento(
  session: SessionState,
  req: { blipId?: string; messages: ChatMessage[] },
  inicio: { gatilho: GatilhoDoFechamento; perguntasNoPedidoDeFim?: boolean; etapa?: EstadoFechamento["etapa"] },
  leitura?: LeituraDoTurno,
  falaDoCandidato = "",
): ChatResponse {
  const t = elapsedMs(session);
  const tempoRestanteMs = Math.max(0, session.config.durationMin * 60_000 - t);
  const pedido = inicio.gatilho === "pediu_encerrar";
  const inicial = iniciarFechamento({
    sala: "codigo",
    gatilho: inicio.gatilho,
    // Pedido de fim: só a revisão e os critérios da recrutadora sem evidência (#130, item 9).
    candidatas: pedido ? candidatasDoPedidoDeFim(session, t) : candidatasDoFechamento(session, t),
    tempoRestanteMs,
    perguntasJaFeitas: falasDoAgente(session, req.messages),
    perguntasNoPedidoDeFim: inicio.perguntasNoPedidoDeFim,
  });
  session.fechamento = inicio.etapa ? { ...inicial, etapa: inicio.etapa } : inicial;
  session.fechamentoCodigoInicial = latestCode(session);
  session.fechamentoIniciadoEm = t;
  session.fechamentoBlipId = req.blipId;
  return passoDoFechamento(session, leitura, falaDoCandidato);
}

/** O próximo passo do fechamento em andamento, como resposta da IDE. */
function passoDoFechamento(session: SessionState, leitura?: LeituraDoTurno, falaDoCandidato = ""): ChatResponse {
  const tempoRestanteMs = Math.max(0, session.config.durationMin * 60_000 - elapsedMs(session));
  const passo = proximoPasso(session.fechamento!, leitura, falaDoCandidato, { tempoRestanteMs });
  session.fechamento = passo.estado;
  if (passo.encerrar) return { reply: passo.fala, commands: [{ type: "clear_highlights" }], end: false, fechamento: passo.etapa, despedida: true };
  return { reply: passo.fala, commands: passo.apontar ? highlightCommands(passo.apontar as LineRange) : [{ type: "clear_highlights" }], end: false, fechamento: passo.etapa };
}

/** As falas do Totti nesta conversa (as que vieram no pedido), mais antigas primeiro. */
function falasDoTottiNaConversa(messages: ChatMessage[]): string[] {
  return messages.filter((m) => m.role === "agent").map((m) => m.text);
}

async function turno(
  session: SessionState,
  req: { blipId?: string; messages: ChatMessage[]; reconheceu?: boolean },
): Promise<ChatResponse> {
  if (session.fechamento && req.blipId === session.fechamentoBlipId && req.messages.length === 0 && session.fechamento.etapa === "anuncio") {
    const t = elapsedMs(session);
    const passo = proximoPasso(session.fechamento, undefined, "", { tempoRestanteMs: Math.max(0, session.config.durationMin * 60_000 - t) });
    session.fechamento = passo.estado;
    return { reply: passo.fala, commands: passo.apontar ? highlightCommands(passo.apontar as LineRange) : [{ type: "clear_highlights" }], end: false, fechamento: passo.etapa };
  }
  const found = req.blipId !== undefined ? findBlipQuestion(session, req.blipId) : undefined;
  if (req.blipId !== undefined && !found) throw new Error(`blip desconhecido: ${req.blipId}`);

  // Empecilho: a primeira fala é o anúncio, fixo (sem LLM, não tem como falhar), e é ali que ele entra na linha do tempo.
  if (found?.question.kind === "empecilho" && req.messages.length === 0) {
    return { reply: anunciarEmpecilho(session, found.question.id), commands: [{ type: "clear_highlights" }], end: false };
  }

  const code = latestCode(session);
  const lineCount = code.split("\n").length;
  const question = found?.question;
  const problem = getProblem(session.config.problemId);

  // A primeira fala de uma pergunta é a pergunta preparada, dita como está: a análise já a escreveu para este
  // momento e o filtro já a aprovou. Reescrever com outra chamada de LLM era um segundo cérebro (mais um a
  // dois segundos e às vezes um "oi, tudo bem?" no meio da entrevista). Só o encerramento, que junta vários
  // pontos pendentes numa fala, e a abertura, que é sobre o que ele começou a escrever, passam pelo modelo.
  if (found && req.messages.length === 0 && found.question.kind !== "encerramento") {
    // Entre a pergunta nascer e a pausa para falar, ele pode já ter contado o plano ou ouvido o mesmo: fica quieto.
    const motivo = perdeuAVez(session, found.question, found.blip.createdAt);
    if (motivo) {
      console.info(`[interviewer] ${found.question.id}: ${motivo}`);
      found.question.status = "stale";
      return { reply: "", commands: [{ type: "clear_highlights" }], end: true };
    }
  }
  // A abertura é escrita na hora, sobre o que ele começou a escrever (o modelo vê o código); as outras perguntas
  // preparadas já foram escritas pela análise para este momento e saem como estão.
  // A pergunta da colagem também é escrita na hora: o modelo vê o trecho colado e o que havia antes dele.
  if (found && req.messages.length === 0 && found.question.kind !== "encerramento" && found.question.kind !== "cola" && !found.question.kickoff) {
    const grifo = found.question.highlight;
    const util = grifo && grifoComProposito(found.question.question, code, grifo, problem.public.starters[session.language] ?? "");
    return { reply: perguntaPreparada(found.question.question), commands: highlightCommands(util ? grifo : undefined), end: false };
  }
  if (found?.question.kickoff && req.messages.length === 0) found.question.question = aberturaDeReserva(session);
  const checkInDoEmpecilho = question?.checkInId
    ? session.checkIns.find((c) => c.id === question.checkInId)?.empecilhoId !== undefined
    : false;
  // A dica leve é do problema original: na conversa da mudança e no retorno dela não se aplica.
  const semDica = question?.kind === "empecilho" || checkInDoEmpecilho;
  const hint = semDica ? undefined : nextHint(session);
  const anunciado = empecilhoAnunciado(session);
  // O que o filtro de fala deixa passar: a dica oficial e a regra nova, que o Totti pode repetir.
  const permitido =
    [hint, anunciado && `regra nova do problema, já anunciada ao candidato: ${anunciado.empecilho.statement}`]
      .filter(Boolean)
      .join(" | ") || undefined;
  const criterion = session.config.criteria.find((c) => c.id === question?.criterionId);
  const checkIn = question?.checkInId ? session.checkIns.find((c) => c.id === question.checkInId) : undefined;
  const input: InterviewerTurnInput = {
    mode: found ? "blip" : "candidate",
    fase: faseDaEntrevista(session),
    elapsedLabel: formatMmSs(elapsedMs(session)),
    remainingLabel: formatMmSs(Math.max(0, session.config.durationMin * 60_000 - elapsedMs(session))),
    language: session.language,
    numberedCode: numberCode(code),
    question: found?.question.question,
    followUpTopic: found?.question.followUpTopic,
    kickoff: found?.question.kickoff,
    kind: question?.kind,
    criterion: criterion ? `${criterion.id}: ${criterion.name} — ${criterion.description}` : undefined,
    probeGuide: criterion ? problem.private.probeGuides?.[criterion.id] : undefined,
    challengeSummary: checkIn?.challenge,
    mudanca: mudancaParaPrompt(session, formatMmSs),
    mudancaClarifications:
      question?.kind === "empecilho" || checkInDoEmpecilho
        ? anunciado?.empecilho.clarifications.map((c) => `"${c.question}" → ${c.answer}`)
        : undefined,
    closingTopics: question?.closingTopics,
    cola: question?.cola ? { linhas: question.cola.linhas, antes: question.cola.antes, substituiu: question.cola.substituiu } : undefined,
    questionHighlight: found?.question.highlight,
    availableHint: hint,
    uncovered: uncoveredCriteria(session)
      .filter((id) => id !== question?.criterionId)
      .map((id) => {
        const c = session.config.criteria.find((item) => item.id === id)!;
        return `${c.id}: ${c.name} — ${c.description}`;
      }),
    hintsPolicy: session.config.hints,
    analystNotes: analystNotesOf(session),
    hypothesis: session.analyst.insights?.candidateThinking?.trim() || undefined,
    // As conversas anteriores (sem a atual, que vai em `messages`).
    previousConversations: formatarConversas(
      // Fora de balão, as falas recentes já vêm em `messages` (a conversa livre do fase.ts duplicaria).
      conversasFeitas(session).filter((c) => c.pergunta !== found?.question.question && (found || c.pergunta !== CONVERSA_LIVRE)),
    ),
    messages: req.messages,
    fechamento: session.fechamento?.etapa,
  };

  const perguntou = candidatoPerguntou(req.messages);
  // "Terminei" solto (sem dizer de quê) é o fim da entrevista (#130, item 9): o fechamento começa na hora, com até duas
  // perguntas sobre a revisão da abordagem e os critérios que faltam, e depois a despedida. Nunca vira "Continua daí."
  // (entrevista de 12/11, onde veio no meio da conversa da complexidade). Com uma pergunta junto, ou dizendo de quê
  // terminou, quem decide é o modelo.
  if (!session.fechamento && question?.kind !== "encerramento" && !perguntou && disseSoQueTerminou(req.messages.findLast((m) => m.role === "candidate")?.text ?? "")) {
    return abrirFechamento(session, req, { gatilho: "pediu_encerrar", perguntasNoPedidoDeFim: true });
  }
  const system = buildInterviewerSystem(session.config, problem);
  const user = buildInterviewerUser(input);
  const candidateLines = req.messages.filter((m) => m.role === "candidate").slice(-3).map((m) => m.text);
  const opening = found !== undefined && req.messages.length === 0;
  /**
   * As travas da fala do Totti único (lib/totti/guardas.ts), as mesmas do quadro, em toda fala gerada e antes do
   * filtro de spoiler: cumprimento fora da abertura, validação, eco, pergunta repetida ou de condução e reação
   * vazia repetida. Na primeira fala de uma pergunta sua a pergunta é o motivo da fala, então ali ela não é
   * barrada (se era a hora dela, a política já decidiu).
   */
  // A pergunta do Totti que ele está respondendo: a última fala dele nesta conversa, se terminou em pergunta.
  const ultimaDoTotti = req.messages.findLast((m) => m.role === "agent")?.text;
  // Escolha curta a uma pergunta com alternativas ("lista ou dicionário?" → "dicionário"): falta o porquê (#130, item 12).
  const porque = !opening && pedePorque(ultimaDoTotti, req.messages.findLast((m) => m.role === "candidate")?.text ?? "");
  const comGuardas = (o: InterviewerOutput): InterviewerOutput => {
    if (o.respond === false || !o.reply.trim()) return o;
    const naConversa = falasDoTottiNaConversa(req.messages);
    // O porquê que o modelo já pediu não é pergunta repetida nem de condução: é a pergunta que este turno precisa.
    const porqueDoModelo = porque && ePerguntaDePorque(o.reply);
    const guardada = aplicarGuardas(o.reply, {
      falaDoCandidato: req.messages.findLast((m) => m.role === "candidate")?.text,
      candidatoPerguntou: perguntou,
      falasDoTotti: naConversa,
      perguntasJaFeitas: opening || porqueDoModelo ? undefined : falasDoAgente(session, req.messages).filter((t) => t.includes("?")),
      // No encerramento, "quer acrescentar alguma coisa?" é a pergunta da vez; e com ele travado, oferecer um
      // caminho ("prefere continuar sozinho?") é ajuda, não condução devolvida.
      barrarConducao: !opening && !porqueDoModelo && question?.kind !== "encerramento" && !travado(req.messages),
      reconheceu: req.reconheceu === true,
    });
    if (!guardada.travas.length) return o;
    console.info("[interviewer] travas", { travas: guardada.travas, antes: o.reply });
    // A trava tirou a fala inteira de quem espera uma resposta (ele respondia a uma pergunta do Totti ou avisou que
    // terminou uma etapa): entra uma reação curta e neutra, para os outros campos da saída não se perderem.
    const esperaResposta = !opening && !perguntou && (found !== undefined || o.concluded === true || respondendoAoTotti(req.messages));
    return { ...o, reply: guardada.texto || (esperaResposta ? reacaoNeutra(naConversa) : "") };
  };
  // A leitura do turno é a do Totti único (lib/totti/turno.ts), a mesma do quadro: a saída do modelo vira a
  // leitura comum, as decisões comuns agem sobre ela (sinal de conclusão, sem pergunta nova depois de "não sei",
  // vez devolvida depois de uma resposta) e ela volta para a saída desta sala.
  const falaDoCandidato = req.messages.findLast((m) => m.role === "candidate")?.text ?? "";
  const situacao: SituacaoDoTurno = {
    sala: "codigo",
    falaDoCandidato,
    // "Terminei" não é resposta a uma pergunta: a vez não volta para o código com um "Continua daí.".
    respondiaAoTotti: !disseQueTerminou(falaDoCandidato) && (found !== undefined || respondendoAoTotti(req.messages)),
    falasDoTotti: falasDoAgente(session, req.messages),
    // Há quanto tempo ele não digita: a última versão do código que a sessão recebeu.
    paradoHaS: Math.max(0, elapsedMs(session) - (session.codeHistory.at(-1)?.t ?? 0)) / 1000,
    ajudando: travado(req.messages),
  };
  const comTurno = (o: InterviewerOutput): InterviewerOutput => {
    if (opening) return o;
    const decidido = decidirTurno(deSaidaDoLiveCoding(o, situacao), situacao);
    if (decidido.regras.length) console.info("[interviewer] turno", { regras: decidido.regras, antes: o.reply });
    return paraSaidaDoLiveCoding(decidido.leitura, o);
  };
  /** A saída do modelo depois das travas da fala, das decisões do turno e do limite de perguntas desta sala. */
  const lida = (o: InterviewerOutput): InterviewerOutput => {
    const guardada = comGuardas(o);
    if (session.fechamento) return paraSaidaDoLiveCoding(deSaidaDoLiveCoding(guardada, situacao), guardada);
    return comPorque(limitarPerguntas(comTurno(guardada), question, req.messages, opening));
  };
  /**
   * Ele fez uma escolha curta e a fala não termina em pergunta: o porquê entra no fim (#130, item 12), sem o convite
   * para seguir (a pergunta já devolve a vez). Se o modelo calou, a pergunta sai sozinha. "Não sei", "pula", pedido de
   * tempo e pedido de fim ficam de fora.
   */
  const comPorque = (o: InterviewerOutput): InterviewerOutput => {
    const soltou = o.probeOutcome?.kind === "nao_conseguiu" || o.probeOutcome?.kind === "recusou";
    if (!porque || soltou || o.finish === true || o.pediuTempo === true || o.reply.trim().endsWith("?")) return o;
    const base = o.respond === false ? "" : semConviteDeSeguir(o.reply);
    console.info("[interviewer] turno", { regras: ["pede_porque"], antes: o.reply });
    return { ...o, respond: true, reply: [base, perguntaDePorque(falasDoAgente(session, req.messages))].filter(Boolean).join(" "), end: false };
  };
  const calou = (o: InterviewerOutput): boolean => o.respond === false || o.reply.trim() === "";
  let output: InterviewerOutput;
  const prazo = Date.now() + PRAZO_TURNO_MS;
  const sobra = () => prazo - Date.now();
  try {
    output = lida(await generate(session, system, user, Math.min(PRAZO_GERACAO_MS, sobra())));
    const t = elapsedMs(session);
    const tempoRestanteMs = Math.max(0, session.config.durationMin * 60_000 - t);
    // Pediu tempo para pensar (#130, item 7): na primeira vez da entrevista, uma reação curta; depois, calado. Nunca
    // convite nem pergunta, não é sinal negativo (nada é registrado) e conta como fala do Totti para a regra da bola:
    // a próxima pergunta espera ele digitar ou falar (ver `estadoDaBola` em policy.ts). No fechamento, ele espera.
    if (!opening && output.pediuTempo === true && output.finish !== true && output.candidatoPerguntou !== true) {
      session.pediuTempoEm = t;
      if (session.fechamento || session.reacaoAoPensarDita) return { reply: "", commands: [], end: false, listening: true };
      session.reacaoAoPensarDita = true;
      return { reply: reacaoAoPensar(falasDoAgente(session, req.messages)), commands: [], end: false };
    }
    const leituraFechamento = deSaidaDoLiveCoding(output, situacao);
    // Pediu para encerrar e fez uma pergunta na mesma fala ("pode encerrar, mas e a lista vazia?"): a pergunta não cai
    // (#130, item 8). O Totti responde e pergunta se tem mais alguma coisa; o fechamento começa na última palavra.
    if (!session.fechamento && !opening && leituraFechamento.encerrar && leituraFechamento.candidatoPerguntou === true) {
      const daPergunta = deSaidaDoLiveCoding({ ...output, respond: true, finish: false }, situacao);
      return abrirFechamento(session, req, { gatilho: "pediu_encerrar", etapa: "ultima_palavra" }, daPergunta, falaDoCandidato);
    }
    const conclusoesAntes = session.conclusoes ?? 0;
    // "Terminei essa parte" não fecha enquanto faltam critérios da recrutadora ou a mudança de cenário: vira só uma fala
    // (como no quadro, #129 decisão F). O fim da entrevista vem pelo pedido de fim (item 9) ou pelo tempo.
    const podeFecharPorConclusao = uncoveredCriteria(session).length === 0 && !mudancaPendente(session);
    const gatilho = session.fechamento ? null : gatilhoDoFechamento({
      concluiu: leituraFechamento.concluiu,
      materialPronto: faseDaEntrevista(session) === "funcionando",
      tempoRestanteMs,
      limiarTempoMs: limiarDoFechamentoNaIde(session.config.durationMin * 60_000),
      podeFecharPorConclusao,
      pediuEncerrar: leituraFechamento.encerrar || querEncerrar(req.messages),
      // Um "terminei" de outra conversa da sessão conta como conclusão anterior.
      conclusoesAntes: Math.max(conclusoesAntes, falasDoCandidatoNaSessao(session).some(disseQueTerminou) ? 1 : 0),
    });
    if (gatilho) {
      if (leituraFechamento.concluiu) {
        session.conclusoes = (session.conclusoes ?? 0) + 1;
        session.etapaConcluidaEm = t;
        session.ultimaConclusaoEm = t;
      }
      // Pedido de fim passa pelos critérios que faltam (até duas perguntas), a não ser que ele precise sair já.
      return abrirFechamento(session, req, { gatilho, perguntasNoPedidoDeFim: gatilho === "pediu_encerrar" && output.urgent !== true }, leituraFechamento, falaDoCandidato);
    }
    if (session.fechamento) return passoDoFechamento(session, leituraFechamento, falaDoCandidato);
    // Só ouvindo (pensando em voz alta, ainda explicando): nada é falado e a conversa segue aberta.
    // A primeira fala de um balão é a pergunta, então ali o agente sempre fala.
    if (!opening && perguntou && calou(output) && output.finish !== true && sobra() >= MIN_PARA_REGERAR_MS) {
      // Ele perguntou e o modelo ficou quieto: era o "você pode me explicar?" sem resposta.
      output = lida(await generate(session, system, `${user}\n\n${avisoDePerguntaSemResposta("respond")}`, Math.min(PRAZO_GERACAO_MS, sobra())));
    }
    if (!opening) {
      // Pergunta clara nunca fica sem resposta (regra comum às duas salas): se nem a segunda geração respondeu,
      // o Totti pede para ele repetir, em vez de ignorar.
      const reserva = comRespostaDeReserva(deSaidaDoLiveCoding(output, situacao), situacao);
      if (reserva.regras.length) {
        console.info("[interviewer] turno", { regras: reserva.regras });
        output = { ...paraSaidaDoLiveCoding(reserva.leitura, output), end: false, highlight: null };
      }
      // Ele avisou que terminou (pelo modelo ou pelo sinal da fala com as mãos paradas) e não veio fala: o Totti
      // avisa que vai olhar, e a pergunta seguinte vem da análise do código, como no quadro.
      if (output.concluded === true && output.finish !== true && calou(output)) {
        output = { ...output, respond: true, reply: falaNaoRepetida(avisosDeQueVaiOlhar("codigo"), falasDoAgente(session, req.messages)), end: true, highlight: null };
      }
    }
    // Encerramento com todos os pontos já perguntados: a resposta dele ao último é o fim. Ficar ouvindo deixava o
    // candidato esperando ~30 s até perguntar "tem mais alguma pergunta?".
    if (!opening && question?.kind === "encerramento" && (output.respond === false || output.reply.trim() === "")
      && perguntasSeguidas(req.messages) >= limiteDePerguntas(question)) {
      registrarEvidencia(session, output);
      session.lastConversationEndedAt = elapsedMs(session);
      return { reply: falaNaoRepetida(FECHAR_O_ENCERRAMENTO, falasDoAgente(session, req.messages)), commands: [{ type: "clear_highlights" }], end: true };
    }
    if (!opening && (output.respond === false || output.reply.trim() === "")) {
      registrarEvidencia(session, output);
      return { reply: "", commands: [], end: false, listening: true };
    }
    // Fala livre em que ele não perguntou nada nem respondia a uma pergunta do Totti, e a resposta só reconhece
    // ("Entendi, você está separando as contagens."): não há por que falar. Era o Totti dizendo "entendi" para quem
    // pensava em voz alta. O que ele mostrou fica registrado do mesmo jeito.
    if (!found && reacaoDesnecessaria(output, req.messages, perguntou)) {
      console.info(`[interviewer] trava: reacaoDesnecessaria`, { antes: output.reply });
      registrarEvidencia(session, output);
      if (output.probeOutcome) recordOutcome(session, { t: elapsedMs(session), ...output.probeOutcome, source: "interviewer" });
      return { reply: "", commands: [], end: false, listening: true };
    }
    if (opening && output.reply.trim() === "") output = { ...output, reply: found.question.question, highlight: found.question.highlight ?? null };
    // A pergunta da colagem sempre aponta o trecho colado, mesmo que o modelo não tenha mandado o grifo.
    if (opening && question?.kind === "cola" && !output.highlight) output = { ...output, highlight: question.highlight ?? null };
    // Filtro de fala: aponta bug, entrega solução ou confirma acerto? Gera de novo sabendo o motivo.
    // A pergunta preparada já passou pelo filtro de perguntas: só confere se o modelo acrescentou algo.
    // Fala curta que só reconhece e devolve a vez (sem pergunta) não tem o que entregar: vai sem o filtro, que
    // custava mais de um segundo em cada resposta.
    // A primeira fala sobre uma colagem pergunta de onde veio o trecho que ele mesmo trouxe: não há solução a
    // entregar ali, e o filtro custava ~1,5 s numa pergunta que precisa sair logo depois da colagem.
    const aberturaDaColagem = opening && question?.kind === "cola";
    if (!aberturaDaColagem && !(opening && isAboutTheSame(output.reply, found.question.question)) && !falaSoDeReconhecer(output.reply)
      && podeEntregarAlgo(output.reply, code)) {
      const verdict = await checkReply(output.reply, candidateLines, permitido, code, Math.min(PRAZO_FILTRO_MS, sobra()), session);
      session.analyst.costUsd += verdict.costUsd;
      if (!verdict.safe && sobra() < MIN_PARA_REGERAR_MS) {
        // Sem tempo para outra geração: a reserva segura, sem arriscar a fala barrada.
        console.info(`[interviewer] fala barrada (${verdict.reason}) sem tempo para outra: ${output.reply}`);
        output = opening
          ? { ...output, reply: found.question.question, highlight: found.question.highlight ?? null, end: false, gaveHint: false, challenge: null }
          : { ...output, reply: falaSegura(perguntou, falasDoAgente(session, req.messages)), highlight: null, end: perguntou, gaveHint: false, challenge: null };
      } else if (!verdict.safe) {
        console.info(`[interviewer] fala barrada (${verdict.reason}): ${output.reply}`);
        const barrada = output;
        // A segunda geração pode estourar o prazo: aí vale a fala segura, nunca o "pode repetir" (o candidato
        // falou certo; quem falhou foi a geração).
        output = await generate(
          session,
          system,
          `${user}\n\nATENÇÃO: sua fala anterior ("${output.reply}") foi barrada: ${verdict.reason}. Escreva outra que não faça isso.`,
          Math.min(PRAZO_GERACAO_MS, sobra() - PRAZO_FILTRO_MS / 2),
        ).then(lida).catch((err) => {
          console.info("[interviewer] segunda geração falhou, indo de fala segura:", err instanceof Error ? err.message : err);
          return opening
            ? { ...barrada, reply: found.question.question, highlight: found.question.highlight ?? null, end: false, gaveHint: false, challenge: null }
            : { ...barrada, reply: falaSegura(perguntou, falasDoAgente(session, req.messages)), highlight: null, end: perguntou, gaveHint: false, challenge: null };
        });
        const second = await checkReply(output.reply, candidateLines, permitido, code, Math.max(500, Math.min(PRAZO_FILTRO_MS, sobra())), session);
        session.analyst.costUsd += second.costUsd;
        if (!second.safe) {
          console.info(`[interviewer] fala barrada de novo (${second.reason}): ${output.reply}`);
          // Na abertura, a pergunta preparada (já filtrada); depois, uma pergunta aberta segura, sem fechar.
          output = opening
            ? { ...output, reply: found.question.question, highlight: found.question.highlight ?? null, end: false, gaveHint: false, challenge: null }
            : { ...output, reply: falaSegura(perguntou, falasDoAgente(session, req.messages)), highlight: null, end: perguntou, gaveHint: false, challenge: null };
        }
      }
    }
  } catch (err) {
    console.error("[interviewer] falha no LLM:", err instanceof Error ? err.message : err);
    // Primeira fala de um blip: a pergunta preparada, com o grifo dela. Senão, pede pra repetir.
    if (found && req.messages.length === 0) {
      const grifo = found.question.highlight;
      const util = grifo && grifoComProposito(found.question.question, code, grifo, problem.public.starters[session.language] ?? "");
      return {
        reply: perguntaPreparada(found.question.question),
        commands: highlightCommands(util ? grifo : undefined),
        end: false,
      };
    }
    return { reply: falaNaoRepetida(FALLBACK_REPLIES, falasDoAgente(session, req.messages)), commands: [], end: false };
  }

  // A primeira fala de um blip é a pergunta: encerrar ali não deixaria o candidato responder.
  if (found && req.messages.length === 0) output.end = false;
  // Fala sem pergunta não deixa o assunto aberto: senão os dois ficam esperando, sem saber de quem é a vez.
  else if (!output.end && !output.reply.trim().endsWith("?")) output = { ...output, end: true };
  // Antes de ele escrever código, uma pergunta sobre o plano basta: depois disso ele é liberado para codar.
  // Sem isso a conversa virava um interrogatório (por que, custo, bordas...) antes da primeira linha.
  if (!found && input.fase === "entendendo" && (jaPerguntouDoPlano(req.messages) || jaPerguntouNaSessao(session)) && output.reply.trim().endsWith("?")) {
    output = { ...output, reply: liberarParaCodar(output.reply), end: true, highlight: null };
  }
  // Grifo só com propósito: a fala tem que citar algo que está nas linhas grifadas.
  if (output.highlight && !grifoComProposito(output.reply, code, output.highlight, problem.public.starters[session.language] ?? "")) {
    output = { ...output, highlight: null };
  }
  const t = elapsedMs(session);

  const highlight = output.highlight ? clampLines(output.highlight, lineCount) : undefined;
  const commands: EditorCommand[] = highlightCommands(highlight);
  if (output.end) commands.push({ type: "clear_highlights" });

  // Só conta como dica se a fala traz a dica de fato (o modelo às vezes marca gaveHint ao fechar).
  if (output.gaveHint && hint !== undefined && containsHint(output.reply, hint)) {
    appendEvent(session, {
      type: "hint",
      sessionId: session.sessionId,
      t: elapsedMs(session),
      level: session.hintsUsed + 1,
      text: hint,
    });
  }
  registrarEvidencia(session, output);
  const outcome = output.probeOutcome;
  if (outcome) {
    recordOutcome(session, { t, ...outcome, questionId: question?.id, source: "interviewer" });
  }
  // Topou um desafio (da pergunta de desafio ou emendado numa sondagem): o agente volta depois para ver
  // como foi (policy.enqueueDueCheckIns). Nunca a partir de um retorno, para não virar um ciclo.
  if (
    question &&
    question.kind !== "retorno" &&
    question.kind !== "empecilho" &&
    output.challenge?.accepted &&
    !session.checkIns.some((c) => c.challengeId === question.id)
  ) {
    session.checkIns.push({
      id: `c-${session.checkIns.length + 1}`,
      challengeId: question.id,
      criterionId: question.criterionId,
      challenge: output.challenge.summary,
      createdAt: t,
      versionAtStart: session.codeHistory.at(-1)?.version ?? 0,
      status: "aguardando",
    });
  }
  if (output.end && checkIn) checkIn.status = "feito";
  if (output.end) session.lastConversationEndedAt = t;
  // Concluiu uma etapa: a próxima análise é um momento-chave (ver consumirEtapaConcluida no analista).
  const concluded = output.concluded === true && !opening;
  if (concluded) {
    session.etapaConcluidaEm = t;
    session.ultimaConclusaoEm = t;
    session.conclusoes = (session.conclusoes ?? 0) + 1;
  }

  return { reply: output.reply, commands, end: output.end, ...(concluded ? { concluded } : {}) };
}

function registrarEvidencia(session: SessionState, output: InterviewerOutput): void {
  if (!output.evidence) return;
  session.evidence.push({
    t: elapsedMs(session),
    criterionId: output.evidence.criterionId,
    note: output.evidence.note,
    source: "interviewer",
  });
}

/**
 * Anuncia o empecilho (uma vez): grava o evento na linha do tempo com o conceito que ele exige e já agenda o
 * retorno ("como ficou com a mudança?"). Repetir a chamada (tentar de novo) só devolve o anúncio.
 */
function anunciarEmpecilho(session: SessionState, blipId: string): string {
  const empecilho = empecilhoDaQuestao(session);
  const state = session.empecilho;
  if (!empecilho || !state || state.blipId !== blipId) return falaNaoRepetida(FALLBACK_REPLIES, falasDoAgente(session, []));
  if (state.announcedAt !== undefined) return empecilho.announcement;

  const t = elapsedMs(session);
  state.announcedAt = t;
  appendEvent(session, {
    type: "empecilho",
    sessionId: session.sessionId,
    t,
    empecilhoId: empecilho.id,
    kind: empecilho.kind,
    concept: empecilho.concept,
    title: empecilho.title,
    blipId,
    testNames: testesIde(session, empecilho.tests).map((teste) => teste.name),
  });
  session.checkIns.push({
    id: `c-${session.checkIns.length + 1}`,
    challengeId: blipId,
    challenge: `adaptar o código à mudança (${empecilho.title})`,
    createdAt: t,
    versionAtStart: session.codeHistory.at(-1)?.version ?? 0,
    status: "aguardando",
    empecilhoId: empecilho.id,
  });
  return empecilho.announcement;
}

/** A última fala do candidato veio logo depois de uma pergunta do Totti (ele está respondendo). */
export function respondendoAoTotti(messages: ChatMessage[]): boolean {
  const i = messages.findLastIndex((m) => m.role === "candidate");
  if (i < 0) return false;
  const anterior = messages.slice(0, i).findLast((m) => m.role === "agent");
  return anterior?.text.trim().endsWith("?") === true;
}

/**
 * Fora de uma pergunta do Totti, uma resposta que só reconhece o que ele disse é desnecessária: ele não perguntou,
 * não respondia a nada, não pediu ajuda, não avisou que terminou uma etapa e não chamou o Totti pelo nome.
 */
export function reacaoDesnecessaria(output: InterviewerOutput, messages: ChatMessage[], perguntou: boolean): boolean {
  if (output.reply.includes("?") || output.concluded === true || output.gaveHint === true || output.finish === true) return false;
  if (perguntou || travado(messages) || respondendoAoTotti(messages)) return false;
  const ultima = messages.findLast((m) => m.role === "candidate")?.text ?? "";
  return !/\btotti\b/i.test(ultima);
}

/**
 * Quantas perguntas o Totti já fez seguidas nesta conversa, sem devolver a vez (uma fala dele sem pergunta fecha
 * a sequência). Os pedidos de licença não contam.
 */
export function perguntasSeguidas(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role !== "agent") continue;
    const texto = m.text.trim();
    if (/posso (te )?(perguntar|interromper)/i.test(texto)) continue;
    n = texto.endsWith("?") ? n + 1 : 0;
  }
  return n;
}

/**
 * Quantas perguntas seguidas cabem numa conversa antes de o Totti devolver a vez. Uma resposta sempre ganha no
 * máximo um aprofundamento: mais que isso virava interrogatório (pergunta, pergunta, pergunta) e ele não deixava o
 * candidato voltar para o código. Fora de uma pergunta sua, uma pergunta só. O encerramento e a mudança no
 * problema têm o próprio ritmo.
 */
export function limiteDePerguntas(question: PerguntaDoLimite | undefined): number {
  if (!question) return 1;
  if (question.kind === "empecilho") return Number.POSITIVE_INFINITY;
  // Uma pergunta por ponto pendente, sem aprofundar: ele já clicou para sair. Com aprofundamento eram quatro
  // perguntas e o Totti não encerrava depois dos pontos.
  if (question.kind === "encerramento") return Math.max(1, question.closingTopics?.length ?? 2);
  if (question.kickoff) return 1;
  if (question.kind === "retorno") return 3;
  return 2;
}

/** Passou do limite de perguntas seguidas: reconhece, tira a pergunta e devolve a vez para o código. */
type PerguntaDoLimite = { kind?: string; kickoff?: boolean; closingTopics?: string[] };

/** No encerramento, o corte despede (a IDE diz o tchau depois); nas outras conversas, devolve para o código. */
const FECHAR_O_ENCERRAMENTO = ["Era isso que eu queria fechar.", "Era isso, obrigado pelas respostas."];

export function limitarPerguntas(
  output: InterviewerOutput,
  question: PerguntaDoLimite | undefined,
  messages: ChatMessage[],
  opening: boolean,
): InterviewerOutput {
  if (opening || output.respond === false || output.finish === true || !output.reply.trim().endsWith("?")) return output;
  // Ele disse que terminou: devolver a vez para o código ("Continua daí.") seria ignorar o que ele disse.
  if (disseQueTerminou(messages.findLast((m) => m.role === "candidate")?.text ?? "")) return output;
  // Perguntou algo ou está travado: a pergunta do Totti ali é ajuda (o que ele está vendo, onde travou), não
  // interrogatório. Cortar deixava um "Pode seguir." seco para quem acabou de dizer que não sabe seguir.
  const encerramento = question?.kind === "encerramento";
  if (!encerramento && (candidatoPerguntou(messages) || travado(messages))) return output;
  if (perguntasSeguidas(messages) + 1 <= limiteDePerguntas(question)) return output;
  const jaDitas = messages.filter((m) => m.role === "agent").map((m) => m.text);
  // Fora do encerramento, a vez volta para o código com o convite comum às duas salas (lib/totti/guardas.ts).
  const fechamento = encerramento ? falaNaoRepetida(FECHAR_O_ENCERRAMENTO, jaDitas) : escolherConvite(output.reply, jaDitas, "codigo");
  return { ...output, reply: semPerguntaNoFim(output.reply, fechamento, encerramento), end: true, highlight: null };
}

/** Ele diz que não sabe seguir, não entendeu ou travou. */
export function travado(messages: ChatMessage[]): boolean {
  const ultima = messages.at(-1);
  return ultima?.role === "candidate" && /\b(n[ãa]o sei (como|o que|o porqu[êe]|porque|por que|mais)|n[ãa]o entendi|n[ãa]o t[ôo] entendendo|travei|t[ôo] travad[oa]|n[ãa]o (t[ôo]|estou) conseguindo)\b/i.test(ultima.text);
}

/**
 * Ele diz que já terminou, ou repete que terminou: quer encerrar. `anteriores`: as falas dele em conversas anteriores
 * da sessão (a pergunta da complexidade abre outra conversa, e o primeiro "terminei" ficava de fora).
 */
export function querEncerrar(messages: ChatMessage[], anteriores: string[] = []): boolean {
  const doCandidato = messages.filter((m) => m.role === "candidate");
  const ultima = doCandidato.at(-1)?.text ?? "";
  if (!disseQueTerminou(ultima)) return false;
  return disseQueJaTerminou(ultima) || [...anteriores, ...doCandidato.slice(0, -1).map((m) => m.text)].some(disseQueTerminou);
}

/** As falas do candidato já gravadas na sessão (todas as conversas), mais antigas primeiro. */
export function falasDoCandidatoNaSessao(session: SessionState): string[] {
  return session.events.flatMap((e) => (e.type === "speech" && e.role === "candidate" ? [e.text] : []));
}

/** A fala segura quando a geração foi barrada: resposta neutra se ele perguntou algo, senão uma pergunta aberta. */
function falaSegura(perguntou: boolean, jaDitas: string[]): string {
  return falaNaoRepetida(perguntou ? SAFE_ANSWER_REPLIES : SAFE_CLOSE_REPLIES, jaDitas);
}

/**
 * A pergunta que a análise preparou sai como está, mas também é fala do Totti: passa pelas travas comuns de
 * cumprimento e de validação (um "Oi, tudo bem?" na frente da pergunta, no meio da entrevista). Se a trava não
 * deixar sobrar pergunta, vale a original.
 */
function perguntaPreparada(pergunta: string): string {
  const guardada = aplicarGuardas(pergunta, { barrarConducao: false });
  if (guardada.travas.length) console.info("[interviewer] travas na pergunta preparada", { travas: guardada.travas, antes: pergunta });
  const sobrou = guardada.texto && !eSoReacao(guardada.texto) && (!pergunta.includes("?") || guardada.texto.includes("?"));
  return sobrou ? guardada.texto : pergunta;
}

/** O que o filtro de fala barra: erro, caso que quebra, técnica, validação, comparação com algo melhor. */
const TEMA_DE_SPOILER = /\b(not[oa]u|percebeu|reparou|problema|erro|bug|falh|errad|cert[oa]|corret|exat|isso mesmo|funciona|falt|sobr|devia|deveria|precis|tent[ae]|test|entrada|caso|melhor|r[áa]pid|otimiz|alternativ|em vez|dicion|hash|mapa|map|set|conjunt|pilha|fila|heap|[áa]rvore|grafo|orden|bin[áa]ri|ponteir|loop|la[çc]o|recurs|mem[óo]ria|complexidade|[íi]ndice|array|lista|vetor|string|vazi|negativ|repetid|duplicad|limite|borda)/i;

/**
 * A fala pode entregar algo (e vale o filtro, ~1 s em cada resposta): cita o código dele, um número ou símbolo, ou um
 * tema que o filtro barra. "Por que começar por aí?" não tem o que entregar e sai sem esperar o filtro.
 */
export function podeEntregarAlgo(reply: string, code: string): boolean {
  if (/[0-9\[\]{}()=<>+*/%]/.test(reply) || TEMA_DE_SPOILER.test(reply)) return true;
  const fala = reply.toLowerCase();
  const nomes = new Set(code.toLowerCase().match(/[a-zà-ú_][a-zà-ú0-9_]{2,}/g) ?? []);
  return [...nomes].some((n) => !PALAVRAS_DA_LINGUAGEM.has(n) && new RegExp(`(^|[^a-zà-ú0-9_])${n}([^a-zà-ú0-9_]|$)`).test(fala));
}

/** Uma fala curta e sem pergunta: só reconhece e devolve a vez. */
function falaSoDeReconhecer(reply: string): boolean {
  const texto = reply.trim();
  return !texto.includes("?") && texto.split(/\s+/).length <= 14;
}

/** Tira as perguntas do fim da fala e põe o fechamento no lugar (mantém a reação curta do começo, se houver). */
function semPerguntaNoFim(reply: string, fechamento: string, sempreFechar = false): string {
  const frases = reply.trim().split(/(?<=[.!?])\s+/);
  while (frases.length && frases[frases.length - 1].endsWith("?")) frases.pop();
  if (sempreFechar) return [...frases.slice(0, 1), fechamento].join(" ");
  // Sobrou a reação ou a resposta ao que ele perguntou: ela basta (o "Pode seguir." em toda fala cansava).
  // O fechamento só entra quando não sobrou nada.
  return frases.length ? frases.slice(0, 2).join(" ") : fechamento;
}

/** O entrevistador já fez alguma pergunta nesta conversa livre (as falas que vieram no pedido). */
function jaPerguntouDoPlano(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === "agent" && m.text.trim().endsWith("?"));
}

/**
 * Ele já ouviu uma pergunta do Totti nesta sessão (a abertura ou outra). Antes de haver código, qualquer pergunta é
 * sobre o plano: a abertura numa conversa e outra pergunta do plano na fala livre seguinte era o "você já me
 * perguntou isso".
 */
function jaPerguntouNaSessao(session: SessionState): boolean {
  return session.events.some((e) => e.type === "speech" && e.role === "agent" && e.text.trim().endsWith("?") && !/posso (te )?(perguntar|interromper)/i.test(e.text));
}

/** Tira a pergunta do fim e libera para codar (mantém a reação curta do começo, se houver). */
function liberarParaCodar(reply: string): string {
  const frases = reply.trim().split(/(?<=[.!?])\s+/);
  while (frases.length && frases[frases.length - 1].endsWith("?")) frases.pop();
  return [...frases, "Pode começar a codar quando quiser."].join(" ");
}

/** A abertura de reserva (o modelo falhou): sobre a ideia que ele está seguindo, ou, sem código ainda, sobre o plano. */
function aberturaDeReserva(session: SessionState): string {
  return linesWrittenBeyondStarter(session) >= 3
    ? "E aí, qual é a ideia que você está seguindo?"
    : "Como você está pensando em atacar esse problema?";
}

/** Mais linhas que isso já é o arquivo, não um trecho. */
const MAX_LINHAS_GRIFO = 12;

const PALAVRAS_DA_LINGUAGEM = new Set(["def", "for", "return", "not", "and", "pass", "else", "elif", "while", "len", "range", "true", "false", "none", "self", "class", "import", "from", "const", "let", "var", "function", "int", "string", "public", "static", "void", "new", "this", "null", "undefined"]);

/**
 * O grifo tem propósito quando as linhas têm código do candidato (não só o inicial) e a fala cita algo delas
 * (um nome, uma palavra do trecho) ou aponta para ele ("essa linha", "aqui"). Grifo sem isso confunde: o
 * candidato olha para a tela e não entende do que o Totti está falando.
 */
export function grifoComProposito(reply: string, code: string, range: LineRange, starter: string): boolean {
  const linhasDoInicio = new Set(starter.split("\n").map((l) => l.trim()).filter(Boolean));
  // Grifar a função inteira não aponta nada: o grifo é para um trecho.
  if (range.endLine - range.startLine + 1 > MAX_LINHAS_GRIFO) return false;
  const linhas = code.split("\n").slice(Math.max(0, range.startLine - 1), range.endLine).map((l) => l.trim()).filter(Boolean);
  if (linhas.length === 0 || linhas.every((l) => linhasDoInicio.has(l) || l.startsWith("#") || l.startsWith("//"))) return false;
  const fala = reply.toLowerCase();
  if (/\b(essa linha|nessa linha|esse trecho|nesse trecho|aqui em cima|aqui embaixo|esse (loop|if|bloco|retorno|return|for)|essa (condição|função|variável|parte))\b/.test(fala)) return true;
  const nomes = new Set(linhas.join(" ").toLowerCase().match(/[a-zà-ú_][a-zà-ú0-9_]{2,}/g) ?? []);
  return [...nomes].some((n) => !PALAVRAS_DA_LINGUAGEM.has(n) && new RegExp(`(^|[^a-zà-ú0-9_])${n}([^a-zà-ú0-9_]|$)`).test(fala));
}

/** Uma geração da fala no modelo de conversa (rápido, sem raciocínio), cancelada de verdade no prazo. */
async function generate(session: SessionState, system: string, user: string, prazoMs: number): Promise<InterviewerOutput> {
  const result = await completeJson({
    role: "conversa",
    system,
    user,
    schema: InterviewerOutput,
    prazoMs,
    signal: AbortSignal.timeout(Math.max(500, prazoMs)),
  });
  session.analyst.costUsd += result.costUsd;
  registrarUsoLlm(session, "fala", result);
  return { ...result.data, reply: pedidoViraPergunta(result.data.reply) };
}

const PEDIDO_DE_EXPLICACAO = /\b(me (conta|explica|fala|diz|mostra)|explica (pra|para) mim|conta (pra|para) mim)\b/i;

/**
 * "E me conta o que esse laço faz, passo a passo." é uma pergunta, mas o modelo às vezes a fecha com ponto. Sem o "?",
 * o servidor entendia que a fala não devolvia a vez e fechava o assunto antes de ele responder.
 */
export function pedidoViraPergunta(reply: string): string {
  const texto = reply.trim();
  if (!texto.endsWith(".") || texto.endsWith("...")) return reply;
  const ultima = texto.split(/(?<=[.!?])\s+/).at(-1) ?? "";
  return PEDIDO_DE_EXPLICACAO.test(ultima) ? `${texto.slice(0, -1)}?` : reply;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-zà-ú]{4,}/g) ?? [];
}

/** A fala traz a dica: boa parte das palavras da dica aparecem nela. */
function containsHint(reply: string, hint: string): boolean {
  const said = new Set(words(reply));
  const hintWords = words(hint);
  return hintWords.length > 0 && hintWords.filter((w) => said.has(w)).length / hintWords.length >= 0.6;
}

/** A fala é praticamente a pergunta preparada: quase todas as palavras dela e quase nada a mais. */
function isAboutTheSame(reply: string, question: string): boolean {
  const asked = new Set(words(question));
  const said = words(reply);
  if (asked.size === 0 || said.length === 0) return false;
  const extra = said.filter((w) => !asked.has(w)).length;
  return containsHint(reply, question) && extra <= 2;
}

function elapsedMs(session: SessionState): number {
  return sessionNow(session);
}

function highlightCommands(range: LineRange | undefined): EditorCommand[] {
  return range ? [{ type: "highlight_range", startLine: range.startLine, endLine: range.endLine }] : [];
}

/** Mantém o grifo dentro das linhas do código e com endLine >= startLine. */
function clampLines(range: LineRange, lineCount: number): LineRange {
  const startLine = clamp(range.startLine, 1, lineCount);
  const endLine = clamp(range.endLine, startLine, lineCount);
  return { startLine, endLine };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Um parágrafo com o que o Analyst viu: abordagem, complexidade e trechos suspeitos. */
function analystNotesOf(session: SessionState): string | undefined {
  const insights = session.analyst.insights;
  if (!insights) return undefined;
  // Só a complexidade: a abordagem e as linhas suspeitas do analista às vezes citam o bug
  // ("sem verificar i == j"), e o entrevistador que sabe onde está o bug acaba apontando.
  return `Complexidade estimada: ${insights.timeComplexity} de tempo, ${insights.spaceComplexity} de espaço.`;
}

/** Tempo em mm:ss. */
function formatMmSs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
