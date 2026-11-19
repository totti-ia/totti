/**
 * Rascunho do InterviewConfig, preenchido aos poucos durante a pré-entrevista.
 *
 * Começa com o que o classificador (Jev) sugeriu. A conversa com a recrutadora
 * vai completando e corrigindo os campos. No fim, `paraInterviewConfig` valida
 * e gera o `InterviewConfig` que o agente entrevistador usa.
 */
import { z } from "zod";
import { Criterion, FocusArea, InterviewConfig, InterviewMode } from "@/lib/contracts";
import type { Classificacao, Vaga } from "./classificador";
import { problems } from "@/lib/problems";
import { selecionarProblema } from "@/lib/problems/selecao";
import { CATALOGO, criteriosIniciais, modoAtivo, problemaPadrao } from "./catalogo";
import { LINGUAGENS_IDE } from "./linguagens";
import { notaDoTema, problemaFixado } from "./problema-pedido";

/** Uma fala da conversa de pré-entrevista. */
/**
 * Uma fala da conversa. `naoEntendida`: fala dela que o Totti não entendeu (transcrição quebrada, sem relação com a
 * pergunta); fica na tela e no contexto do modelo, mas não vai para a extração nem para a cobertura (issue #76).
 */
export type Turno = { role: "recrutadora" | "agente"; text: string; naoEntendida?: true };

/**
 * O que a recrutadora decidiu quando o formato não mede uma área: troca de formato, deixa para a próxima etapa
 * ou segue sem a área. Ver `planejador.ts` (oferta) e `turno.ts` (aplicação).
 */
export type DecisaoTradeoff = "trocou" | "proxima_etapa" | "seguir_sem";
export type DecisoesTradeoff = Partial<Record<FocusArea, DecisaoTradeoff>>;

/** Áreas que ficaram de fora da avaliação por decisão da recrutadora (próxima etapa ou seguir sem). */
export function areasFora(decisoes: DecisoesTradeoff): FocusArea[] {
  return (Object.keys(decisoes) as FocusArea[]).filter((a) => decisoes[a] === "proxima_etapa" || decisoes[a] === "seguir_sem");
}

/** "a", "a e b", "a, b e c". */
export function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** Duração padrão quando a recrutadora não disse nada. */
export const DURACAO_PADRAO: Record<InterviewMode, number> = {
  live_coding: 30,
  system_design: 45,
};

/**
 * Duração que vale agora: a que ela disse na conversa (preferências, lida direto da fala), depois a do extrator,
 * e por fim o padrão do formato.
 */
export function duracaoDoRascunho(r: { mode: InterviewMode; durationMin?: number }, preferencias?: { duracaoMin?: number }): number {
  return preferencias?.duracaoMin ?? r.durationMin ?? DURACAO_PADRAO[r.mode];
}

/** Sem restrição da recrutadora, o candidato escolhe na IDE entre todas as linguagens que ela roda. */
const LINGUAGENS: string[] = [...LINGUAGENS_IDE];

export const Foco = z.object({ area: FocusArea, weight: z.number().min(0).max(1) });
export type Foco = z.infer<typeof Foco>;

/**
 * De onde veio um critério: a fala da recrutadora que o justifica (`turno` é o número da fala na transcrição,
 * 1 = abertura do Totti), ou o catálogo, quando ela não falou dele. Interno: não vai no InterviewConfig.
 */
export const Origem = z.union([z.object({ fala: z.string(), turno: z.number().int() }), z.literal("catalogo")]);
export type Origem = z.infer<typeof Origem>;

/**
 * Campos que a recrutadora pode editar na revisão. Um campo editado fica "fixado": a extração e os pesos
 * automáticos não o sobrescrevem até ela falar daquele campo de novo (ver `fixados.ts`).
 */
export const CampoFixado = z.enum(["mode", "seniority", "focus", "criteria", "recruiterNotes", "durationMin", "conducao", "regraDeIa"]);
export type CampoFixado = z.infer<typeof CampoFixado>;

export const Rascunho = z.object({
  mode: InterviewMode,
  regraDeIa: InterviewConfig.shape.regraDeIa,
  roleTitle: z.string(),
  jobDescription: z.string().optional(),
  seniority: InterviewConfig.shape.seniority,
  focus: z.array(Foco),
  criteria: z.array(Criterion),
  recruiterNotes: z.string().default(""),
  durationMin: z.number().int().positive().optional(),
  problemId: z.string().optional(),
  /**
   * Questão que ela pediu pelo nome (ver `problema-pedido.ts`). `reconhecido`: está no banco e fica fixada em `problemId`;
   * `nao_existe`: não está no banco; `system_design`: no quadro a questão é gerada para a vaga (`tema` vira contexto);
   * `sorteio`: ela preferiu o sorteio. `turno` é a fala dela que trouxe o pedido. Interno: não vai no InterviewConfig.
   */
  pedidoProblema: z
    .object({
      texto: z.string(),
      resultado: z.enum(["reconhecido", "nao_existe", "system_design", "sorteio"]),
      turno: z.number().int(),
      origem: z.enum(["fala", "extrator"]),
      tema: z.string().optional(),
    })
    .optional(),
  /** Se a recrutadora já confirmou (ou corrigiu) o que o Jev sugeriu. */
  confirmado: z.object({ mode: z.boolean(), seniority: z.boolean(), focus: z.boolean() }),
  /** Probabilidade máxima já observada de cada tópico estar coberto (ver `cobertura.ts`). Só sobe. */
  cobertura: z.record(z.string(), z.number()).default({}),
  /** Ids de tópicos ainda não cobertos na conversa (derivado de `cobertura`). */
  pendencias: z.array(z.string()),
  /** Origem de cada critério (interno). Ver `pesos.ts`. */
  origens: z.record(z.string(), Origem).default({}),
  /** Trechos literais em que ela disse que algo reprova o candidato sozinho (interno; vão para o guia). */
  eliminatorios: z.array(z.string()).default([]),
  /** Trecho literal em que ela falou do time, da empresa ou do momento da contratação (interno; vai para o guia). */
  contexto: z.string().default(""),
  /** Campos editados à mão na revisão, que o automático não sobrescreve (interno: não vai no InterviewConfig). */
  fixados: z.array(CampoFixado).default([]),
  /** Instruções de como o Totti conduz a entrevista (vão para `conductNotes` da config; não entram na nota). */
  conducao: z.array(z.string()).default([]),
  /**
   * Instruções de condução que o automático já produziu, mesmo as que ela depois apagou ou reescreveu na revisão (interno).
   * Serve para a extração não trazer de volta o que ela tirou, sem barrar instrução nova (ver `reaplicarFixados`).
   */
  conducaoVista: z.array(z.string()).default([]),
});
export type Rascunho = z.infer<typeof Rascunho>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reescala os pesos dos critérios para que a soma de cada área, dividida pela soma total,
 * seja igual ao peso da área no foco. Mantém a proporção entre critérios da mesma área.
 * A soma total fica em N (número de critérios), então a média dos pesos fica perto de 1.
 * Pesos arredondados em 2 casas e nunca abaixo de 0,01. Função pura.
 */
export function alinharPesos(criteria: Criterion[], focus: Foco[]): Criterion[] {
  const n = criteria.length;
  if (n === 0) return criteria;

  const areas = [...new Set(criteria.map((c) => c.focus))];
  const pesoDaArea = (a: FocusArea) => focus.find((f) => f.area === a)?.weight ?? 0;
  // Área de foco sem critério não recebe peso: as outras se dividem o total.
  const somaFoco = areas.reduce((acc, a) => acc + pesoDaArea(a), 0);

  return criteria.map((c) => {
    const somaGrupo = criteria.filter((x) => x.focus === c.focus).reduce((acc, x) => acc + x.weight, 0);
    const alvoGrupo = somaFoco > 0 ? (pesoDaArea(c.focus) / somaFoco) * n : n / areas.length;
    return { ...c, weight: Math.max(0.01, round2((c.weight / somaGrupo) * alvoGrupo)) };
  });
}

/** Para cada área do foco: peso no foco e soma real dos pesos dos critérios / soma total. Para conferência. */
export function somaPorArea(criteria: Criterion[], focus: Foco[]): Array<{ area: FocusArea; noFoco: number; nosCriterios: number }> {
  const total = criteria.reduce((acc, c) => acc + c.weight, 0);
  return focus.map((f) => {
    const soma = criteria.filter((c) => c.focus === f.area).reduce((acc, c) => acc + c.weight, 0);
    return { area: f.area, noFoco: f.weight, nosCriterios: total > 0 ? round2(soma / total) : 0 };
  });
}

/** Reescala os pesos do foco para somar 1, corrigindo o arredondamento na primeira área. */
function normalizarPesosDoFoco(focus: Foco[]): Foco[] {
  const soma = focus.reduce((acc, f) => acc + f.weight, 0);
  if (focus.length === 0 || soma <= 0) return focus;
  const pesos = focus.map((f) => ({ area: f.area, weight: round2(f.weight / soma) }));
  const diff = round2(1 - pesos.reduce((acc, p) => acc + p.weight, 0));
  pesos[0].weight = round2(pesos[0].weight + diff);
  return pesos;
}

/** Tira áreas do foco e dos critérios e reescala. Nunca deixa o foco vazio: nesse caso devolve o rascunho como está. Função pura. */
export function retirarAreas(r: Rascunho, areas: FocusArea[]): Rascunho {
  if (areas.length === 0) return r;
  const restante = r.focus.filter((f) => !areas.includes(f.area));
  if (restante.length === 0) return r;
  const focus = normalizarPesosDoFoco(restante);
  const criteria = alinharPesos(
    r.criteria.filter((c) => !areas.includes(c.focus)),
    focus,
  );
  return { ...r, focus, criteria };
}

/** Põe uma área no foco, com o mesmo peso das outras (1/(n+1)), e reescala. Se já estava, não muda. Função pura. */
export function incluirArea(r: Rascunho, area: FocusArea): Rascunho {
  if (r.focus.some((f) => f.area === area)) return r;
  const focus = normalizarPesosDoFoco([...r.focus, { area, weight: 1 / (r.focus.length + 1) }]);
  return { ...r, focus };
}

/**
 * Muda o formato: critérios do catálogo do novo modo, só para as áreas do foco. Problema escolhido para o modo
 * antigo não serve para o novo, então volta ao padrão. Função pura.
 */
export function mudarModo(r: Rascunho, modo: InterviewMode): Rascunho {
  if (r.mode === modo) return r;
  const areas = r.focus.map((f) => f.area);
  const criteria = alinharPesos(
    criteriosIniciais(modo, areas).filter((c) => areas.includes(c.focus)),
    r.focus,
  );
  return { ...r, mode: modo, criteria, problemId: undefined, pedidoProblema: undefined };
}

/** Formato desligado pela trava (`SYSTEM_DESIGN_ATIVO = false`) volta para live coding; com ela ligada, não muda nada. Função pura. */
export function rascunhoNoFormatoAtivo(r: Rascunho): Rascunho {
  return modoAtivo(r.mode) ? r : mudarModo(r, "live_coding");
}

/**
 * Aplica ao rascunho as decisões de troca de formato já tomadas. Áreas "trocou" entram no foco; áreas
 * "proxima_etapa" e "seguir_sem" saem do foco e dos critérios; o formato escolhido prevalece. Usado depois de
 * cada extração, para que o extrator nunca recoloque uma área que a recrutadora deixou de fora. Função pura.
 */
export function aplicarDecisoesTradeoff(r: Rascunho, decisoes: DecisoesTradeoff, modoEscolhido?: InterviewMode): Rascunho {
  let novo = r;
  for (const area of Object.keys(decisoes) as FocusArea[]) {
    if (decisoes[area] === "trocou") novo = incluirArea(novo, area);
  }
  novo = retirarAreas(novo, areasFora(decisoes));
  if (modoEscolhido) novo = mudarModo(novo, modoEscolhido);
  return novo;
}

/**
 * Área que estava no foco e que o patch tirou sem pedido volta com o peso anterior: o foco é renormalizado e os
 * critérios dela (que o patch também perdeu) voltam. Só pode sair do foco a área que `podeSair` aceita (dispensa
 * observada ou decisão de troca). Devolve as áreas restauradas, para o aviso no log. Função pura.
 */
export function manterAreasSemPedido(
  anterior: Rascunho,
  novo: Rascunho,
  podeSair: (area: FocusArea) => boolean,
): { rascunho: Rascunho; restauradas: FocusArea[] } {
  const noNovo = new Set(novo.focus.map((f) => f.area));
  const restauradas = anterior.focus.filter((f) => !noNovo.has(f.area) && !podeSair(f.area));
  if (restauradas.length === 0) return { rascunho: novo, restauradas: [] };
  const focus = normalizarPesosDoFoco([...novo.focus, ...restauradas]);
  const criteriosDeVolta = anterior.criteria.filter(
    (c) => restauradas.some((f) => f.area === c.focus) && !novo.criteria.some((n) => n.id === c.id),
  );
  const criteria = alinharPesos([...novo.criteria, ...criteriosDeVolta], focus);
  return { rascunho: { ...novo, focus, criteria }, restauradas: restauradas.map((f) => f.area) };
}

/** Texto da nota que lista as áreas e competências fora desta entrevista. Sempre a mesma frase, para não duplicar. */
const PREFIXO_NAO_AVALIADO = "Não avaliado nesta entrevista:";

/**
 * Acrescenta a frase "Não avaliado nesta entrevista: X, Y." às notas, trocando a que já estiver lá. Função pura.
 */
export function acrescentarNaoAvaliado(notas: string, naoAvaliado: string[]): string {
  const semFrase = notas.replace(new RegExp(`${PREFIXO_NAO_AVALIADO}[^.]*\\.\\s*`, "g"), "").trim();
  if (naoAvaliado.length === 0) return semFrase;
  return [semFrase, `${PREFIXO_NAO_AVALIADO} ${listar(naoAvaliado)}.`].filter(Boolean).join(" ");
}

/** Pré-preenche o rascunho a partir da classificação da vaga. Nada confirmado ainda. */
export function criarRascunho(vaga: Vaga, c: Classificacao): Rascunho {
  const mode = c.mode.value;
  const focus = c.focus;
  return {
    mode,
    roleTitle: vaga.roleTitle,
    jobDescription: vaga.jobDescription,
    seniority: c.seniority.value,
    focus,
    criteria: alinharPesos(
      criteriosIniciais(
        mode,
        focus.map((f) => f.area),
      ),
      focus,
    ),
    recruiterNotes: "",
    confirmado: { mode: false, seniority: false, focus: false },
    cobertura: {},
    pendencias: [],
    origens: {},
    eliminatorios: [],
    contexto: "",
    fixados: [],
    conducao: [],
    conducaoVista: [],
  };
}

function gerarId(): string {
  return `cfg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Questão da entrevista. Se a recrutadora pediu uma do banco, vale a dela, fixada (sem sorteio na entrevista) e com o
 * nível da própria questão. Senão, em live coding o agente escolhe do banco pelo nível da senioridade e pelo foco da
 * vaga (ver `lib/problems/selecao.ts`), e a entrevista sorteia entre as do mesmo nível e foco.
 */
function escolherProblema(r: Rascunho): { problemId: string; difficulty?: "facil" | "medio"; problemaFixado?: true } {
  if (r.mode !== "live_coding") {
    const textoDaVaga = `${r.roleTitle}\n${r.jobDescription ?? ""}`;
    return { problemId: r.problemId ?? problemaPadrao(r.mode, r.focus, textoDaVaga) };
  }
  const fixado = problemaFixado(r);
  if (fixado) return { problemId: fixado.id, difficulty: fixado.difficulty, problemaFixado: true };
  if (r.problemId && problems[r.problemId]) return { problemId: r.problemId, difficulty: problems[r.problemId].difficulty };
  const escolhida = selecionarProblema({ seniority: r.seniority, focus: r.focus, semente: r.roleTitle });
  return { problemId: escolhida.id, difficulty: escolhida.difficulty };
}

/** Live coding com área técnica precisa do critério "corretude" para receber o resultado dos testes. */
function precisaCorretude(r: Rascunho): boolean {
  return r.mode === "live_coding" && !r.criteria.some((c) => c.id === "corretude") && r.focus.some((f) => f.area === "tecnico");
}

/** Critério "corretude" do catálogo, com o menor peso dos critérios atuais (ou 1 se não há nenhum). Função pura. */
function criterioCorretude(atuais: Criterion[]): Criterion {
  const base = CATALOGO.live_coding.find((c) => c.id === "corretude");
  if (!base) throw new Error("catálogo live_coding sem o critério corretude");
  const peso = atuais.length > 0 ? Math.min(...atuais.map((c) => c.weight)) : 1;
  return { ...base, weight: peso };
}

/**
 * Valida o rascunho e gera o `InterviewConfig`, ou devolve as mensagens de erro.
 * `naoAvaliado` entra nas notas finais como "Não avaliado nesta entrevista: ...".
 */
export function paraInterviewConfig(
  r: Rascunho,
  preferencias?: { duracaoMin?: number; linguagens?: string[]; tom?: "amigavel" | "desafiador"; dicas?: "leves" | "nenhuma" | "livres" },
  naoAvaliado: string[] = [],
): { ok: true; config: InterviewConfig } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  const conducao = r.conducao.map((l) => l.trim()).filter(Boolean);

  if (r.focus.length === 0) erros.push("focus: precisa de pelo menos uma área");
  const areas = new Set(r.focus.map((f) => f.area));
  for (const c of r.criteria) {
    if (!areas.has(c.focus)) erros.push(`criteria.${c.id}: foco "${c.focus}" fora das áreas de foco`);
  }

  // Sem o critério "corretude" o agente não recebe o resultado dos testes escondidos (ver coverage.ts).
  const criteria = precisaCorretude(r) ? [...r.criteria, criterioCorretude(r.criteria)] : r.criteria;

  const candidato = {
    id: gerarId(),
    mode: r.mode,
    roleTitle: r.roleTitle,
    jobDescription: r.jobDescription,
    seniority: r.seniority,
    focus: r.focus,
    recruiterNotes: [acrescentarNaoAvaliado(r.recruiterNotes, naoAvaliado), notaDoTema(r)].filter(Boolean).join("\n"),
    // Linhas em branco da tela de revisão (uma instrução por linha) não entram.
    ...(conducao.length > 0 ? { conductNotes: conducao } : {}),
    tone: preferencias?.tom ?? "amigavel",
    hints: preferencias?.dicas ?? "leves",
    ...(r.regraDeIa ? { regraDeIa: r.regraDeIa } : {}),
    criteria,
    ...escolherProblema(r),
    languages: preferencias?.linguagens?.length ? preferencias.linguagens : LINGUAGENS,
    durationMin: duracaoDoRascunho(r, preferencias),
  };

  const resultado = InterviewConfig.safeParse(candidato);
  if (!resultado.success) {
    for (const i of resultado.error.issues) erros.push(`${i.path.join(".") || "(raiz)"}: ${i.message}`);
  }
  if (erros.length > 0 || !resultado.success) return { ok: false, erros };
  return { ok: true, config: resultado.data };
}
