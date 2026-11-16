import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SalaEntrevista from "@/components/SalaEntrevista";
import { findConfig } from "@/lib/config/store";
import { ENTREVISTA_ID_VALIDO } from "@/lib/convites/store";
import { salaDaEntrevista } from "@/lib/convites/sala";

export const metadata: Metadata = {
  title: "Entrevista de system design",
};

export const dynamic = "force-dynamic";

/**
 * `?config=<id>` abre a entrevista da vaga (plano gerado pela pré-entrevista): o servidor escolhe o kit e calibra
 * o agente por ele. `?convite=<id>` liga a sessão ao candidato no painel da vaga. Sem `config` (ou com um id
 * desconhecido), abre a entrevista padrão. Plano de live coding vai para o IDE. Com `?convite=` de horário
 * marcado, fora do horário volta para a tela de espera (a raiz com o mesmo link).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ config?: string; convite?: string }> }) {
  const { config, convite } = await searchParams;
  const plano = config ? await findConfig(config) : undefined;
  const conviteValido = convite && ENTREVISTA_ID_VALIDO.test(convite) ? convite : undefined;
  const sala = await salaDaEntrevista(conviteValido);
  if (plano && sala && sala.situacao !== "aberta") redirect(`/?config=${encodeURIComponent(plano.id)}&convite=${conviteValido}`);

  if (plano && plano.mode === "live_coding") {
    redirect(`/entrevista?config=${encodeURIComponent(plano.id)}${conviteValido ? `&convite=${conviteValido}` : ""}`);
  }

  // O quadro usa o tema claro (o resto do app é escuro); ver app/globals.css.
  return (
    <div className="tema-quadro-pagina contents">
      <SalaEntrevista configId={plano?.id} convite={conviteValido} regraDeIa={plano?.regraDeIa} />
    </div>
  );
}
