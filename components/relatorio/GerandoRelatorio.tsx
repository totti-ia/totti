"use client";

// Enquanto o relatório não existe, para os dois formatos. System Design: pede o scorecard ao servidor (idempotente:
// se o fim da entrevista já pediu, junta-se ao mesmo pedido). Live Coding: consulta /api/report, que responde 202
// enquanto a avaliação roda. Nos dois, recarrega a página quando fica pronto. Sempre dá para voltar.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import Perola from "@/components/totti/Perola";
import VoltarLink from "@/components/VoltarLink";
import type { FormatoDoRelatorio } from "@/lib/relatorio/tipos";

const CURVA = [0.32, 0.72, 0, 1] as const;

/** O que o servidor de fato faz, nessa ordem. */
const ETAPAS_POR_FORMATO: Record<FormatoDoRelatorio, string[]> = {
  system_design: [
    "Lendo a linha do tempo da entrevista",
    "Relacionando falas e desenho com a rubrica",
    "Conferindo cada prova na gravação",
    "Escrevendo o relatório",
  ],
  live_coding: [
    "Lendo a conversa e as execuções do código",
    "Rodando os testes escondidos no código final",
    "Conferindo cada prova na gravação",
    "Escrevendo o relatório",
  ],
};

const NOME_DA_AREA: Record<FormatoDoRelatorio, string> = { system_design: "system design", live_coding: "live coding" };

/**
 * Segundos (desde o pedido) em que cada etapa começa. A geração real leva de 1 a 4,5 min, então as etapas
 * se espaçam para cobrir esse tempo e a última fica esperando até o servidor responder.
 */
const INICIO_DAS_ETAPAS_S = [0, 20, 60, 110];

/** Etapa em andamento para o tempo decorrido; nunca passa da última. */
function etapaNoTempo(segundos: number): number {
  let etapa = 0;
  INICIO_DAS_ETAPAS_S.forEach((inicio, i) => {
    if (segundos >= inicio) etapa = i;
  });
  return etapa;
}

/** 102 -> "1:42". */
function relogio(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

export default function GerandoRelatorio({
  sessaoId,
  area,
  problema,
  formato = "system_design",
}: {
  sessaoId: string;
  /** Texto do cabeçalho ("system design"); sem ele, o nome do formato. */
  area?: string;
  problema: string;
  formato?: FormatoDoRelatorio;
}) {
  const ETAPAS = ETAPAS_POR_FORMATO[formato];
  const router = useRouter();
  const reduzir = useReducedMotion();
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const tentativa = useRef(0);

  const gerar = useCallback(async (reiniciarRelogio = true, manual = false) => {
    const minha = ++tentativa.current;
    setErro(null);
    if (reiniciarRelogio) setSegundos(0);
    try {
      // Live Coding: o GET devolve 202 enquanto avalia; "retry" só na tentativa que a pessoa pediu.
      const r =
        formato === "live_coding"
          ? await fetch(`/api/report?sessionId=${encodeURIComponent(sessaoId)}${manual ? "&retry=1" : ""}`, { cache: "no-store" })
          : await fetch(`/api/sessoes/${encodeURIComponent(sessaoId)}/finalizar`, { method: "POST" });
      if (minha !== tentativa.current) return;
      if (r.status === 202) {
        window.setTimeout(() => { if (minha === tentativa.current) void gerar(false); }, formato === "live_coding" ? 2500 : 3000);
        return;
      }
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { erro?: string; error?: string } | null;
        setErro(corpo?.erro ?? corpo?.error ?? "Não foi possível gerar o relatório agora.");
        return;
      }
      router.refresh();
    } catch {
      if (minha === tentativa.current) setErro("Sem conexão com o servidor.");
    }
  }, [sessaoId, formato, router]);

  useEffect(() => {
    void gerar();
  }, [gerar]);

  // Conta o tempo desde o pedido (pelo relógio, não por ticks, para não atrasar com a aba em segundo plano).
  // As etapas e o indicador de espera derivam desse tempo.
  useEffect(() => {
    if (erro) return;
    const inicio = Date.now();
    setSegundos(0);
    const t = setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 1000);
    return () => clearInterval(t);
  }, [erro]);

  const etapa = etapaNoTempo(segundos);
  const naUltima = etapa === ETAPAS.length - 1;

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-fundo px-6 py-10">
      <div className="w-full max-w-md">
        <VoltarLink texto="Voltar aos resultados" />
      </div>
      <motion.div
        initial={reduzir ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.48, ease: CURVA }}
        className="flex w-full max-w-md flex-col gap-6 rounded-padrao bg-superficie p-8 shadow-flutuante"
      >
        <div className="flex items-center gap-4">
          <Perola estado={erro ? "ocioso" : "pensando"} tamanho={44} />
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[12.5px] text-texto-suave">gerando relatório · entrevista de {area ?? NOME_DA_AREA[formato]}</p>
            <h1 className="titulo-display text-[26px]">{problema}</h1>
          </div>
        </div>

        {erro ? (
          <div className="flex flex-col gap-4">
            <p className="leading-relaxed text-texto-suave">{erro}</p>
            <button
              onClick={() => void gerar(true, true)}
              className="w-fit rounded-full bg-marca px-5 py-2.5 font-medium text-sobre-marca outline-none transition-[opacity,transform] duration-150 ease-suave hover:opacity-90 focus-visible:ring-2 focus-visible:ring-marca focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              Tentar de novo
            </button>
          </div>
        ) : (
          <ol className="flex flex-col gap-3" aria-live="polite">
            {ETAPAS.map((texto, i) => {
              const feita = i < etapa;
              const atual = i === etapa;
              return (
                <li key={texto} className="flex items-center gap-3">
                  {/* Sem AnimatePresence: a bolinha some na hora em que o visto entra, nunca os dois juntos. */}
                  <span className="relative flex size-4 shrink-0 items-center justify-center">
                    {feita ? (
                      <motion.svg
                        viewBox="0 0 16 16"
                        className="size-4 text-sucesso"
                        initial={reduzir ? false : { opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.28, ease: CURVA }}
                        aria-hidden
                      >
                        <motion.path
                          d="M3.5 8.5 6.5 11.5 12.5 4.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.75}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          initial={reduzir ? false : { pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.36, ease: CURVA }}
                        />
                      </motion.svg>
                    ) : (
                      <motion.span
                        className={`size-2 rounded-full ${atual ? "bg-marca" : "bg-superficie-2"}`}
                        animate={atual && !reduzir ? { scale: [1, 1.5, 1], opacity: [1, 0.6, 1] } : { scale: 1, opacity: 1 }}
                        transition={atual && !reduzir ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
                      />
                    )}
                  </span>
                  <span
                    className={`transition-colors duration-300 ease-suave ${atual ? "text-texto" : "text-texto-suave"}`}
                  >
                    {texto}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {!erro && naUltima && (
          <p className="flex items-center gap-2 font-mono text-[12.5px] text-texto-suave">
            <span className="tabular-nums text-texto" aria-hidden>
              {relogio(segundos)}
            </span>
            <span>Pode levar alguns minutos.</span>
          </p>
        )}
        <p className="text-xs leading-relaxed text-texto-suave">
          Costuma levar de 1 a 5 minutos. Toda nota precisa de uma prova da sessão; o que não tiver prova fica sem nota.
        </p>
      </motion.div>
    </main>
  );
}
