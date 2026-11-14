"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Play } from "lucide-react";
import type { editor as MonacoEditor } from "monaco-editor";
import type { Blip, EditorCommand, EmpecilhoPublico, InterviewConfig } from "@/lib/contracts";
import { createExecutor, type CommandExecutor } from "@/lib/editorCommands";
import { DEFAULT_CONFIG } from "@/lib/config/default";
import { LANGUAGE_LABELS } from "@/lib/ide-constants";
import { getProblem, resolveProblem } from "@/lib/problems";
import { runCode, warmUp } from "@/lib/runner";
import FakeCursor, { measureLines, type FakeCursorHandle } from "./FakeCursor";
import CodeEditor from "./CodeEditor";
import ConfirmarEncerrar from "./ConfirmarEncerrar";
import JanelaChamada from "./JanelaChamada";
import ProblemPanel from "./ProblemPanel";
import RunResults, { type RunState } from "./RunResults";
import { useMidiaLocal } from "@/lib/presenca/useMidiaLocal";
import { useTranscricao } from "@/lib/presenca/useTranscricao";
import { useInterrupcao } from "@/lib/voz/useInterrupcao";
import { comoFuncionaLiveCoding, DESPEDIDA_LIVE_CODING } from "@/lib/conversa/instrucoes";
import { limiarDoFechamentoNaIde } from "@/lib/totti/fechamento";
import { criarEncerrarComDespedida } from "./ide/encerrarComDespedida";
import { deveAguardarParaFalar, podeTomarTurno } from "@/lib/conversa/turnos";
import { pausaDasMaosParaFalarMs } from "@/lib/interrupcao/politica";
import { esperaDoFimDaFala } from "@/lib/audio/fimDaFala";
import { useVozAgente } from "@/lib/voz/useVozAgente";
import Legenda from "./Legenda";
import { postEncerramento, postForcarEmpecilho } from "./ide/api";
import { RECONHECIMENTOS, useConversa } from "./ide/useConversa";
import { useCodeCapture } from "./ide/useCodeCapture";
import { useSession } from "./ide/useSession";

/** Margem esquerda do editor: o painel do problema (360) mais o respiro. */
const MARGEM_PROBLEMA = 392;
/** Margem esquerda com o painel recolhido (só a pílula, que fica em cima do editor). */
const MARGEM_RECOLHIDO = 12;
/** Espaço em cima do editor com o painel recolhido: pílula e botões numa fileira só. */
const TOPO_RECOLHIDO = 104;
/** Teto da espera acima: ruído constante no microfone não segura a fala para sempre. */
const FALA_ESPERA_MAX_MS = 12_000;
/** Depois de uma fala do Totti, ele espera isso antes de puxar outro assunto (o candidato precisa de vez). */
const PAUSA_ENTRE_FALAS_MS = 8000;
/**
 * Depois da apresentação, o mínimo de leitura antes de qualquer pergunta (com 12 s ela chegava no meio do
 * enunciado). A abertura em si espera ele começar a escrever e parar (lib/agents/policy.ts).
 */
const LEITURA_DEPOIS_DA_APRESENTACAO_MS = 30_000;
/** Teto da espera da apresentação por uma fala do candidato em andamento. */
const APRESENTACAO_ESPERA_MAX_MS = 8000;
/** Fala com pelo menos isso de palavras é uma explicação: a pergunta que chegou antes dela perde a vez. */
const PALAVRAS_FALA_LONGA = 12;

/**
 * A IDE não tem inteligência: mostra, captura e obedece (docs/contexto-pessoa-a-ide.md).
 * Eventos vão para /api/events. A conversa com o Totti é uma só, por voz, a entrevista inteira
 * (components/ide/useConversa.ts): ele se apresenta, ouve, responde e faz as perguntas dele numa pausa.
 */
/** `vaga`: o que a IDE usa da config da vaga (padrão: DEFAULT_CONFIG). */
export type VagaIDE = Pick<InterviewConfig, "id" | "durationMin" | "languages" | "problemId" | "difficulty"> & Partial<Pick<InterviewConfig, "roleTitle">>;

/** Logo no começo o agente se apresenta, diz quanto tempo dura e como funciona (lib/conversa/instrucoes.ts). */
/** Espera depois de a sessão começar, para a saudação não atropelar o carregamento da tela. */
const ATRASO_SAUDACAO_MS = 1500;
/** Volume do microfone acima disso conta como alguém falando (segura a vez do agente). */
const VOLUME_DE_FALA = 0.08;
/** Sem voz (desligada ou bloqueada pelo navegador), a fala do agente fica na legenda por esse tempo. */
const LEGENDA_SEM_VOZ_MS = 9000;

/** `convite`: id do link do e-mail; liga esta sessão ao candidato no painel da vaga. */
export default function IdeApp({ problemId, vaga = DEFAULT_CONFIG, convite }: { problemId?: string; vaga?: VagaIDE; convite?: string }) {
  const DURATION_MS = vaga.durationMin * 60_000;
  const router = useRouter();
  // A questão vem da config da vaga (nível definido pelo agente); `problemId` só sobrescreve em testes.
  const problem = problemId ? getProblem(problemId) : resolveProblem(vaga);
  // Abre na primeira linguagem da vaga que a questão tem (a recrutadora pode ter restringido, ex.: só C++).
  const initialLanguage = vaga.languages.find((l) => l in problem.starters) ?? vaga.languages[0];
  const session = useSession(problem.id, vaga.id, vaga.durationMin, initialLanguage);
  // Avisa uma vez de quem é a sessão. Best-effort: se falhar, a entrevista segue e só aparece sem nome.
  const vinculadaRef = useRef<string | null>(null);
  useEffect(() => {
    const sessionId = session.sessionId;
    if (!convite || !sessionId || vinculadaRef.current === sessionId) return;
    vinculadaRef.current = sessionId;
    void fetch("/api/convites/sessao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ convite, sessionId }),
    }).catch(() => {});
  }, [convite, session.sessionId]);
  const capture = useCodeCapture({
    sendEvent: session.sendEvent,
    nowT: session.nowT,
    endedRef: session.endedRef,
    starters: problem.starters,
    initialLanguage,
  });

  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [firstRun, setFirstRun] = useState(true);
  const [problemaAberto, setProblemaAberto] = useState(true);
  const [confirmandoFim, setConfirmandoFim] = useState(false);
  /** Pediu para finalizar: a sessão encerra quando a última conversa (os pontos pendentes) fechar. */
  const [finalizando, setFinalizando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const finalizandoRef = useRef(false);
  finalizandoRef.current = finalizando;
  /** Mudança no problema que o Totti trouxe (empecilho): entra no painel e os testes dela rodam junto. */
  const [mudanca, setMudanca] = useState<EmpecilhoPublico | null>(null);
  const problemaRodado = mudanca ? { ...problem, visibleTests: [...problem.visibleTests, ...mudanca.tests.map(({ name, args, expected }) => ({ name, args, expected }))] } : problem;
  // O microfone mexe a onda da pílula e alimenta a transcrição da fala (useTranscricao, abaixo).
  const midia = useMidiaLocal();
  const voz = useVozAgente({ bloqueada: session.ended && !encerrando, sessao: session.sessionId ? { sessao_id: session.sessionId, contexto: "coding" } : null });
  const [parcial, setParcial] = useState("");
  const vozEstadoRef = useRef(voz.estado);
  vozEstadoRef.current = voz.estado;
  // Atalhos de desenvolvimento só com ?debug=1 (lido no cliente, depois da hidratação).
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).get("debug") === "1");
  }, []);

  // Turnos (as mesmas regras do quadro, lib/sessao/turnos.ts): o agente fala sem pedir licença, mas só numa
  // pausa de quem está falando. Uma transcrição parcial ou som no microfone seguram a vez dele.
  const ultimaFalaEmRef = useRef(0);
  const falaParcialRef = useRef(false);
  const ultimaDigitacaoEmRef = useRef(0);
  /** A última tecla fechou uma linha (Enter): um ponto natural para o Totti perguntar, mesmo sem ele parar de vez. */
  const fimDeLinhaRef = useRef(false);
  const linhasDoCodigoRef = useRef(0);
  const vozFalar = voz.falar;
  /** Fala do agente: sintetiza já, com a escuta ligada, e só toca quando o candidato faz uma pausa. */
  const falarNaVez = useCallback((texto: string) => vozFalar(texto, {
    antesDeTocar: async () => {
      const esperandoDesde = Date.now();
      while (deveAguardarParaFalar({ agora: Date.now(), esperandoDesde, ultimaFalaEm: ultimaFalaEmRef.current, falaParcial: falaParcialRef.current })) {
        await new Promise<void>((resolver) => setTimeout(resolver, 100));
      }
      return true;
    },
  }), [vozFalar]);
  const receberParcial = useCallback((texto: string) => {
    setParcial(texto);
    falaParcialRef.current = !!texto.trim();
    if (texto.trim()) ultimaFalaEmRef.current = Date.now();
  }, []);
  // Som no microfone (fala que a transcrição ainda não devolveu) também conta, mas não a voz do próprio agente.
  useEffect(() => {
    if (midia.microfoneLigado && midia.volume > VOLUME_DE_FALA && voz.estado !== "falando") ultimaFalaEmRef.current = Date.now();
  }, [midia.microfoneLigado, midia.volume, voz.estado]);
  // Com a voz do agente tocando a escuta para, e uma parcial que ficou aberta não pode segurar a vez para sempre.
  useEffect(() => {
    if (voz.estado === "falando") falaParcialRef.current = false;
  }, [voz.estado]);
  /** Fala do agente sem voz (desligada ou bloqueada): fica um tempo na legenda. */
  const [legendaSemVoz, setLegendaSemVoz] = useState<{ quem: "agente"; texto: string; ate: number } | null>(null);
  useEffect(() => {
    if (!legendaSemVoz) return;
    const id = setTimeout(() => setLegendaSemVoz(null), LEGENDA_SEM_VOZ_MS);
    return () => clearTimeout(id);
  }, [legendaSemVoz]);

  const executorRef = useRef<CommandExecutor | null>(null);
  const cursorRef = useRef<FakeCursorHandle>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const codesRef = useRef<Record<string, string>>({}); // um buffer de código por linguagem
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  const applyCommands = useCallback((cmds: EditorCommand[]) => {
    cmds.forEach((c) => executorRef.current?.(c));
  }, []);

  const encerrarPelaVozRef = useRef<() => void>(() => {});
  const fioFechadoRef = useRef<(blip: Blip) => void>(() => {});
  const conversa = useConversa({
    sessionId: session.sessionId,
    sendEvent: session.sendEvent,
    applyCommands,
    falar: falarNaVez,
    parar: voz.parar,
    vozTocando: () => vozEstadoRef.current === "falando",
    getLiveCode: capture.getLiveCode,
    onFinishRequest: () => encerrarPelaVozRef.current(),
    onDespedida: (texto) => encerrarComDespedidaRef.current("button", texto),
    onFioFechado: (blip) => fioFechadoRef.current(blip),
    onSemVoz: (texto) => setLegendaSemVoz({ quem: "agente", texto, ate: texto.length }),
    falandoAgora: () => falaParcialRef.current || !!bufferFalaRef.current,
  });

  // Fala do candidato (Scribe, ou o navegador como reserva): vai para a conversa, que decide pela intenção se o
  // Totti responde (dúvida, feedback, etapa concluída, resposta à pergunta dele) ou só ouve (pensando em voz alta).
  const falaRef = useRef<(texto: string) => void>(() => {});
  /** Quando ele terminou a última fala longa (explicando algo): uma pergunta que chegou antes disso perde a vez. */
  const ultimaFalaLongaEmRef = useRef(0);
  falaRef.current = (texto) => {
    const limpo = texto.trim();
    if (!limpo || session.ended || encerrando) return;
    if (limpo.split(/\s+/).length >= PALAVRAS_FALA_LONGA) ultimaFalaLongaEmRef.current = Date.now();
    conversa.ouvir(limpo);
  };
  // Turn-taking: os trechos finais da transcrição se acumulam e só seguem para o Totti depois de um silêncio que
  // depende de como a frase terminou (lib/audio/fimDaFala.ts, o mesmo do quadro): fechada ou pergunta, 1,5 s;
  // pendurada num "e", "tipo", vírgula, 2,6 s. Mais o ~1 s do Scribe. Uma parcial nova ou voz no microfone nesse intervalo adia o envio (a frase não é cortada).
  const bufferFalaRef = useRef("");
  const bufferDesdeRef = useRef(0);
  const bufferTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aoFalar = useCallback((texto: string) => {
    const limpo = texto.trim();
    if (!limpo) return;
    // O trecho final também é fala: até ele seguir para o Totti, a vez continua com o candidato.
    ultimaFalaEmRef.current = Date.now();
    if (!bufferFalaRef.current) bufferDesdeRef.current = Date.now();
    bufferFalaRef.current = [bufferFalaRef.current, limpo].filter(Boolean).join(" ");
    clearTimeout(bufferTimerRef.current);
    const checar = () => {
      const agora = Date.now();
      const falando = falaParcialRef.current || agora - ultimaFalaEmRef.current < esperaDoFimDaFala(bufferFalaRef.current);
      if (falando && agora - bufferDesdeRef.current < FALA_ESPERA_MAX_MS) {
        bufferTimerRef.current = setTimeout(checar, 150);
        return;
      }
      const pronto = bufferFalaRef.current;
      bufferFalaRef.current = "";
      if (pronto) falaRef.current(pronto);
    };
    bufferTimerRef.current = setTimeout(checar, esperaDoFimDaFala(bufferFalaRef.current));
  }, []);
  useEffect(() => () => clearTimeout(bufferTimerRef.current), []);

  // O Totti só toma a vez numa pausa do candidato (lib/conversa/turnos.ts), mas o candidato pode cortá-lo (#97):
  // falando por cima (a escuta pausada mede o microfone), pelo botão da chamada ou com Esc. A despedida não se corta.
  // A fala cortada fica na conversa só até onde ele ouviu (useConversa.interromper).
  const vozFalaRef = useRef(voz.fala);
  vozFalaRef.current = voz.fala;
  const interrupcao = useInterrupcao({
    falando: voz.estado === "falando",
    permitida: !session.ended && !encerrando,
    aoInterromper: (como) => {
      // A vez é dele agora: o Totti não volta a falar logo depois de ser cortado.
      ultimaFalaEmRef.current = Date.now();
      conversa.interromper(vozFalaRef.current?.ate ?? 0);
      void session.sendEvent({ type: "speech_interrupted", by: como, heardChars: vozFalaRef.current?.ate ?? 0 });
    },
  });
  const escuta = useTranscricao({
    stream: midia.stream,
    // A escuta só para enquanto a voz do agente toca (preparando, ela ainda ouve: o candidato pode continuar falando).
    ativo: midia.microfoneLigado && !session.ended && !encerrando && voz.estado !== "falando",
    sessaoId: session.sessionId,
    aoParcial: receberParcial,
    aoFinal: aoFalar,
    interrupcao: interrupcao.escuta,
  });

  // Estado do turno lido pelos intervalos abaixo (sem recriá-los a cada render).
  const estadoTurnoRef = useRef({ agenteFalando: false, aguardandoResposta: false });
  estadoTurnoRef.current = { agenteFalando: voz.ativa, aguardandoResposta: conversa.pensando };

  // Logo no começo o Totti se apresenta: quem é, quanto tempo dura, como funciona e que ele acompanha o código
  // o tempo todo (lib/conversa/instrucoes.ts). Só uma fala do candidato em andamento a segura (som ambiente não),
  // e nenhuma pergunta sai antes de ela terminar.
  const saudacaoFeitaRef = useRef(false);
  /** Quando a apresentação terminou (0: ainda não). A primeira pergunta espera a leitura depois disso. */
  const saudacaoTerminadaEmRef = useRef(0);
  const dizer = conversa.dizer;
  const duracaoMin = vaga.durationMin;
  const prepararVoz = voz.preparar;
  useEffect(() => {
    if (!session.sessionId || session.ended || saudacaoFeitaRef.current) return;
    const desde = Date.now();
    const id = setInterval(() => {
      const agora = Date.now();
      if (saudacaoFeitaRef.current || agora - desde < ATRASO_SAUDACAO_MS) return;
      if (falaParcialRef.current && agora - desde < APRESENTACAO_ESPERA_MAX_MS) return;
      saudacaoFeitaRef.current = true;
      clearInterval(id);
      void dizer(comoFuncionaLiveCoding(duracaoMin)).finally(() => { saudacaoTerminadaEmRef.current = Date.now(); });
      // O "uhum" de quando ele termina de falar fica pronto durante a apresentação, para sair sem espera.
      prepararVoz(RECONHECIMENTOS);
    }, 200);
    return () => clearInterval(id);
  }, [session.sessionId, session.ended, dizer, duracaoMin, prepararVoz]);

  useEffect(() => warmUp(), []);
  const pedirMidia = midia.pedir;
  useEffect(() => {
    void pedirMidia().catch(() => {});
  }, [pedirMidia]);

  // Despedida centralizada para botão, voz, fechamento e timeout.
  const encerrarComDespedidaRef = useRef<(motivo: "button" | "timeout", texto?: string) => void>(() => {});
  const { endSession, sendEvent, sessionId, setIncomingBlip } = session;
  const pararConversa = conversa.parar;
  const falarVoz = voz.falar;
  const encerrarComDespedida = useCallback(async (motivo: "button" | "timeout", texto?: string) => {
    if (finalizandoRef.current) return;
    finalizandoRef.current = true; setFinalizando(true); setEncerrando(true);
    setIncomingBlip(null);
    pararConversa();
    await criarEncerrarComDespedida({
      dizer: (fala) => falarVoz(fala),
      registrarFala: async (fala) => { await sendEvent({ type: "speech", role: "agent", text: fala }); },
      endSession,
      navegar: () => router.push("/obrigado"),
      pedirEncerramento: async () => sessionId ? (await postEncerramento(sessionId, "pediu_encerrar")).despedida : undefined,
      mostrarTexto: (fala, ms) => new Promise<void>((resolve) => { setLegendaSemVoz({ quem: "agente", texto: fala, ate: Date.now() + ms }); setTimeout(resolve, ms); }),
      reserva: DESPEDIDA_LIVE_CODING,
    })(motivo, texto);
  }, [pararConversa, router, endSession, sendEvent, sessionId, setIncomingBlip, falarVoz]);
  encerrarComDespedidaRef.current = (motivo, texto) => { void encerrarComDespedida(motivo, texto); };
  fioFechadoRef.current = () => { editorRef.current?.focus(); };

  // As perguntas do Totti (lib/agents/policy.ts decide o quê e quando pode) são faladas numa pausa natural:
  // ninguém falando, sem transcrição parcial, sem digitar, sem outro assunto aberto e com um respiro desde a
  // última fala dele. A mudança no problema (empecilho) espera a mesma pausa, mas não a digitação.
  const balao = session.incomingBlip;
  const tirarBalao = session.setIncomingBlip;
  const abrirFio = conversa.abrirFio;
  const ocupada = conversa.ocupada;
  const soEsperandoResposta = conversa.soEsperandoResposta;
  const fecharFio = conversa.fecharFio;
  const fioRef = conversa.fioRef;
  const ultimaFalaDoAgenteEmRef = conversa.ultimaFalaDoAgenteEmRef;
  const enviarEvento = session.sendEvent;
  useEffect(() => {
    if (!balao || finalizando || session.ended) return;
    const chegouEm = Date.now();
    const id = setInterval(() => {
      const agora = Date.now();
      // Ele explicou bastante coisa depois que a pergunta chegou (ex.: contou o plano): ela pode já ter sido
      // respondida. Sai sem ser dita e sem pedir licença; a próxima análise, que ouviu a fala, decide de novo.
      // Era o "Ei, posso te perguntar?" logo depois de ele contar o plano, e a mesma pergunta em seguida.
      if (balao.perdeAVez && ultimaFalaLongaEmRef.current > chegouEm) {
        clearInterval(id);
        tirarBalao(null);
        void enviarEvento({ type: "blip_closed", blipId: balao.id, reason: "agent" });
        return;
      }
      // A pergunta da colagem não espera o assunto aberto: se o Totti só aguardava a resposta de outra pergunta,
      // aquela fecha (a resposta, se vier, ainda chega como fala livre) e esta sai.
      if (balao.passaNaFrente && fioRef.current && soEsperandoResposta()) fecharFio("agent", true);
      if (!saudacaoTerminadaEmRef.current || fioRef.current || ocupada() || vozEstadoRef.current !== "inativa" || bufferFalaRef.current) return;
      if (agora - saudacaoTerminadaEmRef.current < LEITURA_DEPOIS_DA_APRESENTACAO_MS) return;
      if (agora - ultimaFalaDoAgenteEmRef.current < PAUSA_ENTRE_FALAS_MS) return;
      // Não é só "quando ele parar": o fim de uma linha já serve, e a pausa exigida cai conforme a pergunta espera
      // (lib/interrupcao/politica.ts). Com 4 s fixos, quem programava direto podia não ouvir pergunta nenhuma.
      const pausaDasMaos = pausaDasMaosParaFalarMs({ esperandoHaMs: agora - chegouEm, pontoNatural: fimDeLinhaRef.current });
      if (!balao.empecilho && agora - ultimaDigitacaoEmRef.current < pausaDasMaos) return;
      if (!podeTomarTurno({ agora, ultimaFalaEm: ultimaFalaEmRef.current, falaParcial: falaParcialRef.current, ...estadoTurnoRef.current })) return;
      clearInterval(id);
      tirarBalao(null);
      if (balao.empecilho) {
        setMudanca(balao.empecilho);
        setProblemaAberto(true);
      }
      void abrirFio(balao);
    }, 150);
    return () => clearInterval(id);
  }, [balao, finalizando, session.ended, tirarBalao, abrirFio, ocupada, soEsperandoResposta, fecharFio, fioRef, ultimaFalaDoAgenteEmRef, enviarEvento]);

  /** Dev: solta o empecilho agora, sem esperar as regras de tempo. */
  async function forcarEmpecilho() {
    if (session.sessionId === null) return;
    try {
      const res = await postForcarEmpecilho(session.sessionId);
      console.info("[dev] empecilho:", res.reason);
      session.applyResponse(res);
    } catch (err) {
      console.error("POST /api/dev/empecilho falhou", err);
    }
  }

  /** Pediu, falando, para encerrar: o Totti se despede e a sessão fecha, sem a última pergunta do botão. */
  async function encerrarPelaVoz() { await encerrarComDespedida("button"); }
  encerrarPelaVozRef.current = () => void encerrarPelaVoz();

  async function finalizar() {
    setConfirmandoFim(false);
    if (!session.sessionId || finalizandoRef.current) return;
    try {
      // O código final e os runs chegam antes do encerramento (com teto: rede caída não segura o botão).
      void capture.flushSnapshot().catch(() => {});
      await session.esperarEventos(5000);
      const res = await postEncerramento(session.sessionId, "concluiu");
      if (res.blip) { if (conversa.fioRef.current) conversa.fecharFio("button"); void conversa.abrirFio(res.blip); return; }
      if (res.despedida) { await encerrarComDespedida("button", res.despedida); return; }
    } catch (err) { console.error("POST /api/encerramento falhou", err); }
    await encerrarComDespedida("button");
  }

  /**
   * Envolve o executor: grifos e notas passam pelo mouse falso (em fila, na
   * ordem em que chegam) antes de entrar no editor. Limpar é imediato.
   */
  function createAnimatedExecutor(
    editor: MonacoEditor.IStandaloneCodeEditor,
    exec: CommandExecutor,
  ): CommandExecutor {
    return (cmd) => {
      queueRef.current = queueRef.current
        .then(async () => {
          const section = sectionRef.current;
          const lineCount = editor.getModel()?.getLineCount() ?? 1;
          const clamp = (n: number) => Math.min(Math.max(1, Math.round(n)), lineCount);
          if (!section || cmd.type === "clear_highlights") return exec(cmd);

          const start = cmd.type === "highlight_range" ? clamp(Math.min(cmd.startLine, cmd.endLine)) : clamp(cmd.line);
          const end = cmd.type === "highlight_range" ? clamp(Math.max(cmd.startLine, cmd.endLine)) : start;
          editor.revealLinesInCenterIfOutsideViewport(start, end);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const rects = measureLines(editor, section, start, end);

          if (!rects.length) return exec(cmd);
          if (cmd.type === "highlight_range") await cursorRef.current?.select(rects, () => exec(cmd));
          else await cursorRef.current?.click(rects[0], () => exec(cmd));
        })
        .catch(() => exec(cmd)); // a animação nunca pode impedir o grifo
    };
  }

  function trocarLinguagem(next: string) {
    if (next === capture.language || session.ended) return;
    codesRef.current[capture.language] = capture.code;
    capture.changeLanguage(next);
    capture.onCodeChange(codesRef.current[next] ?? problem.starters[next] ?? "");
    setRun({ status: "idle" });
  }

  async function rodar() {
    if (session.ended) return;
    setRun({ status: "running", loadingPyodide: firstRun, feitos: 0, passaram: 0 });
    const result = await runCode(capture.code, problemaRodado, capture.language, (feitos, passaram) =>
      setRun((r) => (r.status === "running" ? { ...r, feitos, passaram } : r)),
    );
    setFirstRun(false);
    setRun({ status: "done", result });
    void capture.runWithResult(result);
  }

  /** Microfone desligado ou indisponível: o candidato ainda pode escrever para o Totti. */
  const [digitado, setDigitado] = useState("");
  const semMicrofone = !midia.stream || !midia.microfoneLigado || !!escuta.erro;
  function enviarDigitado(e: React.FormEvent) {
    e.preventDefault();
    const texto = digitado.trim();
    if (!texto || session.ended) return;
    setDigitado("");
    ultimaFalaEmRef.current = Date.now();
    conversa.ouvir(texto);
  }

  const remaining = Math.max(0, DURATION_MS - session.elapsedMs);
  const fechamentoTempoPedidoRef = useRef(false);
  useEffect(() => {
    if (!sessionId || session.ended || finalizando || conversa.fio || remaining > limiarDoFechamentoNaIde(DURATION_MS)) return;
    if (fechamentoTempoPedidoRef.current) return;
    fechamentoTempoPedidoRef.current = true;
    void postEncerramento(sessionId, "tempo").then((res) => {
      if (res.blip) setIncomingBlip(res.blip);
      else void encerrarComDespedida("timeout", res.despedida);
    }).catch(() => { fechamentoTempoPedidoRef.current = false; });
  }, [sessionId, session.ended, finalizando, conversa.fio, remaining, DURATION_MS, encerrarComDespedida, setIncomingBlip]);
  useEffect(() => {
    if (remaining <= 0 && !session.ended) void encerrarComDespedida("timeout");
  }, [remaining, session.ended, encerrarComDespedida]);

  return (
    <main className="h-screen p-3">
      <section ref={sectionRef} className="relative h-full overflow-hidden rounded-padrao bg-superficie shadow-cartao">
        {encerrando && <div role="status" className="absolute top-3 right-4 z-30 rounded-full bg-superficie px-4 py-2 text-sm shadow-cartao">Encerrando a entrevista…</div>}
        {/* O editor começa depois do painel do problema, para não ficar escondido */}
        {/* Coluna do editor: editor e testes. Com a conversa aberta, abre espaço à direita para a barra lateral. */}
        <div
          className="flex h-full flex-col pr-3 pb-3 transition-[margin,padding] duration-300 ease-suave"
          style={{
            marginLeft: problemaAberto ? MARGEM_PROBLEMA : MARGEM_RECOLHIDO,
            paddingTop: problemaAberto ? 0 : TOPO_RECOLHIDO,
          }}
        >
          <div className="min-h-0 flex-1">
            <CodeEditor
              value={capture.code}
              language={capture.language}
              readOnly={session.ended || encerrando}
              onChange={(codigo: string) => {
                ultimaDigitacaoEmRef.current = Date.now();
                const linhas = codigo.split("\n").length;
                fimDeLinhaRef.current = linhas === linhasDoCodigoRef.current + 1;
                linhasDoCodigoRef.current = linhas;
                capture.onCodeChange(codigo);
              }}
              onPaste={capture.onPaste}
              onReady={(editor: MonacoEditor.IStandaloneCodeEditor, monaco) => {
                editorRef.current = editor;
                executorRef.current = createAnimatedExecutor(editor, createExecutor(editor, monaco));
              }}
            />
          </div>
          <RunResults state={run} total={problemaRodado.visibleTests.length} />
          {/*
            Sem microfone, a conversa continua por escrito (a fala do Totti segue na voz e na legenda). No fluxo da
            coluna, abaixo dos testes: solta por cima (absolute), a caixa cobria o painel de testes.
          */}
          {semMicrofone && !session.ended && (
            <form onSubmit={enviarDigitado} className="mt-2 flex w-[min(480px,100%)] shrink-0 gap-2">
              <input
                value={digitado}
                onChange={(e) => setDigitado(e.target.value)}
                disabled={encerrando}
                aria-label="Escrever para o Totti"
                placeholder={escuta.erro ?? "Microfone desligado: escreva para o Totti e aperte Enter"}
                className="vidro min-w-0 flex-1 rounded-full px-4 py-2 text-[14px] shadow-cartao outline-none"
              />
            </form>
          )}
        </div>

        {/* Coluna da questão: o painel do problema e, logo abaixo dele, os botões */}
        <div className={`absolute top-4 left-4 z-10 flex flex-col gap-3 ${problemaAberto ? "w-[360px]" : "max-w-[calc(100%-2rem)] items-start"}`}>
          <ProblemPanel
            problem={problem}
            elapsedMs={session.elapsedMs}
            durationMs={DURATION_MS}
            fase={session.fase}
            aberto={problemaAberto}
            onToggle={setProblemaAberto}
            mudanca={mudanca}
          />
          <div className="flex flex-wrap items-center gap-2">
            {remaining <= 5 * 60_000 && !session.ended && (
              <span className="label-pequena numero text-alerta">Pouco tempo</span>
            )}
            <select
              value={capture.language}
              onChange={(e) => trocarLinguagem(e.target.value)}
              disabled={session.ended || encerrando}
              aria-label="Linguagem"
              className="vidro rounded-full px-3 py-2 font-medium shadow-cartao outline-none"
            >
              {vaga.languages.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABELS[l] ?? l}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setConfirmandoFim(true)}
              disabled={session.ended || finalizando || encerrando}
              className="vidro flex items-center gap-2 rounded-full px-4 py-2 font-medium shadow-cartao disabled:opacity-50"
            >
              <Flag size={16} strokeWidth={1.75} />
              Finalizar
            </button>
            <button
              type="button"
              onClick={rodar}
              disabled={run.status === "running" || session.ended || encerrando}
              className="flex items-center gap-2 rounded-full bg-marca px-4 py-2 font-medium text-sobre-marca shadow-cartao disabled:opacity-60"
            >
              <Play size={16} strokeWidth={1.75} />
              {run.status === "running" ? "Rodando…" : "Rodar"}
            </button>
          </div>
          {/* Atalhos de desenvolvimento: no fluxo da coluna, nunca por cima dos botões */}
          {debug && process.env.NODE_ENV !== "production" && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  applyCommands([
                    { type: "highlight_range", startLine: 2, endLine: 3, note: "Debug: grifo" },
                    { type: "add_inline_note", line: 3, text: "nota de teste" },
                  ])
                }
                className="label-pequena rounded-full bg-superficie-2 px-2.5 py-1"
              >
                Testar grifo
              </button>
              <button
                type="button"
                onClick={() => applyCommands([{ type: "clear_highlights" }])}
                className="label-pequena rounded-full bg-superficie-2 px-2.5 py-1"
              >
                Limpar grifos
              </button>
              <button
                type="button"
                onClick={() => void forcarEmpecilho()}
                disabled={mudanca !== null || conversa.fio !== null}
                className="label-pequena rounded-full bg-superficie-2 px-2.5 py-1 disabled:opacity-50"
              >
                Forçar empecilho
              </button>
            </div>
          )}
        </div>

        <FakeCursor ref={cursorRef} />

        <JanelaChamada
          oculta={false}
          encerrada={session.ended}
          iniciadaEm={session.startedAtRef.current || null}
          midia={midia}
          agenteFalando={voz.estado === "falando"}
          agentePensando={conversa.pensando || voz.estado === "preparando"}
          onInterromper={interrupcao.podeInterromper ? () => interrupcao.interromper("manual") : undefined}
        />

        <Legenda fala={voz.fala ?? legendaSemVoz} />
        {/* O que o candidato está dizendo aparece numa legenda discreta */}
        {parcial.trim() && !session.ended && (
          <div className="pointer-events-none absolute right-4 bottom-[124px] left-4 z-10 flex justify-center md:left-[392px]">
            <p role="status" className="vidro max-w-[560px] truncate rounded-full px-4 py-1.5 text-[13px] italic text-texto-suave shadow-cartao">
              {parcial}
            </p>
          </div>
        )}
        <ConfirmarEncerrar
          aberto={confirmandoFim}
          onCancelar={() => setConfirmandoFim(false)}
          onConfirmar={() => void finalizar()}
        />


      </section>
    </main>
  );
}
