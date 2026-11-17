// POST /api/contato: pedido de demonstração da landing. Pública (sem senha), então tem limite por IP e armadilha de robô.
import { NextRequest, NextResponse } from "next/server";
import { pedirDemonstracao } from "@/lib/contato/demonstracao";
import { EmailDeliveryError } from "@/lib/email/send";

const JANELA_MS = 10 * 60_000;
const MAX_POR_JANELA = 5;
const pedidos = new Map<string, { n: number; ate: number }>();

/** Best-effort, em memória e por instância (igual a lib/email/api.ts): segura o grosso do abuso, não um ataque. */
function limitado(req: NextRequest): boolean {
  const ip = req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const agora = Date.now();
  if (pedidos.size > 1000) for (const [k, v] of pedidos) if (v.ate <= agora) pedidos.delete(k);
  const e = pedidos.get(ip);
  if (!e || e.ate <= agora) {
    pedidos.set(ip, { n: 1, ate: agora + JANELA_MS });
    return false;
  }
  e.n += 1;
  return e.n > MAX_POR_JANELA;
}

export async function POST(req: NextRequest) {
  if (limitado(req)) return NextResponse.json({ erro: "muitos pedidos, tente daqui a pouco" }, { status: 429 });

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ erro: "JSON inválido" }, { status: 400 });
  }

  try {
    const r = await pedirDemonstracao(corpo);
    if (!r.ok) return NextResponse.json({ erro: "campos inválidos", campos: r.campos }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EmailDeliveryError) return NextResponse.json({ erro: "não deu para enviar agora" }, { status: 502 });
    throw err;
  }
}
