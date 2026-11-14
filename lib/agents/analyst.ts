/**
 * Analyst: lê o código com um LLM, atualiza os insights e enfileira perguntas seguras.
 * Uma análise por sessão por vez; gatilhos que chegam durante uma análise viram uma rodada extra.
 */
import type { AnalystQuestion } from "@/lib/agents/analystSchema";
import { AnalystOutput } from "@/lib/agents/analystSchema";
import { recordOutcome, uncoveredCriteria } from "@/lib/agents/coverage";
import { mudancaParaPrompt } from "@/lib/agents/empecilho";
import { conversasFeitas, faseDaEntrevista, formatarConversas, regiaoAlterada } from "@/lib/agents/fase";
import { buildAnalystSystem, buildAnalystUser } from "@/lib/agents/prompts/analyst";
import { focoPendente } from "@/lib/agents/focoQuota";
import { allPassed, COLA_MIN_LINES, isCandidateIdle, ritmoDaSessao, tetoDaPerguntaNaIde } from "@/lib/agents/policy";
import { assuntoJaExplorado, cortarAberturaDeMolde, trechosParaPrompt } from "@/lib/agents/perguntaDaAnalise";
import { emPortugues } from "@/lib/totti/guardas";
import { interrupcaoAtrasada, orcamentoDeInterrupcoes } from "@/lib/interrupcao/politica";
import { checkQuestion } from "@/lib/agents/spoilerFilter";
import { PRIORIDADE_FOCO } from "@/lib/agents/focoQuota";
import type { FocusArea, LineRange, SessionEvent } from "@/lib/contracts";
import { completeJson } from "@/lib/llm";
import { registrarUsoLlm } from "./uso";
import { latestCode, numberCode } from "@/lib/session/store";
import type { SessionState } from "@/lib/session/types";
import { getProblem } from "@/problems";

/** Estado de controle do Analyst por sessão (fora de SessionState, que é o que a API expõe). */
interface AnalystBookkeeping {
  running: boolean;
  /** Gatilho da próxima rodada; definido quando chega evento durante uma análise em curso. */
  rerunTrigger?: SessionEvent;
  /** Código e t do gatilho da última análise concluída com sucesso. */
  lastCompletedCode?: string;
  lastCompletedT?: number;
  /** Pause adiado pela janela de 15 s: no máximo um por sessão (um novo substitui o anterior). */
  deferredTimer?: ReturnType<typeof setTimeout>;
  /** Última "etapa concluída" usada como momento-chave: fase e quantos runs havia. Vale uma vez por etapa. */
  ultimaEtapa?: { fase: string; runs: number };
}

type PauseEvent = Extract<SessionEvent, { type: "pause" }>;
type RunEvent = Extract<SessionEvent, { type: "run" }>;

const PAUSE_MIN_GAP_MS = 15_000;

// Espelha as travas de decideBlip em lib/agents/policy.ts.
export function perguntaBloqueadaAgora(session: SessionState, t: number): boolean {
  const perguntasContadas = session.blips.filter((blip) => {
    const q = session.queue.find((item) => item.id === blip.id);
    return !q?.kickoff && q?.kind !== "encerramento" && q?.kind !== "empecilho" && q?.kind !== "cola";
  }).length;
  const temRetorno = session.queue.some((q) => q.kind === "retorno" && q.status === "queued");
  const temCola = session.queue.some((q) => q.kind === "cola" && q.status === "queued");
  return !isCandidateIdle(session, t) || session.ended ||
    (session.pendingBlipId !== undefined && !temCola) ||
    (perguntasContadas >= orcamentoDeInterrupcoes(session.config.durationMin) && !temRetorno) ||
    session.queue.some((q) => q.kind === "encerramento" && q.status !== "queued");
}

// Em globalThis, como o store: o Next em dev recarrega o módulo ao compilar outra rota, e um
// WeakMap local zeraria no meio da sessão (já causou ids de pergunta repetidos).
const globalWithBook = globalThis as typeof globalThis & {
  __analystBookkeeping?: WeakMap<SessionState, AnalystBookkeeping>;
};
const bookkeeping = (globalWithBook.__analystBookkeeping ??= new WeakMap<SessionState, AnalystBookkeeping>());

function bookkeepingFor(session: SessionState): AnalystBookkeeping {
  let book = bookkeeping.get(session);
  if (!book) {
    book = { running: false };
    bookkeeping.set(session, book);
  }
  return book;
}

export async function runAnalyst(session: SessionState, trigger: SessionEvent): Promise<void> {
  const book = bookkeepingFor(session);
  if (book.running) {
    book.rerunTrigger = trigger;
    return;
  }

  book.running = true;
  try {
    let current: SessionEvent | undefined = trigger;
    while (current) {
      book.rerunTrigger = undefined;
      await analyzeOnce(session, book, current);
      current = book.rerunTrigger;
    }
  } finally {
    book.running = false;
  }
}

/**
 * Momento-chave do gatilho, ou undefined. Pura: lê a sessão e o evento (que já está em session.events,
 * porque o POST grava o evento antes de chamar o Analyst).
 */
export function detectKeyMoment(session: SessionState, trigger: SessionEvent): string | undefined {
  if (trigger.type === "paste") {
    // A colagem grande já tem a pergunta dela na fila (policy.enqueueCola), feita pelo entrevistador: a análise
    // segue normal, sem escrever outra pergunta sobre o mesmo momento.
    if (session.queue.some((q) => q.kind === "cola" && (q.status === "queued" || q.status === "blipped"))) return undefined;
    return trigger.lines >= COLA_MIN_LINES ? `acabou de colar um trecho de ${trigger.lines} linhas` : undefined;
  }
  if (trigger.type !== "run") return undefined;

  const earlierRuns = session.events
    .slice(0, session.events.indexOf(trigger))
    .filter((e): e is RunEvent => e.type === "run");
  const passedBefore = earlierRuns.some((e) => allPassed(e.result));

  if (allPassed(trigger.result)) {
    return passedBefore ? undefined : "primeiro run com todos os testes passando (bom momento pra falar de complexidade e da escolha)";
  }
  return passedBefore ? "o código voltou a falhar depois de já ter passado" : undefined;
}

/**
 * O candidato avisou na conversa que concluiu uma etapa: a próxima análise (só ela) trata isso como momento-chave,
 * para a pergunta seguinte já ser sobre o que vem depois.
 */
function consumirEtapaConcluida(session: SessionState, book: AnalystBookkeeping): string | undefined {
  if (session.etapaConcluidaEm === undefined) return undefined;
  session.etapaConcluidaEm = undefined;
  // Uma vez por etapa: sem run novo e na mesma fase, o "terminei" de cada conversa não vira marco de novo
  // (medido: encadeava uma pergunta a cada minuto, furando o intervalo).
  const etapa = { fase: faseDaEntrevista(session), runs: session.events.filter((e) => e.type === "run").length };
  if (book.ultimaEtapa?.fase === etapa.fase && book.ultimaEtapa.runs === etapa.runs) return undefined;
  book.ultimaEtapa = etapa;
  return "o candidato acabou de avisar que concluiu uma etapa (bom momento para olhar o que ele fez como um todo e o próximo passo, na fase em que ele está agora)";
}

/** Uma análise. Nunca lança: erros viram `analyst.lastError`. */
async function analyzeOnce(session: SessionState, book: AnalystBookkeeping, trigger: SessionEvent): Promise<void> {
  const code = latestCode(session);
  if (code.trim() === "") {
    session.analyst.lastOutcome = { t: trigger.t, text: "pulada: código vazio" };
    return;
  }
  // Momento-chave não pula pelo código igual nem espera a janela de 15 s: o candidato tem o que falar.
  const keyMoment = detectKeyMoment(session, trigger) ?? consumirEtapaConcluida(session, book);
  if (keyMoment === undefined && (trigger.type === "pause" || trigger.type === "paste") && code === book.lastCompletedCode) {
    session.analyst.lastOutcome = { t: trigger.t, text: "pulada: código igual à última análise" };
    return;
  }
  const lastStartedAt = session.analyst.lastRunAt;
  if (
    keyMoment === undefined &&
    trigger.type === "pause" &&
    lastStartedAt !== undefined &&
    trigger.t - lastStartedAt < PAUSE_MIN_GAP_MS
  ) {
    deferPause(session, book, trigger, PAUSE_MIN_GAP_MS - (trigger.t - lastStartedAt));
    return;
  }

  const analyst = session.analyst;
  analyst.state = "running";
  analyst.lastTrigger = trigger.type;
  analyst.lastRunAt = trigger.t;
  analyst.runs += 1;

  try {
    const since = book.lastCompletedT ?? -1;
    // Só pede pergunta de foco quando já há ideia no código (como as outras perguntas) e o foco ainda não teve a sua.
    const focoParaPedir = code.trim() === "" ? undefined : focoPendente(session);
    const problem = getProblem(session.config.problemId);
    const fase = faseDaEntrevista(session);
    const system = buildAnalystSystem(session.config, problem);
    const semPergunta = interrupcaoAtrasada(ritmoDaSessao(session, trigger.t)) || tetoDaPerguntaNaIde(session, trigger.t);
    const user = buildAnalystUser({
      fase,
      changedRegion: book.lastCompletedCode === undefined ? undefined : regiaoAlterada(book.lastCompletedCode, code),
      conversations: formatarConversas(conversasFeitas(session)),
      previousThinking: analyst.insights?.candidateThinking || undefined,
      elapsedLabel: formatElapsed(trigger.t),
      trigger: trigger.type,
      language: session.language,
      numberedCode: numberCode(code),
      recentEvents: session.events.flatMap((e) => {
        const line = describeEvent(e);
        return e.t > since && line !== undefined ? [`[${formatElapsed(e.t)}] ${line}`] : [];
      }),
      previousApproach: analyst.insights?.approach,
      // Já perguntadas mas ainda sem conversa (balão na tela): as feitas estão em `conversations`.
      pendingQuestions: session.queue.filter((q) => q.status === "blipped").map((q) => q.question),
      keyMoment,
      focoPendente: focoParaPedir,
      remainingLabel: formatElapsed(Math.max(0, session.config.durationMin * 60_000 - trigger.t)),
      uncovered: uncoveredCriteria(session).map((id) => {
        const c = session.config.criteria.find((item) => item.id === id)!;
        return `${c.id}: ${c.name} — ${c.description}`;
      }),
      hasWorkingSolution: hasWorkingSolution(session),
      mudanca: mudancaParaPrompt(session, formatElapsed),
      // Sem pergunta há um ritmo inteiro (e com cota livre): a análise não pode voltar de mãos vazias.
      // Na IDE, também quando a pergunta da análise chegou ao teto (3 min) e ele escreveu algo novo desde então (#130, item 11).
      semPerguntaHa: semPergunta
        ? formatElapsed(trigger.t - (session.blips.at(-1)?.createdAt ?? 0))
        : undefined,
      trechosPerguntados: trechosParaPrompt(session),
    });

    // Papel "codigo": gemini-3.7-flash no OpenRouter, com o GLM da Featherless de reserva (ver lib/llm/index.ts).
    const perguntaBloqueada = perguntaBloqueadaAgora(session, trigger.t);
    const result = await completeJson({ role: "codigo", system, user, schema: AnalystOutput, semReserva: perguntaBloqueada });
    registrarUsoLlm(session, "analise", result);
    const { questions, focusQuestion, parteFechada, ...insights } = result.data;

    // Cada análise substitui a fila, mas sobrevivem: pergunta adiada pelo candidato ("agora não") e
    // pergunta de momento-chave ainda esperando uma regra (senão a análise seguinte a derrubaria antes
    // de ela aparecer). Pra essas, vale só a checagem de frescor das linhas.
    for (const q of session.queue) {
      const keep = q.kickoff || q.snoozedUntil !== undefined || q.keyMoment !== undefined || q.focusArea !== undefined;
      if (q.status === "queued" && !keep) q.status = "stale";
    }
    analyst.insights = insights;
    analyst.costUsd += result.costUsd;
    analyst.lastDurationMs = result.durationMs;
    analyst.lastError = undefined;
    book.lastCompletedCode = code;
    book.lastCompletedT = trigger.t;

    // Observações pra rubrica: sem duplicata exata (mesmo critério e mesma nota).
    for (const e of result.data.evidence) {
      const duplicate = session.evidence.some((n) => n.criterionId === e.criterionId && n.note === e.note);
      if (!duplicate) {
        session.evidence.push({ t: trigger.t, criterionId: e.criterionId, note: e.note, source: "analyst" });
        // Mostrou sozinho, sem pergunta: o critério sai da agenda.
        if (e.spontaneous) {
          recordOutcome(session, { t: trigger.t, criterionId: e.criterionId, kind: "espontaneo", note: e.note, source: "analyst" });
        }
      }
    }

    const lineCount = code.split("\n").length;
    const criterionIds = new Set(session.config.criteria.map((c) => c.id));
    const working = hasWorkingSolution(session);
    const candidates: { question: Omit<AnalystQuestion, "startLine" | "endLine" | "priority"> & { priority: number }; lines?: LineRange; focusArea?: FocusArea }[] =
      questions
        // Desafio só com código funcionando: antes disso, "dá pra melhorar?" soaria como "tem erro".
        .filter((q) => q.kind !== "desafio" || working)
        .map((q) => ({ question: q, lines: clampLines(q, lineCount) }))
        // Trecho já perguntado duas vezes está explorado (#130, item 13). No teto sem pergunta, passa: melhor repetir o
        // trecho do que deixar a entrevista parada.
        .filter(({ question, lines }) => {
          const repetido = !semPergunta && !keyMoment && assuntoJaExplorado({ kind: question.kind, lines }, session);
          if (repetido) console.info(`[analyst] pergunta descartada (trecho já explorado): ${question.question}`);
          return !repetido;
        });
    // Pergunta de foco: só vale se o código pediu (focoParaPedir) e o modelo devolveu; sem trecho de código.
    if (focoParaPedir && focusQuestion?.question.trim()) {
      const { startLine, endLine, ...rest } = focusQuestion;
      const lines = startLine ? clampLines({ startLine, endLine: endLine ?? startLine }, lineCount) : undefined;
      candidates.push({ question: { ...rest, priority: PRIORIDADE_FOCO }, lines, focusArea: focoParaPedir });
    }
    // Sem abertura de molde e em português claro (#130, itens 13 e 14), antes do filtro, que lê o texto final.
    const termosDaVaga = session.config.jobDescription ?? "";
    for (const c of candidates) {
      c.question = { ...c.question, question: emPortugues(cortarAberturaDeMolde(c.question.question).texto, termosDaVaga) };
    }
    // O tema de aprofundamento também vai pro entrevistador, então passa pelo filtro junto.
    const verdicts = await Promise.all(
      candidates.map(({ question }) =>
        checkQuestion(question.question, question.followUpTopic, question.kind ?? "explicar", {
          code,
          candidateSaid: session.events.flatMap((e) =>
            e.type === "speech" && e.role === "candidate" ? [e.text] : [],
          ).slice(-6),
        }, session),
      ),
    );

    let blocked = 0;
    candidates.forEach(({ question, lines, focusArea }, i) => {
      const verdict = verdicts[i];
      analyst.costUsd += verdict.costUsd;
      if (!verdict.safe) {
        blocked += 1;
        console.info(`[analyst] pergunta rejeitada (${verdict.reason}): ${question.question}`);
        return;
      }
      // A fila nunca perde itens (stale continua lá), então o tamanho dá um id único.
      session.queue.push({
        id: `q-${session.queue.length + 1}`,
        question: question.question,
        followUpTopic: question.followUpTopic,
        topicLabel: question.topicLabel,
        priority: question.priority,
        highlight: lines,
        createdAt: trigger.t,
        status: "queued",
        keyMoment: focusArea ? undefined : keyMoment,
        focusArea,
        parteFechada: parteFechada === true || keyMoment !== undefined,
        fase,
        kind: question.kind ?? "explicar",
        criterionId: question.criterionId && criterionIds.has(question.criterionId) ? question.criterionId : undefined,
      });
    });
    analyst.lastOutcome = {
      t: trigger.t,
      text:
        candidates.length === 0
          ? "o modelo achou que não valia perguntar agora"
          : `${candidates.length} perguntas geradas, ${blocked} barradas pelo filtro`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    analyst.lastError = message;
    analyst.lastOutcome = { t: trigger.t, text: `erro: ${truncate(message, 80)}` };
    console.error("[analyst] falha na análise:", message);
  } finally {
    analyst.state = "idle";
  }
}

/** Já houve run com todos os testes visíveis passando. */
function hasWorkingSolution(session: SessionState): boolean {
  return session.events.some((e) => e.type === "run" && allPassed(e.result));
}

/**
 * Adia um pause que caiu dentro da janela de 15 s: a análise roda uma vez, quando a janela fechar,
 * com o t avançado pelo tempo esperado. Se a sessão acabar antes, o timer não roda.
 */
function deferPause(session: SessionState, book: AnalystBookkeeping, trigger: PauseEvent, waitMs: number): void {
  clearTimeout(book.deferredTimer);
  session.analyst.lastOutcome = {
    t: trigger.t,
    text: `adiada: menos de 15 s desde a última (roda em ${Math.ceil(waitMs / 1000)}s)`,
  };
  book.deferredTimer = setTimeout(() => {
    book.deferredTimer = undefined;
    if (session.ended) return;
    void runAnalyst(session, { ...trigger, t: trigger.t + waitMs });
  }, waitMs);
}

/** Mantém o grifo dentro das linhas do código e com endLine >= startLine. */
function clampLines(question: LineRange, lineCount: number): LineRange {
  const startLine = clamp(question.startLine, 1, lineCount);
  const endLine = clamp(question.endLine, startLine, lineCount);
  return { startLine, endLine };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Linha do evento para o prompt, ou undefined se o tipo não entra no contexto do Analyst. */
function describeEvent(event: SessionEvent): string | undefined {
  switch (event.type) {
    case "run": {
      const failing = event.result.cases.find((c) => !c.passed);
      const detail = failing
        ? ` — caso ${failing.name}: esperado ${failing.expected ?? "?"}, obteve ${failing.got ?? failing.error ?? "?"}`
        : "";
      return `rodou: ${event.result.passed}/${event.result.total} testes passaram${detail}`;
    }
    case "paste":
      return `colou ${event.lines} linhas a partir da linha ${event.startLine}`;
    // As falas de um balão vão inteiras, agrupadas por conversa, em `conversations`. As de fora (microfone
    // aberto: o candidato pensando em voz alta ou falando com o entrevistador) entram aqui, no momento delas.
    case "speech":
      if (event.blipId !== undefined) return undefined;
      return `${event.role === "candidate" ? "falou" : "o entrevistador respondeu"}: "${truncate(event.text, 220)}"`;
    case "hint":
      return "pediu dica";
    case "language_changed":
      return `mudou a linguagem para ${event.language}`;
    case "empecilho":
      return `o entrevistador trouxe uma mudança no problema: ${event.title}`;
    case "blip_closed":
      return "conversa encerrada";
    default:
      return undefined;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Tempo de sessão em mm:ss. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
