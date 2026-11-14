// As entrevistas de verdade feitas pelo link da vaga (GET /api/report), ao lado dos dados de
// demonstração. Cada vaga publicada tem um configId; toda sessão aberta pelo link carrega esse id.
import { useEffect, useState } from "react";
import type { ReportListItem } from "@/app/api/report/route";
import type { Funil } from "./candidatos";
import { NOME_RECOMENDACAO_DO_RESULTADO } from "./cartao";

export type EntrevistaReal = ReportListItem;

/** Em que pé está: fazendo, relatório sendo gerado, pronto ou com erro na avaliação. */
export type Andamento = "fazendo" | "gerando" | "pronto" | "erro";

export function andamentoDa(e: EntrevistaReal): Andamento {
  if (!e.ended) return "fazendo";
  if (e.state === "done") return "pronto";
  if (e.state === "error") return "erro";
  return "gerando";
}

export const NOME_ANDAMENTO: Record<Andamento, string> = {
  fazendo: "Fazendo agora",
  gerando: "Gerando relatório",
  pronto: "Relatório pronto",
  erro: "Falhou a avaliação",
};

export const NOME_RECOMENDACAO = NOME_RECOMENDACAO_DO_RESULTADO;

/** Mais rápido enquanto alguém está fazendo ou o relatório está sendo gerado. */
const POLL_ATIVO_MS = 4_000;
const POLL_PARADO_MS = 15_000;

// Um só poller para a página inteira (menu, tela inicial e vaga usam o mesmo hook).
type PorConfig = Record<string, EntrevistaReal[]>;
let ultimo: PorConfig | null = null;
const ouvintes = new Set<(p: PorConfig) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
/** Há um fetch em curso: ele mesmo agenda o próximo, então não se abre um segundo ciclo. */
let emVoo = false;

function carregar() {
  emVoo = true;
  fetch("/api/report", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<EntrevistaReal[]>) : []))
    .catch(() => [] as EntrevistaReal[])
    .then((lista) => {
      emVoo = false;
      const agrupado: PorConfig = {};
      for (const e of lista) (agrupado[e.configId] ??= []).push(e);
      ultimo = agrupado;
      ouvintes.forEach((f) => f(agrupado));
      if (ouvintes.size === 0) return;
      const ativo = lista.some((e) => andamentoDa(e) === "fazendo" || andamentoDa(e) === "gerando");
      timer = setTimeout(carregar, ativo ? POLL_ATIVO_MS : POLL_PARADO_MS);
    });
}

/** Todas as entrevistas reais, agrupadas por configId. `null` antes da primeira resposta. */
export function useEntrevistasReais(): PorConfig | null {
  const [porConfig, setPorConfig] = useState<PorConfig | null>(ultimo);

  useEffect(() => {
    ouvintes.add(setPorConfig);
    if (ouvintes.size === 1 && !emVoo) {
      clearTimeout(timer);
      carregar();
    }
    return () => {
      ouvintes.delete(setPorConfig);
      if (ouvintes.size === 0) clearTimeout(timer);
    };
  }, []);

  return porConfig;
}

/** O funil da demonstração com as entrevistas reais somadas (quem entrou pelo link conta como convidado). */
export function comReais(f: Funil, reais: EntrevistaReal[] = []): Funil {
  if (reais.length === 0) return f;
  let emAndamento = 0;
  let concluiram = 0;
  for (const e of reais) {
    if (andamentoDa(e) === "fazendo") emAndamento++;
    else concluiram++;
  }
  return {
    inscritos: f.inscritos + reais.length,
    convidados: f.convidados + reais.length,
    emAndamento: f.emAndamento + emAndamento,
    concluiram: f.concluiram + concluiram,
    novos: f.novos + concluiram,
  };
}

/**
 * Relatório pronto conta como atualização da vaga: a vaga sobe no painel quando uma entrevista dela fica pronta.
 * Sem hora de conclusão na lista, usa o início da entrevista (fica a minutos do relatório).
 */
export function comUltimoRelatorio<V extends { atualizadaEm?: number }>(v: V, reais: EntrevistaReal[] = []): V {
  const ultima = reais.filter((e) => andamentoDa(e) === "pronto").reduce((m, e) => Math.max(m, e.startedAt), 0);
  if (ultima <= (v.atualizadaEm ?? 0)) return v;
  return { ...v, atualizadaEm: ultima };
}
