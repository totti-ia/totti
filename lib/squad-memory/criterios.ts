/**
 * Os critérios que uma regra da squad pode afetar. São os do catálogo da pré-entrevista
 * (`lib/pre-entrevista/catalogo.ts`) nos dois formatos; `equivalentes` liga os ids da rubrica de
 * system design do cérebro (`lib/agente/kits/rubrica-system-design.ts`), que usa outros nomes.
 */
import type { RegraSquad } from "./tipos";

export type ModoDaEntrevista = "live_coding" | "system_design";

export interface CriterioSquad {
  id: string;
  nome: string;
  /** Ids de outras rubricas que medem a mesma coisa. */
  equivalentes: string[];
  /** Formatos em que o critério existe. Os dois: vale em qualquer um (comunicação, pressão). */
  modos: ModoDaEntrevista[];
}

const LC: ModoDaEntrevista[] = ["live_coding"];
const SD: ModoDaEntrevista[] = ["system_design"];
const AMBOS: ModoDaEntrevista[] = ["live_coding", "system_design"];

export const CRITERIOS_SQUAD: CriterioSquad[] = [
  { id: "abordagem", nome: "Entendimento e abordagem", equivalentes: [], modos: LC },
  { id: "complexidade", nome: "Complexidade", equivalentes: [], modos: LC },
  { id: "corretude", nome: "Corretude e código", equivalentes: [], modos: LC },
  { id: "bordas", nome: "Casos de borda", equivalentes: [], modos: LC },
  { id: "comunicacao", nome: "Comunicação", equivalentes: [], modos: AMBOS },
  { id: "pressao_adaptacao", nome: "Pressão e adaptação", equivalentes: [], modos: AMBOS },
  { id: "requisitos", nome: "Requisitos e escopo", equivalentes: [], modos: SD },
  { id: "estimativa", nome: "Estimativa de escala", equivalentes: ["escalabilidade"], modos: SD },
  { id: "componentes", nome: "Componentes e dados", equivalentes: ["componentes_fluxo", "dados_consistencia"], modos: SD },
  { id: "tradeoffs", nome: "Trade-offs", equivalentes: [], modos: SD },
  { id: "gargalos_falhas", nome: "Gargalos e falhas", equivalentes: ["escalabilidade"], modos: SD },
  { id: "uso_ia_criterio", nome: "Solução com IA", equivalentes: ["uso_ia"], modos: SD },
];

const POR_ID = new Map(CRITERIOS_SQUAD.map((c) => [c.id, c]));

const semAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function criterioValido(id: string): boolean {
  return POR_ID.has(id) || CRITERIOS_SQUAD.some((c) => c.equivalentes.includes(id));
}

export function nomeDoCriterio(id: string): string {
  return POR_ID.get(id)?.nome ?? CRITERIOS_SQUAD.find((c) => c.equivalentes.includes(id))?.nome ?? id;
}

/** Os formatos em que o critério da regra existe (vazio: id fora do catálogo). */
export function modosDoCriterio(id: string): ModoDaEntrevista[] {
  const direto = POR_ID.get(id);
  if (direto) return direto.modos;
  const equivalentes = CRITERIOS_SQUAD.filter((c) => c.equivalentes.includes(id));
  return [...new Set(equivalentes.flatMap((c) => c.modos))];
}

/**
 * A regra pesa nesse critério da rubrica? Vale o mesmo id, um equivalente ou, para a rubrica da vaga (que usa o NOME
 * que a recrutadora deu ao critério), o nome do critério da regra.
 */
export function regraAfeta(regra: Pick<RegraSquad, "criterio">, criterioId: string): boolean {
  if (regra.criterio === criterioId) return true;
  const nomeDaRegra = POR_ID.get(regra.criterio)?.nome;
  if (nomeDaRegra && semAcentos(nomeDaRegra) === semAcentos(criterioId)) return true;
  const daRegra = POR_ID.get(regra.criterio);
  if (daRegra?.equivalentes.includes(criterioId)) return true;
  return POR_ID.get(criterioId)?.equivalentes.includes(regra.criterio) ?? false;
}
