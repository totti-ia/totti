import { NextResponse } from "next/server";
import { z } from "zod";
import { agendarExtracao, estaOcupada, estadoDaSessao, liberar, ocupar, sincronizarSessao } from "@/lib/pre-entrevista/sessoes";
import { falaDelaNaoEraResposta } from "@/lib/pre-entrevista/conversa";
import { depsQueReaproveitam, prepararRascunho } from "@/lib/pre-entrevista/resposta-antecipada";
import { conduzirTurno } from "@/lib/pre-entrevista/turno";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `copia`: a sessão como a tela a guardou, para reconstruir se esta instância não a tiver (ver `sincronizarSessao`).
// `rascunho`: a resposta antecipada, enquanto ela ainda fala (ver `prepararRascunho`); não grava nada na sessão.
const Corpo = z.object({
  text: z.string().trim().min(1, "fala vazia").max(2000, "fala longa demais"),
  copia: z.unknown().optional(),
  rascunho: z.boolean().optional(),
});

/**
 * Fala da recrutadora. O turno (`conduzirTurno`) registra a fala, mede a cobertura, escolhe o passo e
 * gera a fala do Totti. Só então agenda a extração em segundo plano (menos quando o Totti só repetiu ou esclareceu a
 * pergunta). Se o Totti falhar, a fala sai da
 * transcrição e volta 502, para a recrutadora reenviar sem duplicar nada.
 * Com `rascunho: true`, só prepara a fala (ver `resposta-antecipada.ts`): a confirmação com o mesmo texto reaproveita
 * as chamadas lentas que o rascunho já fez.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lido = Corpo.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return NextResponse.json({ erro: "dados inválidos", erros: lido.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const sessao = sincronizarSessao(id, lido.data.copia);
  if (!sessao) return NextResponse.json({ erro: "sessão não encontrada" }, { status: 404 });

  if (lido.data.rascunho) {
    // Com um turno real em curso, o rascunho não vale: a confirmação já está a caminho.
    if (estaOcupada(id)) return NextResponse.json({ rascunho: false });
    const { fala } = await prepararRascunho(sessao, lido.data.text);
    return NextResponse.json({ rascunho: true, fala });
  }

  if (!ocupar(id)) {
    return NextResponse.json({ erro: "o Totti ainda está respondendo a fala anterior" }, { status: 409 });
  }
  try {
    let movimento: Awaited<ReturnType<typeof conduzirTurno>>["movimento"];
    const { deps, contagem } = depsQueReaproveitam(id);
    const inicio = Date.now();
    try {
      ({ movimento } = await conduzirTurno(sessao, lido.data.text, deps));
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { erro: "o Totti não respondeu; envie a fala de novo", detalhe: mensagem, estado: estadoDaSessao(sessao) },
        { status: 502 },
      );
    }
    const total = contagem.doRascunho + contagem.aoVivo;
    console.log(
      `[pre-entrevista] rascunho ${id} ${contagem.doRascunho}/${total} do rascunho, ${contagem.aoVivo} ao vivo, ${Date.now() - inicio}ms`,
    );
    // Repetição, esclarecimento e fala não entendida: a fala dela não trouxe nada novo para extrair.
    if (!falaDelaNaoEraResposta(movimento)) agendarExtracao(sessao);
    return NextResponse.json(estadoDaSessao(sessao), { headers: { "x-totti-rascunho": `${contagem.doRascunho}/${total}` } });
  } finally {
    liberar(id);
  }
}
