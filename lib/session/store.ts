/**
 * Store em memória das sessões. Fica em globalThis pra sobreviver a hot reload do Next em dev.
 */
import { DEFAULT_CONFIG } from "@/lib/config/default";
import type { InterviewConfig, SessionEvent } from "@/lib/contracts";
import { getLlmStats } from "@/lib/llm";
import { ultimoEvento } from "@/lib/session/eventos";
import type { SessionState, SessionStateView } from "@/lib/session/types";

const globalForSessions = globalThis as typeof globalThis & {
  __convergeSessions?: Map<string, SessionState>;
};
const sessions = (globalForSessions.__convergeSessions ??= new Map<string, SessionState>());

/** Quanto tempo a pergunta adiada ("espera um pouco", ou sem resposta ao pedido de licença) fica fora da fila. Fica aqui pra evitar import circular com a policy. */
export const SNOOZE_MS = 60_000;

export function getSession(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

/** Troca o conteúdo de uma sessão pela cópia restaurada (mantém o objeto, que as outras partes já seguram). */
export function substituirSessao(restaurada: SessionState, destino?: SessionState): void {
  if (!destino) {
    sessions.set(restaurada.sessionId, restaurada);
    return;
  }
  const clock = destino.clock;
  for (const k of Object.keys(destino)) delete (destino as unknown as Record<string, unknown>)[k];
  Object.assign(destino, restaurada);
  if (clock) destino.clock = clock;
}

/** Sessões em memória, da mais recente para a mais antiga. */
export function listSessions(): SessionState[] {
  return [...sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function getOrCreateSession(sessionId: string, config: InterviewConfig = DEFAULT_CONFIG): SessionState {
  const existing = sessions.get(sessionId);
  if (existing) return existing;

  const session: SessionState = {
    sessionId,
    config,
    startedAt: Date.now(),
    events: [],
    codeHistory: [],
    language: config.languages[0],
    analyst: { state: "idle", runs: 0, costUsd: 0 },
    queue: [],
    blips: [],
    hintsUsed: 0,
    ended: false,
    evidence: [],
    coverage: Object.fromEntries(
      config.criteria.map((c) => [c.id, { status: "nao_explorado" as const, outcomes: [] }]),
    ),
    checkIns: [],
  };
  sessions.set(sessionId, session);
  return session;
}

/**
 * Eventos que a IDE reenvia até o servidor confirmar (components/ide/useSession.ts): o código, a colagem, o run e o
 * fim. Um reenvio pode chegar depois de eventos mais novos, então eles entram na linha do tempo na ordem do `t`.
 */
const EVENTOS_REENVIADOS = new Set<SessionEvent["type"]>(["snapshot", "paste", "run", "session_ended"]);

/** O mesmo evento já está na linha do tempo (o reenvio chegou depois de o primeiro envio já ter entrado). */
export function eventoRepetido(session: SessionState, event: SessionEvent): boolean {
  if (!EVENTOS_REENVIADOS.has(event.type)) return false;
  return session.events.some((e) => e.type === event.type && e.t === event.t);
}

/** Posição para inserir pelo `t`: depois do último que não é mais novo (no caso comum, o fim). */
function posicaoPorT<T extends { t: number }>(lista: T[], t: number): number {
  let i = lista.length;
  while (i > 0 && lista[i - 1].t > t) i--;
  return i;
}

export function appendEvent(session: SessionState, event: SessionEvent): void {
  if (EVENTOS_REENVIADOS.has(event.type)) session.events.splice(posicaoPorT(session.events, event.t), 0, event);
  else session.events.push(event);

  switch (event.type) {
    case "session_started":
      session.language = event.language;
      break;
    case "snapshot": {
      const versao = { t: event.t, version: event.version, language: event.language, code: event.code };
      session.codeHistory.splice(posicaoPorT(session.codeHistory, event.t), 0, versao);
      break;
    }
    case "language_changed":
      session.language = event.language;
      break;
    case "hint":
      session.hintsUsed += 1;
      break;
    case "session_ended":
      session.ended = true;
      break;
    case "blip_opened": {
      const question = session.queue.find((q) => q.id === event.blipId);
      if (question) question.status = "asked";
      const coverage = question?.criterionId ? session.coverage[question.criterionId] : undefined;
      if (coverage?.status === "nao_explorado") coverage.status = "em_andamento";
      // pendingBlipId continua até o blip_closed: nada de blip novo com a conversa aberta.
      break;
    }
    case "blip_closed": {
      if (session.pendingBlipId === event.blipId) session.pendingBlipId = undefined;
      // Fechada sem nunca ter sido aberta (a IDE a descartou: perdeu a vez): não volta para a fila.
      const fechada = session.queue.find((q) => q.id === event.blipId);
      if (fechada?.status === "blipped") fechada.status = "stale";
      session.lastConversationEndedAt = event.t;
      break;
    }
    case "blip_snoozed": {
      // Só o balão que está na tela pode ser adiado: um já aberto ou antigo é ignorado.
      if (session.pendingBlipId !== event.blipId) break;
      session.pendingBlipId = undefined;
      const question = session.queue.find((q) => q.id === event.blipId);
      if (question) {
        question.status = "queued";
        question.snoozedUntil = event.t + SNOOZE_MS;
      }
      // Dá respiro: a regra dos 30 s depois de uma conversa também vale pra quem adiou.
      session.lastConversationEndedAt = event.t;
      break;
    }
    default:
      break;
  }
}

/** Tempo de sessão agora, em ms (o mesmo `t` dos eventos, contado pelo servidor). */
export function sessionNow(session: SessionState): number {
  return session.clock ? session.clock() : Date.now() - session.startedAt;
}

/** Código mais recente enviado pela IDE (vazio se ainda não houve snapshot). */
export function latestCode(session: SessionState): string {
  return session.codeHistory.at(-1)?.code ?? "";
}

export function toView(session: SessionState): SessionStateView {
  const lastCodeVersion = session.codeHistory.at(-1);
  const lastEvent = ultimoEvento(session);
  return {
    sessionId: session.sessionId,
    configId: session.config.id,
    roleTitle: session.config.roleTitle,
    language: session.language,
    latestCode: latestCode(session),
    version: lastCodeVersion?.version ?? 0,
    eventCount: session.events.length,
    lastEvent: lastEvent ? { type: lastEvent.type, t: lastEvent.t } : undefined,
    analyst: session.analyst,
    queue: session.queue,
    blips: session.blips,
    pendingBlipId: session.pendingBlipId,
    hintsUsed: session.hintsUsed,
    ended: session.ended,
    evidence: session.evidence,
    coverage: session.coverage,
    checkIns: session.checkIns,
    empecilho: session.empecilho,
    report: reportView(session),
    llm: getLlmStats(),
  };
}

/** Estado da avaliação sem o relatório (que sai em GET /api/report). */
function reportView(session: SessionState): SessionStateView["report"] {
  if (!session.report) return undefined;
  const { state, startedAt, durationMs, hiddenTests, error, costUsd } = session.report;
  return { state, startedAt, durationMs, hiddenTests, error, costUsd };
}

/** Prefixa cada linha com o número, alinhado à direita. */
export function numberCode(code: string): string {
  const lines = code.split("\n");
  const width = String(lines.length).length + 2;
  return lines.map((line, i) => `${String(i + 1).padStart(width)} | ${line}`).join("\n");
}
