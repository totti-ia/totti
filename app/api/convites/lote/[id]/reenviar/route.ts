import { NextRequest, NextResponse } from "next/server";
import { enviarConviteDoLote } from "@/lib/convites/envio";
import { loteIdValido, processarLote, reenviarFalhas } from "@/lib/convites/fila";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Põe de volta na fila os convites que falharam e já processa o primeiro bloco. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!loteIdValido(id)) return NextResponse.json({ erro: "lote não encontrado" }, { status: 404 });
  const r = await reenviarFalhas(id);
  if (!r) return NextResponse.json({ erro: "lote não encontrado" }, { status: 404 });
  const progresso = (await processarLote(id, enviarConviteDoLote)) ?? r.progresso;
  return NextResponse.json({ reenfileirados: r.reenfileirados, ...progresso });
}
