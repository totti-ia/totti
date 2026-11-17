import type { Metadata } from "next";
import PreInterview from "@/components/PreInterview";
import SalaFechada from "@/components/SalaFechada";
import Landing from "@/components/landing/Landing";
import { DEFAULT_CONFIG } from "@/lib/config/default";
import { findConfig, normalizarConfig } from "@/lib/config/store";
import { ENTREVISTA_ID_VALIDO } from "@/lib/convites/store";
import { salaDaEntrevista } from "@/lib/convites/sala";
import "./tema-recrutador.css";

type Busca = { searchParams: Promise<{ config?: string; convite?: string }> };

/** Sem `?config=` é a landing (título padrão do layout); com ela, a tela do candidato. */
export async function generateMetadata({ searchParams }: Busca): Promise<Metadata> {
  return (await searchParams).config ? { title: "Antes de começar" } : {};
}

/**
 * `?config=<id>` (o link do candidato) mostra a vaga e leva a entrevista para a mesma config.
 * Sem `?config=`, a raiz é a landing do Totti, para todo mundo: ela não leva ao painel (que fica em /vagas).
 * Com `?convite=` de horário marcado, a entrevista só abre no horário (ver lib/convites/janela.ts): antes,
 * a tela de espera com a contagem; depois, o aviso de horário passado.
 */
export default async function Home({ searchParams }: Busca) {
  const { config, convite } = await searchParams;
  if (!config)
    return (
      <div className="tema-recrutador min-h-dvh">
        <Landing />
      </div>
    );
  const found = await findConfig(config);
  // `?convite=` (link do e-mail de confirmação) segue até a entrevista, pra ela ficar no nome do candidato.
  const conviteValido = convite && ENTREVISTA_ID_VALIDO.test(convite) ? convite : undefined;
  const sala = await salaDaEntrevista(conviteValido);
  if (sala && sala.situacao !== "aberta") return <SalaFechada sala={sala} />;
  return <PreInterview vaga={normalizarConfig(found ?? DEFAULT_CONFIG)} convite={conviteValido} />;
}
