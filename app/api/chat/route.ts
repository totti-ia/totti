import { after, NextResponse } from "next/server";
import { runAnalyst } from "@/lib/agents/analyst";
import { prepararRascunho, turnoComRascunho, type PedidoDoTurno } from "@/lib/agents/rascunho";
import { findBlipQuestion } from "@/lib/agents/policy";
import { ChatRequest } from "@/lib/contracts";
import { pedeRascunho } from "@/lib/conversa/rascunho";
import { guardarSessao, sessaoViva } from "@/lib/session/persistencia";
import { ultimoEvento } from "@/lib/session/eventos";

/** Teto do código aceito na conversa (o mesmo espírito do limite de snapshot). */
const MAX_CODE_CHARS = 100_000;

export const dynamic = "force-dynamic";
// Depois de uma etapa concluída, o analista roda em segundo plano (after) e pode levar alguns segundos.
export const maxDuration = 60;

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = ChatRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sessionId, blipId, messages } = parsed.data;
  // O contrato não carrega o código; ele vem à parte, validado aqui.
  const extra = (body ?? {}) as { code?: unknown; language?: unknown; reconheceu?: unknown };
  const liveCode = typeof extra.code === "string" && extra.code.length <= MAX_CODE_CHARS ? extra.code : undefined;
  const liveLanguage = typeof extra.language === "string" && extra.language.length > 0 && extra.language.length <= 40 ? extra.language : undefined;

  const session = await sessaoViva(sessionId);
  if (!session) {
    return NextResponse.json({ error: "sessão não encontrada" }, { status: 404 });
  }

  // Pergunta que esta instância não conhece (estado atrasado): a fala segue como fala livre, nunca como erro.
  // Um 404 aqui fazia a fala do candidato falhar e o Totti pedir para repetir a cada tentativa.
  const conhecida = blipId === undefined || !!findBlipQuestion(session, blipId);
  if (!conhecida) console.warn("[chat] pergunta desconhecida, seguindo como fala livre:", blipId);

  const pedido: PedidoDoTurno = {
    sessionId,
    blipId,
    messages,
    reconheceu: extra.reconheceu === true,
    liveCode,
    liveLanguage,
    turno: { blipId: conhecida ? blipId : undefined, messages, reconheceu: extra.reconheceu === true },
  };

  // Rascunho (a tela manda a cada trecho confirmado pela transcrição): roda o turno numa cópia e guarda o resultado.
  // Não grava nada: a sessão real segue como está até a confirmação.
  if (pedeRascunho(body)) {
    const rascunho = await prepararRascunho(session, pedido);
    return NextResponse.json(rascunho);
  }

  // Ao vivo ou pelo rascunho com a mesma chave. Antes do snapshot, como o rascunho (a chave é a da sessão de agora).
  const { resposta, doRascunho, ms } = await turnoComRascunho(session, pedido);
  console.info(`[chat] rascunho ${doRascunho ? "usado" : "novo"} em ${ms} ms (sessão ${sessionId.slice(0, 8)})`);
  const response = resposta;
  // Gravar no Supabase (ler a cópia remota, juntar e gravar) são duas idas e voltas: ficam para depois da resposta,
  // que é o que o candidato está esperando ouvir.
  // Concluiu uma etapa: o analista olha o código agora (momento-chave), e a próxima pergunta já vem sobre o que segue.
  const gatilho = ultimoEvento(session);
  after(async () => {
    await guardarSessao(session);
    if (!response.concluded || !gatilho) return;
    await runAnalyst(session, gatilho).catch((err) => console.error("[chat] analista falhou:", err));
    await guardarSessao(session);
  });
  return NextResponse.json(response, { headers: { "x-totti-rascunho": doRascunho ? "usado" : "novo" } });
}
