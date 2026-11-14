import { NextRequest, NextResponse } from "next/server";
import { enviarConviteDoLote } from "@/lib/convites/envio";
import { loteIdValido, processarLote } from "@/lib/convites/fila";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Progresso do lote de convites: `{ lote, total, enviados, falharam, pendentes, concluido, falhas }`.
 * Cada consulta também move a fila: processa um bloco (respeitando o limite por minuto). O painel faz polling aqui;
 * um cron pode chamar a mesma rota para o envio seguir com a tela fechada.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!loteIdValido(id)) return NextResponse.json({ erro: "lote não encontrado" }, { status: 404 });
  const progresso = await processarLote(id, enviarConviteDoLote);
  if (!progresso) return NextResponse.json({ erro: "lote não encontrado" }, { status: 404 });
  return NextResponse.json(progresso);
}
