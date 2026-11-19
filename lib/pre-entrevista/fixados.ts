/**
 * Campos que a recrutadora editou na revisão e que o automático (extração em segundo plano, pesos, leitura da fala)
 * não pode sobrescrever. Um campo fixado só volta a ser automático quando ela fala daquele campo de novo.
 * Na dúvida, a edição manual vence: sinal que não aponta um campo não solta nada.
 *
 * Mapeamento sinal -> campo solto (ver `camposFalados`):
 *  - quer_<área>, dispensa_<área>, disse_equilibrio, disse_divisao, pediu_equilibrio, escolheu_proxima_etapa,
 *    escolheu_seguir_sem                                                           -> focus e criteria
 *  - escolheu_trocar_formato (aceitar a troca muda o formato), pediu_system_design,
 *    pediu_live_coding (e formato lido da fala)                                    -> mode, focus e criteria
 *  - pediu_mudanca (mudança sem dizer o quê: o mais provável é um critério)        -> criteria
 *  - quer_tom_*, quer_sem_dicas, quer_dicas, disse_eliminatorio                    -> recruiterNotes (o guia traz tom, dicas e eliminatório)
 *  - nível dito na fala (`nivelDito`, vira `seniority` no rascunho)                -> seniority
 *  - duração dita na fala (`lerDuracao`)                                           -> durationMin
 *  - soltar mode, focus ou criteria solta também recruiterNotes: o guia (O que mais importa, Menos importante,
 *    Não avaliado) é refeito a partir deles, e notas fixadas ficariam contradizendo o foco novo.
 *  - conducao nunca é solta pela fala: o que ela apagou ou reescreveu não volta, e instrução nova ainda entra
 *    (ver `reaplicarFixados`).
 */
import { normalizarTexto } from "./frases";
import { alinharPesos, type CampoFixado, type Rascunho } from "./rascunho";

const CAMPOS: CampoFixado[] = ["mode", "seniority", "focus", "criteria", "recruiterNotes", "durationMin", "conducao", "regraDeIa"];
const AREAS = ["tecnico", "escala_produto", "pressao", "uso_ia"];

/** Recorte comparável de cada campo (pesos em 2 casas, para a tela e o servidor concordarem). */
function valorDe(r: Rascunho, campo: CampoFixado): unknown {
  const duas = (n: number) => Math.round(n * 100) / 100;
  switch (campo) {
    case "focus":
      return [...r.focus].map((f) => ({ area: f.area, weight: duas(f.weight) })).sort((a, b) => a.area.localeCompare(b.area));
    case "criteria":
      return r.criteria.map((c) => ({ ...c, weight: duas(c.weight) }));
    default:
      return r[campo] ?? null;
  }
}

/**
 * Campos que `novo` mudou em relação a `atual`. Trocar o formato mexe nos critérios e no foco (a revisão os refaz),
 * e mudar o foco mexe nos critérios: entram juntos.
 */
export function camposMudados(atual: Rascunho, novo: Rascunho): CampoFixado[] {
  const mudou = new Set(CAMPOS.filter((c) => JSON.stringify(valorDe(atual, c)) !== JSON.stringify(valorDe(novo, c))));
  if (mudou.has("mode")) {
    mudou.add("focus");
    mudou.add("criteria");
  }
  if (mudou.has("focus")) mudou.add("criteria");
  return CAMPOS.filter((c) => mudou.has(c));
}

/** Junta listas de instruções sem repetir (compara sem acento, maiúscula nem pontuação), mantendo a ordem. */
export function somarVistas(...listas: string[][]): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const s of listas.flat()) {
    const k = normalizarTexto(s);
    if (!k || vistas.has(k)) continue;
    vistas.add(k);
    saida.push(s);
  }
  return saida;
}

/** Soma `campos` aos fixados do rascunho. Função pura. */
export function fixarCampos(r: Rascunho, campos: CampoFixado[]): Rascunho {
  return {
    ...r,
    fixados: CAMPOS.filter((c) => r.fixados.includes(c) || campos.includes(c)),
    conducaoVista: somarVistas(r.conducaoVista, r.conducao),
  };
}

/** Do que ela falou nesta fala, fora dos sinais: o nível dito e a duração dita. */
export interface FalaDela {
  nivelDito?: boolean;
  duracaoDita?: boolean;
}

/** Campos de que a fala (pelos sinais do turno) tratou. `limiar` é o `LIMIAR` de `cobertura.ts`. Função pura. */
export function camposFalados(sinais: Record<string, number>, fala: FalaDela, limiar: number): Set<CampoFixado> {
  const tem = (id: string) => (sinais[id] ?? 0) >= limiar;
  const soltos = new Set<CampoFixado>();
  const soltar = (...c: CampoFixado[]) => c.forEach((x) => soltos.add(x));
  if (
    AREAS.some((a) => tem(`quer_${a}`) || tem(`dispensa_${a}`)) ||
    ["disse_equilibrio", "disse_divisao", "pediu_equilibrio", "escolheu_proxima_etapa", "escolheu_seguir_sem"].some(tem)
  ) {
    soltar("focus", "criteria");
  }
  // Aceitar a troca de formato muda o modo do plano (ver `aplicarTroca`); pedir o formato também.
  if (tem("escolheu_trocar_formato") || tem("pediu_system_design") || tem("pediu_live_coding")) soltar("mode", "focus", "criteria");
  // Mudança sem dizer o quê: o Totti confirma uma mudança de critério, que não pode ser desfeita em silêncio.
  if (tem("pediu_mudanca")) soltar("criteria");
  if (["quer_tom_desafiador", "quer_tom_amigavel", "quer_sem_dicas", "quer_dicas", "disse_eliminatorio"].some(tem)) soltar("recruiterNotes");
  if (fala.nivelDito) soltar("seniority");
  if (fala.duracaoDita) soltar("durationMin");
  // As notas são geradas do foco, dos pesos e do modo: se algum deles volta a ser automático, elas também.
  if (soltos.has("mode") || soltos.has("focus") || soltos.has("criteria")) soltar("recruiterNotes");
  return soltos;
}

/** Tira dos fixados do rascunho os campos que ela voltou a falar. Função pura. */
export function soltarCampos(r: Rascunho, soltos: Set<CampoFixado>): Rascunho {
  if (soltos.size === 0) return r;
  return { ...r, fixados: r.fixados.filter((c) => !soltos.has(c)) };
}

/**
 * Devolve a `novo` o valor de cada campo fixado em `base` (o rascunho de antes da escrita automática) e mantém os
 * fixados de `base`. Critérios fixados só valem nas áreas que ainda estão no foco; área nova no foco fica com os
 * critérios que `novo` trouxe. Função pura.
 */
export function reaplicarFixados(base: Rascunho, novo: Rascunho): Rascunho {
  const fixados = base.fixados;
  // Toda instrução que o automático já produziu fica registrada, para separar depois a que ela apagou ou reescreveu na
  // revisão (não volta) da que o extrator traz de novo numa fala seguinte (entra).
  const conducaoVista = somarVistas(base.conducaoVista, base.conducao, novo.conducao);
  if (fixados.length === 0) return { ...novo, fixados: [], conducaoVista };
  const r: Rascunho = { ...novo, fixados, conducaoVista };
  if (fixados.includes("mode")) {
    r.mode = base.mode;
    if (base.mode !== novo.mode) {
      r.problemId = base.problemId;
      r.pedidoProblema = base.pedidoProblema;
    }
  }
  if (fixados.includes("seniority")) r.seniority = base.seniority;
  if (fixados.includes("recruiterNotes")) r.recruiterNotes = base.recruiterNotes;
  if (fixados.includes("durationMin")) r.durationMin = base.durationMin;
  if (fixados.includes("regraDeIa")) r.regraDeIa = base.regraDeIa;
  if (fixados.includes("conducao")) {
    // A lista dela vale. Do extrator só entra o que ela não tinha e que o automático ainda não tinha produzido antes da
    // edição: linha apagada ou reescrita na revisão está em `conducaoVista` e não volta; instrução nova entra.
    const conhecidas = new Set([...base.conducaoVista, ...base.conducao].map(normalizarTexto));
    r.conducao = somarVistas(base.conducao, novo.conducao.filter((l) => !conhecidas.has(normalizarTexto(l))));
  }
  if (fixados.includes("focus")) r.focus = base.focus;
  if (fixados.includes("criteria")) {
    const areas = new Set(r.focus.map((f) => f.area));
    const dela = base.criteria.filter((c) => areas.has(c.focus));
    const areasDela = new Set(dela.map((c) => c.focus));
    const doAutomatico = novo.criteria.filter((c) => !areasDela.has(c.focus) && areas.has(c.focus));
    r.criteria = alinharPesos([...dela, ...doAutomatico], r.focus);
    r.origens = { ...novo.origens, ...Object.fromEntries(dela.map((c) => [c.id, base.origens[c.id] ?? "catalogo"] as const)) };
  }
  return r;
}
