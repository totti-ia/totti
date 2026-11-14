/**
 * Política determinística do agente: escolhe quando um blip aparece e qual dica está disponível.
 * O conteúdo das perguntas vem do Analyst (lib/agents/analyst.ts), menos a pergunta de abertura.
 */
import { isCovered, uncoveredCriteria } from "@/lib/agents/coverage";
import { empecilhoDaQuestao, empecilhoGarantido, empecilhoPublico, esperaDoEmpecilho, primeiraAdaptacao } from "@/lib/agents/empecilho";
import { faseDaEntrevista, linesWrittenBeyondStarter } from "@/lib/agents/fase";
import type { Blip, RunResult, SessionEvent } from "@/lib/contracts";
import { interrupcaoAtrasada, motivoDoMomento, motivoDoRitmo, orcamentoDeInterrupcoes, RITMO, RITMO_IDE, type Momento, type Ritmo } from "@/lib/interrupcao/politica";
import { SILENCIO_SEM_ACAO_S } from "@/lib/contracts";
import { latestCode } from "@/lib/session/store";
import { ultimoEvento } from "@/lib/session/eventos";
import type { Cola, QueuedQuestion, SessionState } from "@/lib/session/types";
import { getProblem } from "@/problems";

// Afinação do ritmo dos blips. Tempos em ms de sessão.

/**
 * Reserva da abertura. A fala de verdade é escrita na hora pelo entrevistador, olhando o que ele começou a escrever
 * (lib/agents/interviewer.ts); esta só sai se o modelo falhar. O "Quando quiser, me conta rapidinho como você está
 * pensando em resolver?" fixo soava como robô.
 */
const KICKOFF_QUESTION = "E aí, qual é a ideia que você está seguindo?";
/** Tema da abertura (o Interviewer não aprofunda a abertura, mas o campo é obrigatório). */
const KICKOFF_FOLLOW_UP = "a ideia geral dele";
/** Rótulo do balão da abertura. */
const KICKOFF_TOPIC_LABEL = "seu plano de ataque";
/** Prioridade da abertura (alta, mas ela tem regras próprias). */
const KICKOFF_PRIORITY = 0.95;
/**
 * Tempo de sessão antes de a abertura aparecer. A apresentação falada leva ~30 s e a IDE ainda espera a leitura
 * depois dela (LEITURA_DEPOIS_DA_APRESENTACAO_MS em components/IdeApp.tsx). Com 14 s o balão nascia no meio da
 * apresentação e a pergunta saía uns 15 s depois de ela acabar: o candidato ainda estava lendo o enunciado.
 */
const KICKOFF_READING_MS = 30_000;
/**
 * A abertura sai depois que ele começa a escrever (esse tanto de linhas além do código inicial) e para: aí ele já
 * pensou em alguma coisa e a pergunta é sobre algo concreto. Num tempo fixo, ele podia ainda não ter ideia nenhuma.
 */
const KICKOFF_MIN_LINES = 3;
/** Sem escrever nada até aqui (pode estar travado na leitura): a abertura sai mesmo assim, leve. */
const KICKOFF_FALLBACK_MS = 150_000;
/**
 * Escreveu muito antes de a abertura sair: a solução já está quase pronta, e as perguntas da análise assumem. Alto de
 * propósito: com a pausa curta abaixo, quem digita sem parar ainda recebe a abertura bem antes disso.
 */
const KICKOFF_SKIP_IF_LINES_WRITTEN = 40;
/**
 * Depois de começar a escrever, a abertura sai numa pausa curta da digitação: quem digita direto, sem nunca parar
 * 8 s, nunca recebia a abertura e ela era descartada ao passar de 20 linhas.
 */
const KICKOFF_PAUSA_CURTA_MS = 3_000;
/** Se o candidato já falou esse tanto (contou o plano sozinho, depois da apresentação), a abertura é descartada. */
const KICKOFF_SKIP_IF_WORDS_SPOKEN = 15;
/** Prioridade mínima, já com o boost de momento, pra uma pergunta virar blip. */
const BLIP_THRESHOLD = 0.6;
/** Interrupção atrasada (ver `interrupcaoAtrasada`): o limiar baixa esse tanto, para o agente não ficar calado. */
const DESCONTO_ATRASO = 0.15;
// Orçamento, cota, intervalo, respiro e a pausa necessária vêm da política comum (lib/interrupcao/politica.ts).
/** Balão nunca aberto some sozinho depois desse tempo (a pergunta vira "ignorada"). */
const BLIP_EXPIRY_MS = 80_000;
/** Nenhum blip do Analyst nos primeiros 20 s da sessão. */
const WARMUP_MS = 20_000;
/** Escrevendo a primeira versão, a próxima pergunta espera ele escrever pelo menos isso de linhas novas. */
const MIN_NEW_LINES_BETWEEN_QUESTIONS = 3;
/** Uma fala dele com pelo menos tantas palavras depois de a pergunta nascer pode já ter respondido a ela. */
const SPEECH_MAKES_STALE_WORDS = 12;
/** Preferência da pergunta de foco da vaga na fila, para ela não ficar sempre atrás das perguntas sobre o código. */
const FOCUS_QUESTION_BONUS = 0.1;
/** Boost pro primeiro run com todos os casos passando: bom momento pra pergunta de complexidade. */
const BOOST_FIRST_GREEN_RUN = 0.15;
/** Boost pra um run que falhou: o candidato pode estar travado. */
const BOOST_FAILED_RUN = 0.1;
/** Boost pra uma pausa longa: o candidato parou de digitar por um tempo. */
const BOOST_LONG_PAUSE = 0.1;
/** Pausa a partir desse tamanho conta como pausa longa pro boost. */
const LONG_PAUSE_MS = 30_000;
/** A partir dessa fração do tempo, pergunta de critério ainda não explorado ganha reforço (30%, como no quadro: #129). */
const AGENDA_START_FRACTION = 0.3;
/** Reforço de agenda: critério da recrutadora que ainda não foi explorado. */
const BOOST_UNCOVERED = 0.15;
/**
 * Reta final: os últimos ~27% da entrevista (8 min de 30). Proporcional à duração: numa entrevista de 10 min, 8 min
 * fixos eram quase o tempo todo e liberavam pergunta de processo no meio da primeira versão.
 */
function retaFinalMs(session: SessionState): number {
  return session.config.durationMin * 60_000 * (8 / 30);
}

/** Tempos pensados para 30 min, escalados pela duração (numa entrevista de 10 min, "faltam 5 min" era a metade). */
function escalado(session: SessionState, ms: number): number {
  return Math.round(ms * Math.min(1, session.config.durationMin / 30));
}

/** Retorno de desafio: depois desse tempo volta mesmo sem o código mudar. */
const CHECK_IN_MAX_WAIT_MS = 4 * 60_000;
/** Retorno de desafio: com o código mudado, volta depois desse tempo sem digitar. */
const CHECK_IN_IDLE_MS = 30_000;
/** Retorno de desafio: volta de qualquer jeito quando faltar esse tempo. */
const CHECK_IN_BEFORE_END_MS = 5 * 60_000;
/** Pergunta ignorada de critério não explorado volta depois desse tempo (uma vez). */
const IGNORED_RETRY_MS = 120_000;
/** Tipos que deixam o candidato parado: ele não está digitando nem rodando nada agora. */
const IDLE_EVENT_TYPES = new Set<SessionEvent["type"]>(["pause", "run", "blip_closed", "session_started"]);
/** Depois desse tempo sem evento novo, o candidato também conta como parado. */
const IDLE_AFTER_MS = 8000;
/** Pergunta que não virou balão nesse tempo fica velha: o candidato já está pensando em outra coisa. */
const QUESTION_MAX_AGE_MS = 90_000;
/**
 * Bloco colado a partir desse tanto de linhas vira pergunta sempre: de onde veio e como funciona. Antes a colagem só
 * era um "momento-chave" da análise, e a pergunta dela podia nunca sair (outro assunto aberto, o Finalizar logo depois).
 */
export const COLA_MIN_LINES = 5;
/** Linhas do grifo da colagem, no máximo (mais que isso já é o arquivo, não um trecho). */
const COLA_MAX_LINHAS_GRIFO = 12;
/** Das linhas coladas, a fração que já existia no código antes: acima disso ele só moveu código dele de lugar. */
const COLA_FRACAO_JA_EXISTENTE = 0.7;
/** Das linhas coladas, a fração que precisa continuar no código para a pergunta ainda valer. */
const COLA_FRACAO_QUE_FICOU = 0.5;

/**
 * Depois de um run que falhou, o Totti sempre fala alguma coisa na pausa seguinte (entrevista de 12/11: rodou, falhou
 * em alguns testes, a pergunta sobre o resultado sumiu e ele não disse nada). Curta, sobre o raciocínio dele diante do
 * resultado, sem nomear erro, linha ou caso (GUIA_DA_FASE.depurando). Varia para não soar como gravação.
 */
export const FALAS_DO_RUN_FALHOU = [
  "Rodou e não passou. O que você esperava que saísse?",
  "Não passou dessa vez. O que você está olhando agora?",
  "Rodou e ainda não passou. O que você acha que aconteceu?",
];

/**
 * Pergunta de revisão do fechamento: com uma abordagem pior que a melhor conhecida ou uma justificativa fraca, o Totti
 * não redireciona durante a implementação (decisão de produto), mas pergunta no fim se ele mudaria algo.
 */
export const PERGUNTA_DE_REVISAO = "Olhando o código agora, você mudaria alguma coisa na abordagem? Por quê?";

const NO_BOOST = { boost: 0, reason: "" };

// Em globalThis, como o store e o Analyst: o Next em dev recarrega o módulo e zeraria o WeakMap.
const globalWithDecisions = globalThis as typeof globalThis & {
  __blipDecisions?: WeakMap<SessionState, string>;
};
const decisions = (globalWithDecisions.__blipDecisions ??= new WeakMap<SessionState, string>());

export function findBlipQuestion(
  session: SessionState,
  blipId: string,
): { blip: Blip; question: QueuedQuestion } | undefined {
  const blip = session.blips.find((b) => b.id === blipId);
  const question = session.queue.find((q) => q.id === blipId);
  return blip && question ? { blip, question } : undefined;
}

/**
 * Próxima dica leve do problema, ou undefined quando as dicas acabaram ou a recrutadora não quer dica.
 * Política (config.hints): "nenhuma" nunca dá; "leves" dá só uma; livres ou sem valor seguem todas as do problema.
 */
export function nextHint(session: SessionState): string | undefined {
  const politica = session.config.hints;
  if (politica === "nenhuma") return undefined;
  if (politica === "leves" && session.hintsUsed >= 1) return undefined;
  return getProblem(session.config.problemId).private.hints[session.hintsUsed];
}

/** Candidato parado em t (ms de sessão): quem decide o blip (decideBlip) usa isso. */
export function isCandidateIdle(session: SessionState, t: number): boolean {
  const last = ultimoEvento(session);
  if (last === undefined) return true;
  return IDLE_EVENT_TYPES.has(last.type) || t - last.t > IDLE_AFTER_MS;
}

/** Enfileira a pergunta de abertura quando a sessão começa. Uma por sessão (reconexão não duplica). */
export function enqueueKickoff(session: SessionState, t: number): void {
  if (session.queue.some((q) => q.kickoff)) return;
  session.queue.push({
    id: `q-${session.queue.length + 1}`,
    question: KICKOFF_QUESTION,
    followUpTopic: KICKOFF_FOLLOW_UP,
    topicLabel: KICKOFF_TOPIC_LABEL,
    priority: KICKOFF_PRIORITY,
    createdAt: t,
    status: "queued",
    kickoff: true,
  });
}

/** Ótimo momento pra blip, pelo último run ou pausa da sessão. Sem evento relevante, sem boost. */
export function momentBoost(session: SessionState): { boost: number; reason: string } {
  const last = session.events.filter((e) => e.type === "run" || e.type === "pause").at(-1);
  if (last === undefined) return NO_BOOST;

  if (last.type === "pause") {
    return last.idleMs >= LONG_PAUSE_MS ? { boost: BOOST_LONG_PAUSE, reason: "pausa longa" } : NO_BOOST;
  }
  if (!allPassed(last.result)) return { boost: BOOST_FAILED_RUN, reason: "run com falha" };

  const firstGreen = session.events.findIndex((e) => e.type === "run" && allPassed(e.result));
  return firstGreen === session.events.indexOf(last)
    ? { boost: BOOST_FIRST_GREEN_RUN, reason: "primeiro run verde" }
    : NO_BOOST;
}

/** Motivo da última decisão de blip (pro painel de debug). Atualizado a cada decideBlip. */
export function lastBlipDecision(session: SessionState): string | undefined {
  return decisions.get(session);
}

/**
 * Decide se a fila vira um blip agora (t em ms de sessão). Só levanta blip com o candidato parado
 * e sem outro blip pendente. Efeito colateral: marca a pergunta como blipped, stale ou ignored.
 * `dismissBlipId`: o balão anterior foi substituído por outro nesta chamada e a IDE deve tirá-lo da tela. Um balão
 * pendente nunca some sozinho, sem fala: o que expirou fica na tela até ser dito ou até outro tomar o lugar dele.
 */
export function decideBlip(session: SessionState, t: number): { blip?: Blip; dismissBlipId?: string } {
  if (session.fechamento) {
    decisions.set(session, "fechamento em andamento");
    return {};
  }
  const expirado = expireBlip(session, t);
  const bola = estadoDaBola(session, t);
  const { blip, reason, dismissBlipId: cedeu } = pickBlip(session, t);
  // Saiu um balão com a bola com ele, passado o silêncio: foi a quebra de silêncio deste período (uma só).
  if (blip && bola.quebraDeSilencio) session.silencioQuebradoEm = t;
  decisions.set(session, expirado ? `balão ${expirado.slice(0, 8)} expirou · ${reason}` : reason);
  return { blip, dismissBlipId: cedeu ?? (blip && expirado !== blip.id ? expirado : undefined) };
}

/**
 * Balão nunca aberto há BLIP_EXPIRY_MS vira ignorado e libera a vez de outro (pendingBlipId). Ele não sai da tela
 * aqui: a IDE ainda pode dizê-lo na próxima pausa, ou ele cede o lugar quando outro balão subir.
 */
function expireBlip(session: SessionState, t: number): string | undefined {
  const pendingId = session.pendingBlipId;
  if (pendingId === undefined) return undefined;
  const found = findBlipQuestion(session, pendingId);
  if (!found || found.question.status !== "blipped") return undefined;
  if (t - found.blip.createdAt < BLIP_EXPIRY_MS) return undefined;
  // O empecilho, a pergunta da colagem e a fala do run com falha não expiram: a IDE abre a conversa deles sozinha
  // (a do run perde o sentido sozinha quando ele roda de novo ou o Totti fala depois).
  if (found.question.kind === "empecilho" || found.question.kind === "cola" || found.question.kind === "run_falhou") return undefined;

  found.question.status = "ignored";
  session.pendingBlipId = undefined;
  // Critério da agenda ainda não explorado: a pergunta volta mais tarde, uma vez.
  const q = found.question;
  if (!q.kickoff && q.kind !== "retorno" && !isCovered(session, q.criterionId) && q.criterionId !== undefined && !q.retried) {
    session.queue.push({ ...q, id: `q-${session.queue.length + 1}`, status: "queued", snoozedUntil: t + IGNORED_RETRY_MS, retried: true });
  }
  // Abertura ignorada não conta contra o candidato: ele pode ter preferido codar.
  if (!found.question.kickoff) {
    session.evidence.push({
      t,
      criterionId: "comunicacao",
      note: `não abriu a pergunta sobre ${found.question.topicLabel ?? "o código"}`,
      source: "analyst",
    });
  }
  return pendingId;
}

function pickBlip(session: SessionState, t: number): { blip?: Blip; reason: string; dismissBlipId?: string } {
  if (session.ended) return { reason: "sessão encerrada" };
  enqueueDueCheckIns(session, t);
  // Colou um bloco: a pergunta sobre ele passa na frente de tudo, até de um assunto aberto (ver `colaNaVez`).
  const cola = session.queue.find((q) => q.kind === "cola" && q.status === "queued");
  const daCola = cola ? colaNaVez(session, cola, t) : undefined;
  if (daCola) return daCola;
  // Rodou e falhou: a fala curta sobre o resultado passa na frente das perguntas da análise (ver `runFalhouNaVez`).
  const runFalhou = session.queue.find((q) => q.kind === "run_falhou" && q.status === "queued");
  const doRun = runFalhou ? runFalhouNaVez(session, runFalhou, t) : undefined;
  if (doRun) return doRun;
  if (session.pendingBlipId) return { reason: "esperando: outro blip já aberto ou pendente" };
  const kickoff = session.queue.find((q) => q.kickoff && q.status === "queued");
  // Abertura: some se ele já foi direto pro código ou se o Totti já perguntou do plano (antes da bola: descartar não fala).
  const descartada = kickoff ? perdeuAVez(session, kickoff, t) : undefined;
  if (kickoff && descartada) {
    kickoff.status = "stale";
    return { reason: descartada };
  }
  // O silêncio é do candidato (#130, item 6): depois de uma fala do Totti, só ele devolve a vez. A colagem e o run com
  // falha acima vêm de uma ação dele, então já passaram por aqui.
  const bola = estadoDaBola(session, t);
  if (bola.espera) return { reason: `esperando: ${bola.espera}` };

  if (kickoff) {
    // Abertura: espera ele ler o enunciado e não interrompe digitação.
    if (t < KICKOFF_READING_MS) {
      return { reason: `esperando: tempo de leitura (faltam ${Math.ceil((KICKOFF_READING_MS - t) / 1000)} s)` };
    }
    const linhas = linesWrittenBeyondStarter(session);
    if (linhas < KICKOFF_MIN_LINES && t < KICKOFF_FALLBACK_MS) {
      return { reason: `esperando: abertura depois de ele começar a escrever (${linhas}/${KICKOFF_MIN_LINES} linhas)` };
    }
    const { maosParadasHaMs, falaHaMs } = momentoDaSessao(session, t);
    const pausaCurta = maosParadasHaMs >= KICKOFF_PAUSA_CURTA_MS && falaHaMs >= KICKOFF_PAUSA_CURTA_MS;
    if (!isCandidateIdle(session, t) && !pausaCurta) return { reason: "esperando: candidato digitando" };
    return { blip: raise(session, kickoff, t), reason: `blip ${kickoff.id} (abertura)` };
  }

  // Sem a trava "candidato digitando" daqui: o momento da política comum espera uma pausa e, com paciência, aceita
  // uma pausa curta, para quem digita sem parar também receber pergunta.
  // Na garantia da mudança (#130, item 15), basta a pausa curta: quem digita sem parar também a recebe.
  const momentoExtra = motivoDoMomento({ ...momentoDaSessao(session, t), marco: empecilhoGarantido(session, t) });
  // Empecilho: uma mudança no problema, uma vez por sessão, quando chegar a hora (lib/agents/empecilho.ts).
  if (esperaDoEmpecilho(session, t) === undefined && momentoExtra === null) {
    const empecilho = raiseEmpecilho(session, t);
    if (empecilho) return { blip: empecilho, reason: `blip ${empecilho.id} (empecilho)` };
  }
  // Depois do encerramento, a conversa de fechamento é a última: nenhuma pergunta nova do Analyst.
  if (session.queue.some((q) => q.kind === "encerramento" && q.status !== "queued")) return { reason: "encerramento já oferecido" };
  // O polling não decide no meio de uma análise: ela pode trazer a pergunta do momento (ex.: o run que acabou de passar).
  if (session.analyst.state === "running") return { reason: "esperando: análise em andamento" };

  const orcamento = orcamentoDeInterrupcoes(session.config.durationMin);
  // O orçamento não barra o retorno de um desafio que o candidato topou: ele fecha um assunto aberto.
  const overLimit = baloesNoOrcamento(session) >= orcamento;
  // Muito tempo sem interromper (e com cota livre): uma pergunta um pouco menos forte já vale.
  const threshold = BLIP_THRESHOLD - (interrupcaoAtrasada(ritmoDaSessao(session, t)) ? DESCONTO_ATRASO : 0);

  const { boost, reason: boostReason } = momentBoost(session);
  const candidates = session.queue
    .filter((q) => q.status === "queued" && !isSnoozed(q, t) && q.kind !== "cola" && q.kind !== "run_falhou")
    .filter((q) => !overLimit || q.kind === "retorno")
    .filter((q) => q.priority + boost + agendaBoost(session, q, t) >= threshold)
    // Momento-chave primeiro (o candidato tem certeza que há o que falar), depois a prioridade.
    .sort(
      (a, b) =>
        Number(b.keyMoment !== undefined) - Number(a.keyMoment !== undefined) ||
        b.priority + (b.focusArea ? FOCUS_QUESTION_BONUS : 0) - (a.priority + (a.focusArea ? FOCUS_QUESTION_BONUS : 0)),
    );
  if (candidates.length === 0) {
    if (overLimit) return { reason: `orçamento de ${orcamento} balões usado` };
    const waiting = session.queue.filter((q) => q.status === "queued");
    if (waiting.length === 0) return { reason: "sem pergunta na fila" };
    const snoozed = waiting.filter((q) => isSnoozed(q, t));
    if (snoozed.length === waiting.length) {
      const backAt = Math.min(...snoozed.map((q) => q.snoozedUntil ?? t));
      return { reason: `esperando: pergunta adiada (volta em ${Math.ceil((backAt - t) / 1000)} s)` };
    }
    return { reason: `esperando: nenhuma pergunta acima de ${threshold.toFixed(2)}` };
  }

  // Uma pergunta que precisa esperar (ex.: a de foco, que só sai com o código funcionando) não segura as outras:
  // segue para a próxima da fila. Se nenhuma pode sair, o motivo é o da primeira.
  let primeiraEspera: string | undefined;
  for (const q of candidates) {
    if (isStale(session, q, t)) {
      q.status = "stale";
      continue;
    }
    const wait = waitReason(session, t, q);
    if (wait !== undefined) {
      primeiraEspera ??= wait;
      continue;
    }
    const agenda = agendaBoost(session, q, t);
    const label =
      (boost > 0 ? ` (boost +${boost.toFixed(2)}: ${boostReason})` : "") + (agenda > 0 ? ` (agenda +${agenda.toFixed(2)})` : "");
    return { blip: raise(session, q, t), reason: `blip ${q.id}${label}` };
  }
  return { reason: primeiraEspera ?? "sem pergunta válida na fila (todas obsoletas)" };
}

/** Reforço de agenda: critério da recrutadora ainda não explorado, depois de parte do tempo. */
function agendaBoost(session: SessionState, q: QueuedQuestion, t: number): number {
  if (q.criterionId === undefined || isCovered(session, q.criterionId)) return 0;
  return t >= session.config.durationMin * 60_000 * AGENDA_START_FRACTION ? BOOST_UNCOVERED : 0;
}


/** Perguntas preparadas que entram no encerramento, no máximo. */
const CLOSING_MAX_QUESTIONS = 2;
/**
 * Pontos do encerramento, no máximo (perguntas preparadas mais critérios sem evidência). Com todos os critérios
 * pendentes viravam cinco, seis perguntas com o candidato querendo sair.
 */
const CLOSING_MAX_TOPICS = 2;
/** Faltando esse tempo, o agente oferece o encerramento sozinho (com o que ficou pendente), sem esperar o Finalizar. */

/**
 * O candidato pediu para finalizar: junta o que ficou pendente (a pergunta do balão na tela, as melhores da
 * fila e os critérios da vaga ainda não explorados) numa última conversa e devolve o balão dela, que a IDE
 * abre direto. Sem nada pendente, devolve undefined e a sessão pode encerrar.
 */
export function startClosing(session: SessionState, t: number): Blip | undefined {
  if (session.ended) return undefined;
  // Encerramento já no balão (o oferecido no fim do tempo): o Finalizar abre esse mesmo.
  const existing = session.queue.find((q) => q.kind === "encerramento" && q.status === "blipped");
  if (existing) return session.blips.find((b) => b.id === existing.id);

  const onScreen = session.pendingBlipId ? findBlipQuestion(session, session.pendingBlipId)?.question : undefined;
  const fromQueue = session.queue
    .filter((q) => q.status === "queued" && !q.kickoff && q.kind !== "run_falhou" && q !== onScreen && !isStale(session, q, t))
    .sort((a, b) => b.priority - a.priority);
  // A pergunta que estava na tela só entra se ainda faz sentido (um teste que já passou, um trecho que mudou: não).
  const pending = onScreen?.status === "blipped" && !onScreen.kickoff && onScreen.kind !== "run_falhou" && !isStale(session, onScreen, t) ? [onScreen, ...fromQueue] : fromQueue;
  // Os poucos pontos do encerramento vão para o que ainda não foi explorado: uma pergunta preparada sobre um
  // critério já coberto repetia o assunto (medido: complexidade perguntada três vezes, bordas nenhuma).
  const naoCobertos = new Set(uncoveredCriteria(session));
  // Um bloco colado que ele ainda não explicou vem primeiro, sempre: numa sessão real ele colou a solução, clicou
  // em Finalizar 7 s depois e o encerramento perguntou do plano inicial, sem tocar na colagem.
  const colas = colasSemExplicacao(session);
  const prepared = pending.filter((q) => q.kind !== "cola" && (q.criterionId === undefined || naoCobertos.has(q.criterionId))).slice(0, CLOSING_MAX_QUESTIONS);
  const askedCriteria = new Set(prepared.map((q) => q.criterionId));
  const criteria = uncoveredCriteria(session)
    .filter((id) => !askedCriteria.has(id))
    .map((id) => session.config.criteria.find((c) => c.id === id)!)
    .map((c) => {
      // O que ele já mostrou nesse critério vai junto: sem isso o encerramento perguntava de novo o plano que ele
      // tinha contado no começo ("como você pensou na abordagem antes de começar?").
      const jaMostrou = session.evidence.filter((e) => e.criterionId === c.id).slice(-2).map((e) => e.note);
      return `critério ${c.id} (${c.name}): ${c.description}${jaMostrou.length ? ` [ele já mostrou: ${jaMostrou.join("; ")}. Não pergunte isso de novo: pergunte outra coisa do critério, sobre o código de agora]` : ""}`;
    });
  // Abordagem pior que a melhor conhecida ou justificativa fraca: a pergunta de revisão é o primeiro ponto.
  const revisao = abordagemParaRever(session) ? [`revisão da abordagem [sem linhas]: ${PERGUNTA_DE_REVISAO}`] : [];
  const topics = [
    ...revisao,
    ...colas.map((q) => `trecho colado${q.highlight ? ` [linhas ${q.highlight.startLine}-${q.highlight.endLine}]` : " [sem linhas]"}: ele colou ${q.cola?.linhas ?? "várias"} linhas de uma vez${q.cola?.substituiu ? ", no lugar do que vinha escrevendo," : ""} e ainda não explicou. Pergunte de onde veio e peça para ele explicar o que o trecho faz.`),
    // Cada ponto leva as próprias linhas: com uma linha só para a conversa toda, o grifo da pergunta seguinte
    // aparecia na primeira (que não era sobre código) e a seguinte falava de "esse trecho grifado" sem grifar.
    ...prepared.map((q) => `pergunta preparada${q.criterionId ? ` (critério ${q.criterionId})` : ""}${q.highlight ? ` [linhas ${q.highlight.startLine}-${q.highlight.endLine}]` : " [sem linhas]"}: ${q.question}`),
    ...criteria,
  ].slice(0, CLOSING_MAX_TOPICS);
  if (topics.length === 0) return undefined;

  // O que entrou no encerramento sai da fila; o balão que estava na tela vira esta conversa.
  for (const q of prepared) q.status = "stale";
  // A colagem que entrou no encerramento não volta como pergunta solta (a já feita e sem resposta fica como está).
  for (const q of colas) if (q.status !== "asked") q.status = "stale";
  session.pendingBlipId = undefined;
  const closing: QueuedQuestion = {
    id: `q-${session.queue.length + 1}`,
    question: prepared[0]?.question ?? "Antes de você encerrar, queria fechar uns pontos rápidos com você.",
    followUpTopic: "os pontos que ficaram pendentes",
    topicLabel: "uns pontos antes de encerrar",
    priority: 1,
    // O grifo de cada ponto vai no texto do ponto (closingTopics), não na conversa inteira.
    createdAt: t,
    status: "queued",
    kind: "encerramento",
    closingTopics: topics,
  };
  session.queue.push(closing);
  return raise(session, closing, t);
}

/** Cria a conversa real do fechamento quando o núcleo ainda precisa perguntar a última palavra. */
export function criarBlipEncerramento(session: SessionState, t: number): Blip {
  const existente = session.fechamentoBlipId && session.blips.find((b) => b.id === session.fechamentoBlipId);
  if (existente) return existente;
  const q: QueuedQuestion = {
    id: `q-${session.queue.length + 1}`,
    question: session.fechamento?.fila[0]?.pergunta ?? "Antes de encerrar, quer acrescentar alguma coisa?",
    followUpTopic: "os pontos finais da conversa",
    topicLabel: "fechamento da conversa",
    priority: 1,
    createdAt: t,
    status: "queued",
    kind: "encerramento",
    closingTopics: session.fechamento?.fila.map((item) => item.pergunta) ?? [],
  };
  session.queue.push(q);
  return raise(session, q, t);
}

/** Põe o empecilho da questão no balão. A primeira fala da conversa é o anúncio (lib/agents/interviewer.ts). */
function raiseEmpecilho(session: SessionState, t: number): Blip | undefined {
  const empecilho = empecilhoDaQuestao(session);
  if (!empecilho || session.empecilho) return undefined;
  const q: QueuedQuestion = {
    id: `q-${session.queue.length + 1}`,
    question: empecilho.announcement,
    followUpTopic: "as dúvidas dele sobre a mudança",
    topicLabel: "uma mudança no problema",
    priority: 1,
    createdAt: t,
    status: "queued",
    kind: "empecilho",
  };
  session.queue.push(q);
  session.empecilho = { id: empecilho.id, blipId: q.id, raisedAt: t };
  return raise(session, q, t);
}

/**
 * Teste e demo: solta o empecilho agora, sem esperar a janela de tempo. Um balão ainda não aberto volta para a
 * fila (e sai da tela pelo `dismissBlipId`); com uma conversa aberta, não dá.
 */
export function forceEmpecilho(session: SessionState, t: number): { blip?: Blip; dismissBlipId?: string; reason: string } {
  if (session.ended) return { reason: "sessão encerrada" };
  if (session.empecilho) return { reason: "empecilho já saiu nesta sessão" };
  if (!empecilhoDaQuestao(session)) return { reason: "questão sem empecilho" };
  let dismissBlipId: string | undefined;
  if (session.pendingBlipId) {
    const found = findBlipQuestion(session, session.pendingBlipId);
    if (found?.question.status !== "blipped") return { reason: "conversa aberta: feche antes" };
    found.question.status = "queued";
    dismissBlipId = session.pendingBlipId;
    session.pendingBlipId = undefined;
  }
  const blip = raiseEmpecilho(session, t);
  return { blip, dismissBlipId, reason: blip ? `blip ${blip.id} (empecilho forçado)` : "não deu para soltar" };
}

/**
 * Desafio topado vira pergunta de retorno quando chega a hora, o que vier primeiro:
 * rodou depois de mexer no código; mexeu e ficou 30 s parado; passaram 4 min; ou faltam 5 min.
 */
function enqueueDueCheckIns(session: SessionState, t: number): void {
  for (const checkIn of session.checkIns) {
    if (checkIn.status !== "aguardando") continue;
    const changed = session.codeHistory.filter((v) => v.t > checkIn.createdAt && v.version > checkIn.versionAtStart);
    const lastChange = changed.at(-1);
    // Na mudança do empecilho, um run qualquer não basta: ele volta quando os testes da mudança passarem.
    const ranAfterChange =
      checkIn.empecilhoId !== undefined
        ? primeiraAdaptacao(session) !== undefined
        : lastChange !== undefined && session.events.some((e) => e.type === "run" && e.t >= lastChange.t);
    const idleAfterChange = lastChange !== undefined && t - lastChange.t >= CHECK_IN_IDLE_MS && isCandidateIdle(session, t);
    const waitedLong = t - checkIn.createdAt >= escalado(session, CHECK_IN_MAX_WAIT_MS);
    // Perto do fim volta de qualquer jeito, mas nunca logo depois de ele topar: precisa de tempo para tentar.
    const endingSoon = session.config.durationMin * 60_000 - t <= escalado(session, CHECK_IN_BEFORE_END_MS)
      && t - checkIn.createdAt >= CHECK_IN_IDLE_MS * 2;
    if (!ranAfterChange && !idleAfterChange && !waitedLong && !endingSoon) continue;

    checkIn.status = "na_fila";
    const mudanca = checkIn.empecilhoId !== undefined;
    session.queue.push({
      id: `q-${session.queue.length + 1}`,
      question: mudanca
        ? "E aí, como ficou com a mudança? O que você teve que mexer?"
        : `E aí, como foi com o desafio de ${checkIn.challenge}? O que você pensou?`,
      followUpTopic: mudanca
        ? "o que ele mudou no código por causa da mudança e por quê"
        : `o que ele tentou ou pensou para ${checkIn.challenge}`,
      topicLabel: mudanca ? "como ficou a mudança" : "como foi o desafio",
      priority: 0.95,
      createdAt: t,
      status: "queued",
      // Como momento-chave: passa na frente e pula o intervalo entre blips.
      keyMoment: mudanca ? "retorno da mudança que o entrevistador trouxe" : "retorno de um desafio que o candidato topou",
      kind: "retorno",
      criterionId: checkIn.criterionId,
      checkInId: checkIn.id,
    });
  }
}

type RunEvent = Extract<SessionEvent, { type: "run" }>;

/**
 * Rodou e falhou: entra na fila, sem LLM, a fala curta sobre o resultado (uma por run; um run novo troca a anterior,
 * que ainda não saiu). Fora do orçamento e do intervalo: o candidato acabou de ver o resultado. Devolve true se entrou.
 */
export function enqueueRunFalhou(session: SessionState, event: RunEvent): boolean {
  if (session.ended || allPassed(event.result) || session.fechamento) return false;
  if (session.queue.some((q) => q.kind === "encerramento")) return false;
  for (const q of session.queue) if (q.kind === "run_falhou" && q.status === "queued") q.status = "stale";
  // Uma frase diferente a cada vez que uma delas foi dita (ou está na tela).
  const ditas = session.queue.filter((q) => q.kind === "run_falhou" && (q.status === "asked" || q.status === "blipped")).length;
  session.queue.push({
    id: `q-${session.queue.length + 1}`,
    question: FALAS_DO_RUN_FALHOU[ditas % FALAS_DO_RUN_FALHOU.length],
    followUpTopic: "o que ele esperava do resultado e o que está olhando para entender a diferença, sem apontar erro, linha ou caso",
    topicLabel: "o resultado do teste",
    priority: 1,
    createdAt: event.t,
    status: "queued",
    kind: "run_falhou",
    fase: "depurando",
  });
  return true;
}

/** A fala do run com falha perdeu o sentido: ele rodou de novo, ou o Totti já falou alguma coisa depois do run. */
function runFalhouPassou(session: SessionState, q: QueuedQuestion): string | undefined {
  if (session.events.some((e) => e.type === "run" && e.t > q.createdAt)) return "rodou de novo depois";
  if (session.events.some((e) => e.type === "speech" && e.role === "agent" && e.t > q.createdAt)) return "o Totti já falou depois do run";
  return undefined;
}

/**
 * A fala do run com falha na vez dela: só espera ele tirar a mão do teclado e não estar falando (como a colagem).
 * Um balão ainda não aberto cede o lugar (sai da tela pelo `dismissBlipId` e volta para a fila); com uma conversa
 * aberta ela espera, porque o Totti já está falando com ele. Devolve undefined quando não é com ela.
 */
function runFalhouNaVez(session: SessionState, q: QueuedQuestion, t: number): { blip?: Blip; reason: string; dismissBlipId?: string } | undefined {
  if (runFalhouPassou(session, q)) {
    q.status = "stale";
    return undefined;
  }
  if (session.queue.some((x) => x.kind === "encerramento")) return undefined;
  const naTela = session.pendingBlipId ? findBlipQuestion(session, session.pendingBlipId)?.question : undefined;
  if (naTela && (naTela.status !== "blipped" || naTela.kind === "empecilho" || naTela.kind === "cola")) {
    return { reason: "esperando (fala do run com falha): conversa aberta" };
  }
  const momento = motivoDoMomento({ ...momentoDaSessao(session, t), marco: true });
  if (momento) return { reason: `esperando (fala do run com falha): ${momento}` };
  let dismissBlipId: string | undefined;
  if (naTela) {
    naTela.status = "queued";
    dismissBlipId = naTela.id;
  }
  session.pendingBlipId = undefined;
  return { blip: raise(session, q, t), dismissBlipId, reason: `blip ${q.id} (run com falha)` };
}

/** Ordem das complexidades de tempo ("O(n log n)", "O(n²)"), da melhor (1) para a pior. Sem reconhecer: undefined. */
export function ordemDaComplexidade(texto: string | undefined): number | undefined {
  const m = texto?.toLowerCase().replace(/\s+/g, "").replace(/²/g, "^2").replace(/³/g, "^3").match(/o\(((?:[^()]|\([^()]*\))*)\)/);
  if (!m) return undefined;
  const dentro = m[1].replace(/[*·×]/g, "").replace(/log\(([a-z])\)/g, "log$1");
  const tabela: [RegExp, number][] = [
    [/^(2\^n|n!|k\^n)$/, 7],
    [/^n\^3$/, 6],
    [/^(n\^2|nn|n\^2logn|nm|mn)$/, 5],
    [/^(nlogn|nlogk|klogn)$/, 4],
    [/^(n|n\+k|n\+m|m\+n|k\+n)$/, 3],
    [/^logn$/, 2],
    [/^1$/, 1],
  ];
  return tabela.find(([re]) => re.test(dentro))?.[1];
}

/**
 * Vale a pergunta de revisão no fechamento: a análise viu uma complexidade de tempo pior que a da melhor abordagem
 * conhecida da questão, ou a justificativa dele sobre a abordagem saiu fraca (parcial, errada, sem conseguir). Se a
 * pergunta já foi feita, não.
 */
export function abordagemParaRever(session: SessionState): boolean {
  const jaFeita = session.events.some((e) => e.type === "speech" && e.role === "agent" && /mudaria alguma coisa na abordagem/i.test(e.text));
  if (jaFeita) return false;
  const melhor = Math.min(...getProblem(session.config.problemId).private.approaches.map((a) => ordemDaComplexidade(a.time) ?? Infinity));
  const dele = ordemDaComplexidade(session.analyst.insights?.timeComplexity);
  if (dele !== undefined && Number.isFinite(melhor) && dele > melhor) return true;
  const fracos = new Set(["parcial", "errou", "nao_conseguiu"]);
  return (session.coverage.abordagem?.outcomes ?? []).some((o) => fracos.has(o.kind));
}

type PasteEvent = Extract<SessionEvent, { type: "paste" }>;

const linhasComConteudo = (texto: string) => texto.split("\n").map((l) => l.trim()).filter(Boolean);

/**
 * Ele colou um bloco de código: entra na fila, na hora e sem LLM, a pergunta sobre ele (de onde veio e como funciona).
 * A fala em si é escrita pelo entrevistador olhando o código (lib/agents/interviewer.ts); o texto daqui é a reserva.
 * Devolve true se a colagem virou pergunta. Código dele mesmo movido de lugar não conta.
 */
export function enqueueCola(session: SessionState, event: PasteEvent): boolean {
  if (session.ended || event.lines < COLA_MIN_LINES) return false;
  // Já na conversa de encerramento: não cabe assunto novo.
  if (session.queue.some((q) => q.kind === "encerramento")) return false;
  const code = latestCode(session);
  const linhas = code.split("\n");
  const inicio = Math.min(Math.max(1, event.startLine), linhas.length);
  const fim = Math.min(linhas.length, inicio + event.lines - 1);
  const trecho = linhas.slice(inicio - 1, fim).join("\n");
  const coladas = linhasComConteudo(trecho);
  if (coladas.length < COLA_MIN_LINES) return false;

  const starter = getProblem(session.config.problemId).public.starters[session.language] ?? "";
  // A versão de antes da colagem: a última diferente do código de agora (o snapshot com o bloco chega antes do evento).
  const anterior = session.codeHistory.findLast((v) => v.code !== code)?.code ?? starter;
  const tinha = new Set(linhasComConteudo(anterior));
  if (coladas.filter((l) => tinha.has(l)).length / coladas.length >= COLA_FRACAO_JA_EXISTENTE) return false;

  const doStarter = new Set(linhasComConteudo(starter));
  const dele = linhasComConteudo(anterior).filter((l) => !doStarter.has(l));
  const agora = new Set(linhasComConteudo(code));
  const substituiu = dele.length >= 2 && dele.filter((l) => agora.has(l)).length / dele.length < 0.5;
  const cola: Cola = { trecho, linhas: event.lines, antes: dele.join("\n"), substituiu };
  const dados = {
    question: substituiu
      ? "Esse trecho entrou de uma vez e é bem diferente do que você vinha escrevendo. De onde ele veio, e como ele funciona?"
      : "Esse trecho entrou de uma vez. De onde ele veio, e o que ele faz, parte por parte?",
    highlight: { startLine: inicio, endLine: Math.min(fim, inicio + COLA_MAX_LINHAS_GRIFO - 1) },
    keyMoment: `colou ${event.lines} linhas de uma vez`,
    cola,
  };
  // Colou de novo antes de a pergunta sair: a mesma pergunta, agora sobre o bloco novo.
  const naFila = session.queue.find((q) => q.kind === "cola" && q.status === "queued");
  if (naFila) {
    Object.assign(naFila, dados);
    return true;
  }
  session.queue.push({
    id: `q-${session.queue.length + 1}`,
    followUpTopic: "se ele entende o trecho que colou: de onde veio, o que cada parte faz e por que resolve o problema, com as palavras dele",
    topicLabel: "o trecho que você colou",
    priority: 1,
    createdAt: event.t,
    status: "queued",
    kind: "cola",
    fase: faseDaEntrevista(session),
    ...dados,
  });
  return true;
}

/** O trecho colado saiu do código (ele apagou ou reescreveu quase tudo): a pergunta sobre ele perde o sentido. */
function colaSumiu(session: SessionState, q: QueuedQuestion): boolean {
  if (!q.cola) return false;
  const coladas = linhasComConteudo(q.cola.trecho);
  if (coladas.length === 0) return true;
  const agora = new Set(linhasComConteudo(latestCode(session)));
  return coladas.filter((l) => agora.has(l)).length / coladas.length < COLA_FRACAO_QUE_FICOU;
}

/** Colagens que ainda estão no código e que ele não explicou: nunca perguntadas, ou perguntadas e sem resposta. */
function colasSemExplicacao(session: SessionState): QueuedQuestion[] {
  const respondeu = (id: string) => session.events.some((e) => e.type === "speech" && e.role === "candidate" && e.blipId === id);
  return session.queue.filter(
    (q) => q.kind === "cola" && !colaSumiu(session, q) && (q.status === "queued" || q.status === "blipped" || (q.status === "asked" && !respondeu(q.id))),
  );
}

/**
 * A pergunta da colagem na vez dela. Fora do orçamento e do intervalo (como a mudança no problema): só espera ele
 * tirar a mão do teclado e não estar falando. Um balão ainda não aberto cede o lugar; com um assunto aberto, ela sai
 * assim mesmo e a IDE fecha o outro se o Totti estava só esperando resposta (`passaNaFrente`). Devolve undefined
 * quando não é com ela (encerramento em curso, mudança no problema na tela): a decisão segue o caminho normal.
 */
function colaNaVez(session: SessionState, cola: QueuedQuestion, t: number): { blip?: Blip; reason: string; dismissBlipId?: string } | undefined {
  if (colaSumiu(session, cola)) {
    cola.status = "stale";
    return undefined;
  }
  if (session.queue.some((q) => q.kind === "encerramento")) return undefined;
  const naTela = session.pendingBlipId ? findBlipQuestion(session, session.pendingBlipId)?.question : undefined;
  if (naTela?.kind === "empecilho" || naTela?.kind === "cola") return undefined;
  const momento = motivoDoMomento({ ...momentoDaSessao(session, t), marco: true });
  if (momento) return { reason: `esperando (pergunta da colagem): ${momento}` };

  let dismissBlipId: string | undefined;
  if (naTela?.status === "blipped") {
    naTela.status = "stale";
    dismissBlipId = naTela.id;
  }
  // Ele colou a solução antes da abertura: a pergunta da colagem é a abertura que faz sentido agora.
  for (const q of session.queue) if (q.kickoff && q.status === "queued") q.status = "stale";
  session.pendingBlipId = undefined;
  return { blip: raise(session, cola, t), dismissBlipId, reason: `blip ${cola.id} (colagem)` };
}

/** Pergunta adiada pelo candidato ("agora não") que ainda não voltou. */
function isSnoozed(q: QueuedQuestion, t: number): boolean {
  return q.snoozedUntil !== undefined && q.snoozedUntil > t;
}

/** Motivo de espera pelo ritmo (aquecimento e intervalos), ou undefined se já pode aparecer. */
function waitReason(session: SessionState, t: number, q: QueuedQuestion): string | undefined {
  if (t < WARMUP_MS) return `esperando: aquecimento (faltam ${Math.ceil((WARMUP_MS - t) / 1000)} s)`;

  // Cada fase tem seu ritmo: não corta quem está escrevendo a primeira versão nem quem está no meio de uma melhoria.
  const fase = faseDaEntrevista(session);
  // Antes da primeira linha de código, a conversa sobre o plano é da abertura: perguntas da análise ali viravam
  // um interrogatório (custo, bordas, tempo) antes de ele poder começar.
  if (fase === "entendendo" && (q.kind === undefined || q.kind === "explicar" || q.kind === "sondar" || q.kind === "desafio") && q.keyMoment === undefined && session.config.durationMin * 60_000 - t > retaFinalMs(session)) {
    return "esperando: ele ainda não começou a codar (a conversa do plano é da abertura)";
  }
  // Pergunta de foco (processo, sem código) não corta quem ainda está fazendo o código funcionar.
  if (q.focusArea !== undefined && (fase === "implementando" || fase === "depurando") && session.config.durationMin * 60_000 - t > retaFinalMs(session)) {
    return `esperando: pergunta de foco só depois que o código funcionar (fase ${fase})`;
  }
  // Política comum (lib/interrupcao/politica.ts). Marco: ele acabou de chegar num ponto natural de conversa (ou é
  // o retorno de um desafio que topou). Momento: pausa real, curta depois de marco ou quando a pergunta já esperou
  // (quem digita sem parar também é perguntado), longa mexendo numa melhoria. Ritmo: orçamento, cota e intervalo.
  const exempt = q.kind === "retorno" || q.keyMoment !== undefined;
  const ritmo = ritmoDaSessao(session, t, exempt);
  const momento = motivoDoMomento({
    ...momentoDaSessao(session, t),
    marco: exempt,
    focado: fase === "otimizando",
    esperandoHaMs: t - q.createdAt,
    atrasada: interrupcaoAtrasada(ritmo),
  });
  if (momento) return `esperando: ${momento}`;
  // O retorno fica fora do orçamento e da cota (fecha um assunto aberto), mas respeita o respiro.
  const motivo = motivoDoRitmo(q.kind === "retorno" ? { ...ritmo, feitas: 0 } : ritmo);
  if (motivo) return `esperando: ${motivo.texto}`;
  // Pergunta por conteúdo, não por evento (#130, item 11): parte fechada e piso, ou o teto.
  const conteudo = motivoDoConteudo(session, q, t);
  if (conteudo) return `esperando: ${conteudo}`;
  const lastBlip = session.blips.at(-1);
  // Escrevendo a primeira versão: escreveu uma linha e já vinha outra pergunta. Ele precisa avançar no código antes.
  if (fase === "implementando" && !exempt && lastBlip) {
    const novas = linhasNovasDesde(session, lastBlip.createdAt);
    if (novas < MIN_NEW_LINES_BETWEEN_QUESTIONS) {
      return `esperando: ${novas} linha(s) nova(s) desde a última pergunta (mín. ${MIN_NEW_LINES_BETWEEN_QUESTIONS})`;
    }
  }
  return undefined;
}

/** A última ação do candidato: mudou o código, colou, rodou ou falou (fala gravada na linha do tempo). */
function ultimaAcaoDoCandidato(session: SessionState): number | undefined {
  // O primeiro snapshot pode ser só o código inicial que a IDE carregou: esse não é ação dele.
  const inicial = (getProblem(session.config.problemId).public.starters[session.language] ?? "").trim();
  const pedido = session.pediuTempoEm;
  // A fala do pedido de tempo chega à linha do tempo depois da resposta do servidor (que marca `pediuTempoEm`): ela é o
  // próprio pedido, não uma ação nova que devolve a vez ao Totti.
  const ecoDoPedido = (t: number) => pedido !== undefined && t >= pedido && t - pedido < ECO_DO_PEDIDO_DE_TEMPO_MS;
  const acao = session.events.findLast((e) =>
    e.type === "paste" || e.type === "run" || (e.type === "speech" && e.role === "candidate" && !ecoDoPedido(e.t)) || (e.type === "snapshot" && e.code.trim() !== inicial));
  return acao?.t;
}

/** Janela em que a fala do candidato logo depois do pedido de tempo é o eco do próprio pedido. */
const ECO_DO_PEDIDO_DE_TEMPO_MS = 15_000;

/** A última fala do Totti, contando o pedido de tempo dele como fala do Totti (#130, item 7). */
function ultimaFalaDoTotti(session: SessionState): number | undefined {
  const fala = session.events.findLast((e) => e.type === "speech" && e.role === "agent")?.t;
  const pedido = session.pediuTempoEm;
  if (fala === undefined) return pedido;
  return pedido === undefined ? fala : Math.max(fala, pedido);
}

/**
 * Regra da bola (#130, item 6; no quadro, `motivoBloqueioPlin`): depois de uma fala do Totti, a bola é do candidato até
 * ele digitar, colar, rodar ou falar. Sem nenhuma ação dele, o Totti quebra o silêncio uma vez, passados
 * SILENCIO_SEM_ACAO_S, e depois espera de novo até ele agir. `espera`: o motivo para não falar agora.
 */
export function estadoDaBola(session: SessionState, t: number): { espera?: string; quebraDeSilencio: boolean } {
  const fala = ultimaFalaDoTotti(session);
  const acao = ultimaAcaoDoCandidato(session);
  if (fala === undefined || (acao !== undefined && acao > fala)) return { quebraDeSilencio: false };
  if (session.silencioQuebradoEm !== undefined && (acao === undefined || session.silencioQuebradoEm > acao)) {
    return { espera: "a bola está com ele (o silêncio já foi quebrado; espera ele digitar ou falar)", quebraDeSilencio: false };
  }
  const silencioMs = t - fala;
  if (silencioMs >= SILENCIO_SEM_ACAO_S * 1000) return { quebraDeSilencio: true };
  return { espera: `a bola está com ele (silêncio há ${Math.floor(silencioMs / 1000)} s; quebra aos ${SILENCIO_SEM_ACAO_S} s)`, quebraDeSilencio: false };
}

/** Pergunta que nasce da análise do código (não abertura, retorno, mudança, colagem, run com falha ou encerramento). */
function daAnalise(q: Pick<QueuedQuestion, "kickoff" | "kind">): boolean {
  return !q.kickoff && (q.kind === undefined || q.kind === "explicar" || q.kind === "sondar" || q.kind === "desafio");
}

/** Quando saiu a última pergunta da análise (balão de uma pergunta dela), se saiu. */
function ultimaPerguntaDaAnaliseEm(session: SessionState): number | undefined {
  return session.blips.findLast((b) => {
    const q = session.queue.find((x) => x.id === b.id);
    return q !== undefined && daAnalise(q);
  })?.createdAt;
}

/**
 * O teto do ritmo por conteúdo venceu: RITMO_IDE.tetoSemPerguntaMs desde a última pergunta da análise (ou, sem
 * nenhuma, desde o começo) e há código novo desde então. Aí a pergunta sai sem parte fechada, e a análise é
 * cobrada a trazer uma (`semPerguntaHa` no prompt).
 */
export function tetoDaPerguntaNaIde(session: SessionState, t: number): boolean {
  const referencia = ultimaPerguntaDaAnaliseEm(session) ?? 0;
  if (t - referencia < RITMO_IDE.tetoSemPerguntaMs) return false;
  return linhasNovasDesde(session, referencia) > 0;
}

/**
 * Ritmo por conteúdo (#130, item 11; no quadro, `motivoDoConteudo`): por que uma pergunta da análise NÃO vira balão
 * agora (undefined = pode). Vira quando:
 * (a) a análise viu um trecho coerente pronto (`parteFechada`) e passou o piso entre perguntas; ou
 * (b) o teto venceu e há código novo; ou
 * (c) é um marco (momento-chave como o primeiro run verde, ou ele acabou de dizer que concluiu uma etapa) ou a quebra
 *     de silêncio (mãos paradas e calado há RITMO_IDE.quebraDeSilencioMs).
 * Os portões do ritmo comum (orçamento, cota, intervalo, momento) continuam valendo por cima.
 */
export function motivoDoConteudo(session: SessionState, q: QueuedQuestion, t: number): string | undefined {
  if (!daAnalise(q) || q.keyMoment !== undefined) return undefined;
  if (session.ultimaConclusaoEm !== undefined && t - session.ultimaConclusaoEm < RITMO.marcoDeConclusaoMs) return undefined;
  const { maosParadasHaMs, falaHaMs } = momentoDaSessao(session, t);
  if (maosParadasHaMs >= RITMO_IDE.quebraDeSilencioMs && falaHaMs >= RITMO_IDE.quebraDeSilencioMs) return undefined;
  const ultima = ultimaPerguntaDaAnaliseEm(session);
  const pisoPassou = ultima === undefined || t - ultima >= RITMO_IDE.pisoEntrePerguntasMs;
  if (q.parteFechada && pisoPassou) return undefined;
  if (tetoDaPerguntaNaIde(session, t)) return undefined;
  if (q.parteFechada) return `piso entre perguntas (faltam ${Math.ceil((RITMO_IDE.pisoEntrePerguntasMs - (t - (ultima ?? 0))) / 1000)} s)`;
  return "nenhum trecho pronto ainda (a pergunta sai quando ele fechar uma parte ou no teto)";
}

/**
 * Pergunta que perdeu o sentido: ela esperou demais, as linhas grifadas mudaram, ou nasceu num momento que
 * já passou. Só duas fases "passam": quem saiu de depurando já não está olhando aquele teste falhando, e quem
 * saiu de entendendo já tem código. Uma pergunta sobre o código feita escrevendo continua valendo depois que
 * ele funciona (a checagem das linhas cuida de quando o trecho mudou). Retorno de desafio, pergunta de foco e
 * pergunta adiada pelo candidato não envelhecem pelo tempo.
 */
function isStale(session: SessionState, q: QueuedQuestion, t: number): boolean {
  // A pergunta da colagem só perde o sentido se ele tirou o trecho do código.
  if (q.kind === "cola") return colaSumiu(session, q);
  if (q.kind === "run_falhou") return runFalhouPassou(session, q) !== undefined;
  const ageless = q.kind === "retorno" || q.focusArea !== undefined || q.snoozedUntil !== undefined;
  if (!ageless) {
    const momentPassed = (q.fase === "depurando" || q.fase === "entendendo") && q.fase !== faseDaEntrevista(session);
    if (momentPassed || t - q.createdAt > QUESTION_MAX_AGE_MS) return true;
    // Ele falou depois de a pergunta nascer: pode já ter explicado isso. A análise seguinte, que leu a fala, decide
    // de novo (perguntar o que ele acabou de explicar era o "ele pergunta a mesma coisa de novo").
    if (falouDepois(session, q.createdAt)) return true;
  }
  if (q.kind !== "retorno" && q.kind !== "encerramento" && q.kind !== "empecilho" && jaFoiPerguntada(session, q)) return true;
  return linesChanged(session, q);
}

/** O candidato fez uma fala de verdade (não um "tá") depois de `t`. */
function falouDepois(session: SessionState, t: number): boolean {
  return session.events.some(
    (e) => e.type === "speech" && e.role === "candidate" && e.t > t && e.text.split(/\s+/).filter(Boolean).length >= SPEECH_MAKES_STALE_WORDS,
  );
}

const palavrasDe = (texto: string) => new Set(texto.toLowerCase().match(/[a-zà-ú0-9_]{4,}/g) ?? []);

/** Uma pergunta quase igual já foi feita ao candidato (pela análise ou pelo entrevistador numa conversa). */
function jaFoiPerguntada(session: SessionState, q: QueuedQuestion): boolean {
  const nova = palavrasDe(q.question);
  if (nova.size < 3) return false;
  const feitas = session.events.flatMap((e) => (e.type === "speech" && e.role === "agent" && e.text.includes("?") ? [e.text] : []));
  return feitas.some((f) => {
    const antiga = palavrasDe(f);
    const comuns = [...nova].filter((p) => antiga.has(p)).length;
    return comuns / nova.size >= 0.6;
  });
}

/** Balões que contam no orçamento: fora abertura, encerramento, mudança no problema, colagem e run com falha. */
function baloesNoOrcamento(session: SessionState): number {
  return session.blips.filter((b) => {
    const q = session.queue.find((x) => x.id === b.id);
    return !q?.kickoff && q?.kind !== "encerramento" && q?.kind !== "empecilho" && q?.kind !== "cola" && q?.kind !== "run_falhou";
  }).length;
}

/** Situação da sessão para o ritmo da política comum. A última conversa inclui qualquer fala dos dois. */
export function ritmoDaSessao(session: SessionState, t: number, marco = false): Ritmo {
  return {
    agora: t,
    inicioEm: 0,
    duracaoMin: session.config.durationMin,
    feitas: baloesNoOrcamento(session),
    ultimaEm: session.blips.at(-1)?.createdAt ?? null,
    ultimaConversaFimEm: ultimaConversaEm(session) ?? null,
    marco,
  };
}

/** Atividade do candidato para o momento da política comum: digitar ou colar (mãos) e falar. */
export function momentoDaSessao(session: SessionState, t: number): Momento {
  let maos: number | undefined;
  let fala: number | undefined;
  for (const e of session.events) {
    if (e.type === "snapshot" || e.type === "paste") maos = e.t;
    if (e.type === "speech" && e.role === "candidate") fala = e.t;
  }
  return { maosParadasHaMs: maos === undefined ? Infinity : t - maos, falaHaMs: fala === undefined ? Infinity : t - fala };
}

/** A última conversa: a última fala de qualquer um dos dois ou o fim do último assunto, o que vier depois. */
function ultimaConversaEm(session: SessionState): number | undefined {
  const fala = session.events.findLast((e) => e.type === "speech")?.t;
  const fim = session.lastConversationEndedAt;
  if (fala === undefined) return fim;
  return fim === undefined ? fala : Math.max(fala, fim);
}

/** Linhas não vazias do código de agora que não existiam no código de `t`. */
function linhasNovasDesde(session: SessionState, t: number): number {
  const antes = session.codeHistory.filter((v) => v.t <= t).at(-1)?.code ?? "";
  const vistas = new Set(antes.split("\n").map((l) => l.trim()));
  return latestCode(session)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !vistas.has(l)).length;
}

/**
 * As linhas grifadas mudaram desde a versão do código em que a pergunta foi criada.
 * Sem grifo, ou sem versão anterior ao createdAt, não há como comparar.
 */
function linesChanged(session: SessionState, q: QueuedQuestion): boolean {
  if (q.highlight === undefined) return false;
  const { startLine, endLine } = q.highlight;
  const createdVersion = session.codeHistory.filter((v) => v.t <= q.createdAt).at(-1);
  if (createdVersion === undefined) return false;
  const latest = session.codeHistory.at(-1)?.code ?? "";
  return linesOf(createdVersion.code, startLine, endLine) !== linesOf(latest, startLine, endLine);
}

function linesOf(code: string, startLine: number, endLine: number): string {
  return code.split("\n").slice(startLine - 1, endLine).join("\n");
}

function raise(session: SessionState, q: QueuedQuestion, t: number): Blip {
  q.status = "blipped";
  const blip: Blip = {
    id: q.id,
    preview: previewFor(q),
    priority: q.priority,
    createdAt: t,
    highlight: q.highlight,
  };
  const empecilho = q.kind === "empecilho" ? empecilhoDaQuestao(session) : undefined;
  if (empecilho) blip.empecilho = empecilhoPublico(session, empecilho);
  if (q.kind !== "retorno" && q.kind !== "encerramento" && q.kind !== "empecilho" && q.kind !== "cola" && q.kind !== "run_falhou") blip.perdeAVez = true;
  if (q.kind === "cola") blip.passaNaFrente = true;
  session.blips.push(blip);
  session.pendingBlipId = blip.id;
  return blip;
}

/** Texto curto do balão. Nunca a pergunta inteira. */
function previewFor(q: QueuedQuestion): string {
  if (q.kickoff) return "Uma pergunta sobre a sua ideia";
  if (q.kind === "empecilho") return "Mudou uma coisa no problema";
  if (q.kind === "retorno") return q.topicLabel === "como ficou a mudança" ? "E aí, como ficou a mudança?" : "E aí, como foi o desafio?";
  if (q.kind === "encerramento") return "Antes de encerrar, uns pontos rápidos";
  if (q.kind === "cola") return "Quero entender o trecho que você colou";
  if (q.kind === "run_falhou") return "Quero entender o resultado do teste";
  return q.topicLabel ? `Quero entender ${q.topicLabel}` : "Tenho uma pergunta sobre seu código";
}

/**
 * A pergunta já levantada perdeu a vez antes de ser feita: o balão espera uma pausa para ser falado e, nesse meio
 * tempo, o candidato pode ter contado o plano sozinho, começado a codar ou já ter ouvido a mesma pergunta. Sem isso
 * a abertura ("como você está pensando em resolver?") saía depois de ele já ter explicado, e ele ouvia a mesma
 * pergunta duas vezes. Retorno, mudança no problema e encerramento sempre valem.
 */
export function perdeuAVez(session: SessionState, q: QueuedQuestion, blipCreatedAt: number): string | undefined {
  // A fala do run com falha vale até ele rodar de novo ou o Totti falar depois do run (uma fala dele explicando não
  // a cancela: o ponto é o Totti não deixar o run passar em silêncio).
  if (q.kind === "run_falhou") {
    const passou = runFalhouPassou(session, q);
    return passou ? `fala do run com falha descartada: ${passou}` : undefined;
  }
  if (q.kind === "retorno" || q.kind === "empecilho" || q.kind === "encerramento" || q.kind === "cola") return undefined;
  if (q.kickoff) {
    // O entrevistador já fez uma pergunta (numa fala livre, ex.: "como você pretende começar?"): a abertura sobra.
    const perguntou = session.events.some((e) => e.type === "speech" && e.role === "agent" && e.text.trim().endsWith("?") && !/posso (te )?(perguntar|interromper)/i.test(e.text));
    if (perguntou) return "abertura descartada: o entrevistador já perguntou";
    if (palavrasFaladas(session) >= KICKOFF_SKIP_IF_WORDS_SPOKEN) return "abertura descartada: candidato já contou o plano falando";
    if (linesWrittenBeyondStarter(session) >= KICKOFF_SKIP_IF_LINES_WRITTEN) return "abertura descartada: candidato já começou a codar";
    if (jaFoiPerguntada(session, q)) return "abertura descartada: pergunta parecida já feita";
    return undefined;
  }
  if (falouDepois(session, blipCreatedAt)) return "pergunta descartada: candidato falou depois de ela nascer";
  if (jaFoiPerguntada(session, q)) return "pergunta descartada: pergunta parecida já feita";
  return undefined;
}

/** Quantas palavras o candidato já disse na sessão (falas gravadas na linha do tempo). */
function palavrasFaladas(session: SessionState): number {
  return session.events.reduce(
    (total, e) => total + (e.type === "speech" && e.role === "candidate" ? e.text.split(/\s+/).filter(Boolean).length : 0),
    0,
  );
}

export function allPassed(result: RunResult): boolean {
  return result.total > 0 && result.passed === result.total;
}
