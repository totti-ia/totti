// O relatório mora em /relatorio/<id>, para os dois formatos. Esta rota só guarda o link antigo (?sessionId=...) e,
// sem id, a lista de entrevistas para escolher.
import { redirect } from "next/navigation";
import ListaDeSessoes from "@/components/report/ListaDeSessoes";

export const dynamic = "force-dynamic";

const ID_VALIDO = /^[A-Za-z0-9_-]{1,80}$/;

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ sessionId?: string }> }) {
  const { sessionId } = await searchParams;
  if (sessionId && ID_VALIDO.test(sessionId)) redirect(`/relatorio/${encodeURIComponent(sessionId)}`);
  return <ListaDeSessoes />;
}
