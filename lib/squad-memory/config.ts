/**
 * Liga a memória da squad à config da entrevista: as regras ATIVAS da vaga no momento em que a entrevista começa
 * vão para `config.squadRules`. Desligar uma regra vale já para a próxima entrevista.
 *
 * Entram as regras da vaga (`origem.vagaId`) e as ativas da empresa que afetam algum critério da rubrica dela
 * (`regraAfeta`): o resultado dos 90 dias de uma contratação chega à próxima entrevista que mede o mesmo critério.
 * Regra de outra vaga só entra se for do MESMO formato (`mode`) e afetar um critério da rubrica da vaga: uma regra
 * aprendida num live coding ("valoriza quem pergunta sobre observabilidade antes de codar") não pesa num system design,
 * mesmo que o id do critério se pareça. Cada regra volta marcada com a origem (`origin`: da vaga ou da empresa).
 */
import type { InterviewConfig, SquadRule } from "@/lib/contracts";
import { modosDoCriterio, regraAfeta, type ModoDaEntrevista } from "./criterios";
import { empresaAtual, regrasAtivas } from "./store";
import type { RegraSquad } from "./tipos";

/** A regra no formato do contrato, com a marca de onde veio (a tela mostra "da vaga" ou "da empresa"). */
export type RegraDaSquad = SquadRule & { origin?: "vaga" | "empresa" };

export function paraContrato(r: RegraSquad): RegraDaSquad {
  return { id: r.id, text: r.texto, effect: r.efeito, criterion: r.criterio };
}

/** A vaga de uma config: o `vagaId` dela, ou o próprio id quando a config é a vaga. É o id que as regras gravam. */
export function vagaDaConfig(config: Pick<InterviewConfig, "id" | "vagaId">): string {
  return config.vagaId ?? config.id;
}

/** As regras ativas que vieram desta vaga. Sem vaga: nenhuma. */
export function regrasAtivasDaVaga(vagaId: string | undefined, empresaId = empresaAtual()): RegraSquad[] {
  if (!vagaId) return [];
  return regrasAtivas(empresaId).filter((r) => r.origem.vagaId === vagaId);
}

/** As regras ativas da vaga, no formato do contrato (o que vai para os prompts e o relatório). */
export function regrasDaVaga(vagaId: string | undefined, empresaId = empresaAtual()): SquadRule[] {
  return regrasAtivasDaVaga(vagaId, empresaId).map(paraContrato);
}

/** Todas as regras ativas da empresa (de qualquer vaga). */
export function regrasAtivasDaEmpresa(empresaId = empresaAtual()): RegraSquad[] {
  return regrasAtivas(empresaId);
}

export type OpcoesDasRegras = {
  /** Formato da vaga atual. Informado: regra de outra vaga só entra se for do mesmo formato. Ausente: sem filtro de formato. */
  modo?: ModoDaEntrevista;
  /** Formato de uma vaga pelo id, quando se sabe (a regra não guarda o formato). Sem resposta, deduz-se do critério. */
  modoDaVaga?: (vagaId: string) => ModoDaEntrevista | undefined;
};

/** O formato da vaga de onde a regra veio: o informado, ou o do critério quando ele só existe num formato. */
function modoDaRegra(r: RegraSquad, opcoes: OpcoesDasRegras): ModoDaEntrevista | undefined {
  const daVaga = opcoes.modoDaVaga?.(r.origem.vagaId);
  if (daVaga) return daVaga;
  const modos = modosDoCriterio(r.criterio);
  return modos.length === 1 ? modos[0] : undefined;
}

/**
 * As regras da vaga mais as ativas da empresa que afetam algum dos critérios dados (a rubrica da vaga). Regra de outra
 * vaga só entra se o formato for o mesmo; de formato desconhecido (critério que existe nos dois), fica de fora.
 */
export function regrasParaOsCriterios(
  vagaId: string | undefined,
  criterios: string[],
  empresaId = empresaAtual(),
  opcoes: OpcoesDasRegras = {},
): RegraDaSquad[] {
  const vistas = new Set<string>();
  const regras: RegraDaSquad[] = [];
  const daVaga = regrasAtivasDaVaga(vagaId, empresaId);
  const daEmpresa = regrasAtivasDaEmpresa(empresaId).filter((r) => {
    if (!criterios.some((c) => regraAfeta(r, c))) return false;
    if (!opcoes.modo) return true;
    return modoDaRegra(r, opcoes) === opcoes.modo;
  });
  const candidatas: { regra: RegraSquad; origin: "vaga" | "empresa" }[] = [
    ...daVaga.map((regra) => ({ regra, origin: "vaga" as const })),
    ...daEmpresa.map((regra) => ({ regra, origin: "empresa" as const })),
  ];
  for (const { regra, origin } of candidatas) {
    if (vistas.has(regra.id)) continue;
    vistas.add(regra.id);
    regras.push({ ...paraContrato(regra), origin });
  }
  return regras;
}

/** A config com as regras ativas da vaga dela. Sem regras, a config volta sem `squadRules`. */
export function comRegrasDaSquad(config: InterviewConfig, empresaId = empresaAtual()): InterviewConfig {
  const regras = regrasParaOsCriterios(
    vagaDaConfig(config),
    (config.criteria ?? []).flatMap((c) => [c.id, c.name]),
    empresaId,
    { modo: config.mode },
  );
  if (regras.length === 0) {
    if (!config.squadRules) return config;
    const { squadRules: _semRegras, ...resto } = config;
    void _semRegras;
    return resto;
  }
  return { ...config, squadRules: regras };
}
