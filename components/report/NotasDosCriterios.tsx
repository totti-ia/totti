"use client";

// As notas dos critérios, uma por linha: o nome com a primeira prova embaixo (o porquê da nota, sem precisar clicar),
// a nota com uma palavra que diz o que ela significa e, à direita, o atalho para o momento da entrevista.
// As regras que o Totti aprendeu com o time aparecem numa linha curta embaixo do critério que elas mexeram.
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";

export interface NotaCriterio {
  id: string;
  nome: string;
  /** 1 a 4; null = não explorado. */
  nota: number | null;
  /** Primeira prova em texto: aparece embaixo do nome. */
  resumo?: string;
  /** Índices das provas no painel de momentos, em ordem de tempo. */
  provas: number[];
  /** O que a nota significa na rubrica (nível), em letra pequena embaixo do resumo. */
  detalhe?: string;
  /** Regras da squad que pesaram neste critério ("critério aprendido com o time"); `origem` diz de onde veio. */
  regras?: { texto: string; efeito: "valoriza" | "penaliza"; origem?: "vaga" | "empresa" }[];
}

const ROTULO_DA_REGRA = { vaga: "Regra desta vaga", empresa: "Regra de outra vaga da empresa" } as const;

/** O que cada nota quer dizer, na escala do avaliador (1 a 4). */
const SIGNIFICADO: Record<number, string> = { 4: "Forte", 3: "Bom", 2: "Parcial", 1: "Insuficiente" };

type Props = {
  titulo: string;
  descricao?: string;
  notas: NotaCriterio[];
  onAbrir?: (momento: number) => void;
};

export default function NotasDosCriterios({ titulo, descricao, notas, onAbrir }: Props) {
  const temRegra = notas.some((n) => n.regras?.length);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[17px] font-medium">{titulo}</h2>
        {descricao && <p className="text-sm text-texto-suave">{descricao}</p>}
      </div>
      <ul className="divide-y divide-borda rounded-padrao bg-superficie px-4 sm:px-6">
        {notas.map((n) => (
          <Linha key={n.id} n={n} onAbrir={onAbrir} />
        ))}
      </ul>
      {temRegra && (
        <Link
          href="/vagas/aprendizado"
          className="self-start text-[13px] text-texto-suave underline-offset-4 hover:text-texto hover:underline"
        >
          Ver tudo o que o Totti aprendeu com o time
        </Link>
      )}
    </section>
  );
}

function Linha({ n, onAbrir }: { n: NotaCriterio; onAbrir?: (momento: number) => void }) {
  const abre = !!onAbrir && n.provas.length > 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 py-4 sm:grid-cols-[minmax(0,1fr)_9rem_8.5rem] sm:gap-x-6">
      <div className="flex min-w-0 flex-col gap-1">
        <span className={`text-[15px] font-medium ${n.nota === null ? "text-texto-suave" : ""}`}>{n.nome}</span>
        {n.resumo && <p className="text-[13.5px] leading-snug text-pretty text-texto-suave">{n.resumo}</p>}
        {n.detalhe && <p className="text-[12.5px] leading-snug text-pretty text-texto-suave/80">{n.detalhe}</p>}
        {n.regras?.map((r, i) => (
          <p key={i} className="mt-0.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-texto-suave">
            {r.efeito === "valoriza" ? (
              <ArrowUp size={13} className="mt-px shrink-0" aria-label="Valoriza" />
            ) : (
              <ArrowDown size={13} className="mt-px shrink-0" aria-label="Penaliza" />
            )}
            <span>
              <span className="font-medium text-texto">{r.origem ? ROTULO_DA_REGRA[r.origem] : "Critério do time"}:</span> {r.texto}
            </span>
          </p>
        ))}
      </div>

      <Nota nota={n.nota} />

      <div className="col-span-2 sm:col-span-1 sm:justify-self-end">
        {abre && (
          <button
            type="button"
            onClick={() => onAbrir!(n.provas[0])}
            aria-label={`${n.nome}: ver ${n.provas.length === 1 ? "o momento" : "os momentos"} da entrevista`}
            className="-mx-2 flex items-center gap-0.5 rounded-controle px-2 py-1 text-[13px] text-texto-suave outline-none transition-colors duration-150 hover:bg-superficie-2 hover:text-texto focus-visible:ring-2 focus-visible:ring-marca sm:mx-0"
          >
            {n.provas.length === 1 ? "Ver o momento" : `Ver ${n.provas.length} momentos`}
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

/** Número grande, quatro marcas e a palavra que diz o que a nota significa. Nota baixa ganha a palavra em tinta cheia. */
function Nota({ nota }: { nota: number | null }) {
  if (nota === null) return <span className="text-[13px] text-texto-suave sm:pt-0.5">Não explorado</span>;
  const baixa = nota <= 2;
  return (
    <div className="flex items-center gap-3" aria-label={`${nota} de 4: ${SIGNIFICADO[nota]}`}>
      <span className="numero text-[22px] leading-none font-medium tabular-nums">
        {nota}
        <span className="text-[14px] text-texto-suave">/4</span>
      </span>
      <span className="flex flex-col gap-1.5">
        <span className="hidden gap-[3px] sm:flex" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={`h-1.5 w-4 rounded-full ${i <= nota ? "bg-texto" : "bg-texto/10"}`} />
          ))}
        </span>
        <span className={`text-[12px] leading-none ${baixa ? "rotulo-destaque !h-5 !px-2 !text-[11px]" : "text-texto-suave"}`}>
          {SIGNIFICADO[nota]}
        </span>
      </span>
    </div>
  );
}
