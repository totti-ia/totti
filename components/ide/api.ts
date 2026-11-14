import { BlipContext, ChatResponse, EventsResponse } from "@/lib/contracts";
import type { ChatRequest, SessionEvent } from "@/lib/contracts";
import type { SessionStateView } from "@/lib/session/types";

/** O servidor recusou o pedido (4xx que não é limite nem tempo esgotado): reenviar não adianta. */
export class ErroDefinitivo extends Error {}

/** POST /api/events. Valida a resposta contra o contrato; erro vira exceção. */
export async function postEvent(event: SessionEvent): Promise<EventsResponse> {
  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    throw new ErroDefinitivo(`POST /api/events respondeu ${res.status}`);
  }
  if (!res.ok) throw new Error(`POST /api/events respondeu ${res.status}`);
  return EventsResponse.parse(await res.json());
}

/** GET /api/blip/pending (polling da IDE). 404 (sessão desconhecida) vira "sem blip". */
export async function getPendingBlip(sessionId: string): Promise<EventsResponse> {
  const res = await fetch(`/api/blip/pending?sessionId=${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`GET /api/blip/pending respondeu ${res.status}`);
  return EventsResponse.parse(await res.json());
}

/** GET /api/state. Devolve null em 404 (antes do primeiro evento). */
export async function getState(sessionId: string): Promise<SessionStateView | null> {
  const res = await fetch(`/api/state?sessionId=${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/state respondeu ${res.status}`);
  return (await res.json()) as SessionStateView;
}

/** GET /api/blip/{id}/context. */
export async function getBlipContext(blipId: string, sessionId: string): Promise<BlipContext> {
  const res = await fetch(
    `/api/blip/${encodeURIComponent(blipId)}/context?sessionId=${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) throw new Error(`GET /api/blip/context respondeu ${res.status}`);
  return BlipContext.parse(await res.json());
}

/** POST /api/chat. */
export async function postChat(req: ChatRequest & { code?: string; language?: string; reconheceu?: boolean }, signal?: AbortSignal): Promise<ChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw new Error(`POST /api/chat respondeu ${res.status}`);
  return ChatResponse.parse(await res.json());
}

/** POST /api/encerramento: o balão da última conversa, ou nada se o agente não tem mais o que perguntar. */
export async function postEncerramento(sessionId: string, gatilho: "concluiu" | "tempo" | "pediu_encerrar" = "concluiu"): Promise<EventsResponse> {
  const res = await fetch("/api/encerramento", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, gatilho }),
  });
  if (!res.ok) throw new Error(`POST /api/encerramento respondeu ${res.status}`);
  return EventsResponse.parse(await res.json());
}

/** POST /api/dev/empecilho (só fora de produção): solta o empecilho da questão agora. */
export async function postForcarEmpecilho(sessionId: string): Promise<EventsResponse & { reason?: string }> {
  const res = await fetch("/api/dev/empecilho", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error(`POST /api/dev/empecilho respondeu ${res.status}`);
  const body = (await res.json()) as { reason?: string };
  return { ...EventsResponse.parse(body), reason: body.reason };
}
