import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findConfig } from "@/lib/config/store";
import { enviarConviteDoLote } from "@/lib/convites/envio";
import { enfileirar, lerLote, processarLote } from "@/lib/convites/fila";
import { recebeEmail } from "@/lib/convites/teste";
import { ipDe, reservarEnvioTestador } from "@/lib/convites/testador";
import { urlPublica, verificarUrlPublica } from "@/lib/convites/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  vagaId: z.string().trim().min(1).max(120),
  cargo: z.string().trim().min(1).max(160),
  configId: z.string().trim().min(1).max(80),
  formato: z.enum(["live_coding", "system_design"]),
  duracaoMin: z.number().int().positive().max(480),
  candidatos: z
    .array(
      z.object({
        nome: z.string().trim().min(1).max(120),
        email: z.string().trim().email().max(254),
        /** O próprio testador do site (deixou o e-mail ao publicar): recebe e-mail de verdade, com limite. */
        testador: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(10_000)
    // Um testador por pedido: o campo é de uma pessoa só, e isso fecha a porta para disparo em massa.
    .refine((l) => l.filter((c) => c.testador).length <= 1, "no máximo um testador por pedido"),
});

/**
 * Enfileira os convites do lote e devolve `{ lote, total }` na hora; quem envia é o worker
 * (`GET /api/convites/lote/<id>`, lib/convites/fila.ts), em blocos e com limite por minuto.
 * Recebem email de verdade quem `recebeEmail` (o Lucas) e o testador que deixou o próprio e-mail (dentro do limite de
 * lib/convites/testador.ts); os demais são simulados. O testador continua recebendo na hora, dentro deste pedido.
 */
export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ erro: "corpo inválido" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ erro: "corpo inválido", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  // Config da vaga manda no formato, na duração e no cargo; o corpo é só fallback.
  const config = await findConfig(body.configId);
  const mode = config?.mode ?? body.formato;
  const durationMin = config?.durationMin ?? body.duracaoMin;
  const roleTitle = config?.roleTitle ?? body.cargo;
  const languages = config?.languages ?? ["python", "cpp"];

  let base: string;
  try {
    base = urlPublica(req);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : "URL pública inválida";
    console.warn(`[convites] ${mensagem}`);
    return NextResponse.json({ erro: mensagem }, { status: 503 });
  }

  const itens = body.candidatos.map((c) => {
    const email = c.email.toLowerCase();
    const testador = c.testador === true;
    const real = recebeEmail(email) || (testador && reservarEnvioTestador(ipDe(req.headers), email));
    return { nome: c.nome, email, real, ...(testador ? { testador: true } : {}) };
  });

  // Antes de gastar e-mail de verdade, confere que o endereço público responde (o link do convite precisa abrir).
  if (itens.some((i) => i.real)) {
    const verificacao = await verificarUrlPublica(base, new URL(req.url).origin);
    if (!verificacao.vivo) {
      const mensagem = `O endereço público configurado não responde: ${verificacao.host}`;
      console.warn(`[convites] endereço público sem resposta host=${verificacao.host}`);
      return NextResponse.json({ erro: mensagem }, { status: 502 });
    }
  }

  const { lote, total } = await enfileirar({ vagaId: body.vagaId, cargo: roleTitle, configId: body.configId, mode, durationMin, languages, base }, itens);

  // O testador recebe na hora: manda só ele (sem gastar a cota por minuto dos demais) e devolve o link.
  let testador: { status: "enviado" | "simulado" | "erro"; link?: string; motivo?: string } | undefined;
  if (itens.some((i) => i.testador)) {
    await processarLote(lote, enviarConviteDoLote, { soEstes: (i) => i.testador === true });
    const item = (await lerLote(lote))?.itens.find((i) => i.testador);
    if (item && item.status !== "pendente") testador = { status: item.status, link: item.link, motivo: item.motivo };
  }
  console.log(`[convites] vaga=${body.vagaId} lote=${lote} total=${total} testador=${testador?.status ?? "nao"}`);
  return NextResponse.json({ lote, total, ...(testador ? { testador } : {}) });
}
