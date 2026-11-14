"use client";

// "Ver resultados": as entrevistas feitas pelo link, da melhor nota para a pior. Cada linha leva ao relatório do
// candidato ("Ver relatório", /relatorio/<id>), onde se decide. Serve aos dois formatos (Live Coding e System Design).
import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { andamentoDa, NOME_ANDAMENTO, type EntrevistaReal } from "@/lib/vagas/entrevistas";
import { NOME_RECOMENDACAO_DO_RESULTADO, ordenarPorNota, type FormatoDaEntrevista } from "@/lib/vagas/cartao";

const NOME_FORMATO: Record<FormatoDaEntrevista, string> = { live_coding: "Live Coding", system_design: "System Design" };

const nota1 = (n: number) => n.toFixed(1).replace(".", ",");
const quando = (t: number) => new Date(t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

const NOME_DECISAO = { avancar: "Avançar", nao_avancar: "Não avançar" } as const;

/** "Avançar", ou onde a entrevista está quando ainda não há nota (com o pontinho que pulsa enquanto roda). */
function textoDaSituacao(e: EntrevistaReal, a: ReturnType<typeof andamentoDa>): React.ReactNode {
  const d = e.decisao;
  if (d) return `Decidido: ${NOME_DECISAO[d.decisao]}`;
  if (e.recommendation) return NOME_RECOMENDACAO_DO_RESULTADO[e.recommendation];
  return (
    <>
      {(a === "fazendo" || a === "gerando") && <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-sucesso align-middle" />}
      {NOME_ANDAMENTO[a]}
    </>
  );
}

export default function ResultadosDaVaga({ reais }: { reais: EntrevistaReal[] }) {
  const ordenadas = useMemo(() => ordenarPorNota(reais), [reais]);
  const comNota = ordenadas.filter((e) => e.overallScore !== undefined).length;
  // A posição só conta para quem tem nota: o resto está "a caminho".
  let posicao = 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-texto">Resultados das entrevistas</h2>
        <span className="text-[13px] text-texto-suave">
          {comNota === 0
            ? "Nenhum resultado pronto ainda"
            : `${comNota} ${comNota === 1 ? "resultado" : "resultados"} · da maior para a menor nota`}
        </span>
      </div>
      <ul className="cartao @container py-1.5">
        {ordenadas.map((e) => (
          <LinhaDeResultado key={e.sessionId} e={e} posicao={e.overallScore !== undefined ? ++posicao : undefined} />
        ))}
      </ul>
    </section>
  );
}

function LinhaDeResultado({ e, posicao }: { e: EntrevistaReal; posicao?: number }) {
  const a = andamentoDa(e);
  const temNota = e.overallScore !== undefined;
  const nome = e.candidato ?? `Candidato ${e.sessionId.slice(0, 6)}`;
  // O mesmo relatório para os dois formatos; enquanto a avaliação roda, a página mostra a tela de espera.
  const href = `/relatorio/${encodeURIComponent(e.sessionId)}`;

  return (
    <li className="linha-lista mx-2 rounded-xl">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 px-3 py-3 transition-colors duration-150 hover:bg-superficie-2/55 @4xl:grid-cols-[24px_minmax(0,1fr)_112px_160px_88px_104px]">
        <span className="numero hidden text-[13px] text-texto-suave/70 @4xl:block" aria-hidden>
          {posicao !== undefined ? posicao : ""}
        </span>

        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[14.5px] text-texto">{nome}</span>
          <span className="numero truncate text-[12.5px] text-texto-suave">
            <span className="@4xl:hidden">{NOME_FORMATO[e.formato]} · </span>
            {quando(e.startedAt)}
          </span>
        </span>

        {/* Telas estreitas: nota, situação e link empilhados à direita. */}
        <span className="flex flex-col items-end gap-0.5 @4xl:hidden">
          {temNota && (
            <span className="flex items-baseline gap-1">
              <span className="titulo-display text-[20px] text-texto">{nota1(e.overallScore!)}</span>
              <span className="numero text-[11.5px] text-texto-suave">/4</span>
            </span>
          )}
          <span className="text-[12.5px] text-texto-suave">{textoDaSituacao(e, a)}</span>
          {e.ended && (
            <Link href={href} className="inline-flex items-center gap-1 text-[12.5px] text-texto underline decoration-texto/25 underline-offset-4 hover:decoration-texto">
              Ver relatório <ArrowRight size={12} />
            </Link>
          )}
        </span>

        {/* Telas largas: uma coluna para cada coisa. */}
        <span className="hidden @4xl:block">
          <span className="rotulo rotulo-neutro">{NOME_FORMATO[e.formato]}</span>
        </span>
        <span className={`hidden text-[13px] @4xl:block ${temNota ? "text-texto" : "text-texto-suave"}`}>{textoDaSituacao(e, a)}</span>
        <span className="hidden items-baseline gap-1.5 @4xl:flex">
          {temNota ? (
            <>
              <span className="titulo-display text-[22px] text-texto">{nota1(e.overallScore!)}</span>
              <span className="numero text-[12px] text-texto-suave">/4</span>
            </>
          ) : (
            <span className="text-texto-suave/40">—</span>
          )}
        </span>
        <span className="hidden text-right @4xl:block">
          {e.ended && (
            <Link href={href} className="inline-flex items-center gap-1 text-[13px] text-texto underline decoration-texto/25 underline-offset-4 hover:decoration-texto">
              Ver relatório <ArrowRight size={13} />
            </Link>
          )}
        </span>
      </div>
    </li>
  );
}
