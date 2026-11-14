// Endereço antigo do cartão do candidato: o relatório é um só, em /relatorio/<id> (a tela de espera cobre o "ainda gerando").
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PaginaDoResultado({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  redirect(`/relatorio/${encodeURIComponent(sessionId)}`);
}
