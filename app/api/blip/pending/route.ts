/**
 * GET /api/blip/pending?sessionId=... — a IDE faz polling a cada ~3 s, pra o blip aparecer
 * mesmo com o candidato parado (sem evento novo, POST /api/events não responde nada).
 * decideBlip só levanta blip com o candidato parado e a sessão ativa (regra fica lá dentro).
 */
import { NextRequest, NextResponse } from "next/server";
import { faseDaEntrevista } from "@/lib/agents/fase";
import { decideBlip } from "@/lib/agents/policy";
import type { EventsResponse } from "@/lib/contracts";
import { sessionNow } from "@/lib/session/store";
import { guardarSessao, sessaoViva } from "@/lib/session/persistencia";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
  const session = await sessaoViva(sessionId);
  if (!session) {
    return NextResponse.json({ error: "sessão não encontrada" }, { status: 404 });
  }

  const t = sessionNow(session);
  const { blip, dismissBlipId } = decideBlip(session, t);
  if (blip || dismissBlipId) await guardarSessao(session);
  const response: EventsResponse = { blip, dismissBlipId, fase: faseDaEntrevista(session) };
  return NextResponse.json(response);
}
