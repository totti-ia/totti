// Adaptador do relatório do quadro (`RelatorioVisto`, System Design) para o tipo comum.
import type { AdaptacaoVista, CriterioVisto, ProvaVista, RelatorioVisto } from "@/lib/agente/relatorio";
import { semTermosInternos } from "@/lib/totti/relatorio";
import { momentoParaMs, plural } from "./formato";
import type {
  AcontecimentoComum,
  AdaptacaoComum,
  CriterioComum,
  EliminatorioComum,
  OrigemDaRegra,
  ProvaComum,
  RegraComum,
  RelatorioComum,
} from "./tipos";

// #144: estimativa; o Lucas decidiu mostrar com 'aprox.'.
export const MOSTRAR_TEMPO_DESENHANDO_FALANDO = true;

export function estimativaTempoDesenhandoFalando(r: RelatorioVisto): { nome: string; valor: string } | null {
  const desenhos = r.gravacao?.desenho ?? [];
  const tempoDesenhando = desenhos.slice(1).reduce((soma, d, i) => soma + Math.min(30_000, Math.max(0, d.t - desenhos[i].t)), 0);
  const tempoFalando = (r.gravacao?.falas ?? []).filter(f => f.role === "candidate").reduce((soma, f) => soma + f.text.split(/\s+/).filter(Boolean).length * 350, 0);
  return tempoDesenhando > 0 && tempoFalando > 0
    ? { nome: "tempo desenhando × falando", valor: `aprox. ${Math.round(tempoDesenhando / 60_000)} min × ${Math.round(tempoFalando / 60_000)} min` }
    : null;
}

/**
 * Campos que a frente do scorecard está acrescentando a `RelatorioVisto` (regra de reprovação da vaga e a origem
 * das regras aprendidas). Opcionais: o adaptador lê com tolerância e funciona antes e depois da mudança.
 */
type EliminatorioVisto = {
  regra: string;
  status: EliminatorioComum["status"];
  justificativa: string;
  provas: ProvaVista[];
};
type RegraVista = { texto: string; efeito: "valoriza" | "penaliza"; origem?: OrigemDaRegra };
type ComCamposNovos = { eliminatorios?: EliminatorioVisto[] };

const limpo = semTermosInternos;

export function provaDoQuadro(p: ProvaVista): ProvaComum {
  if (p.tipo === "fala") {
    return { t: momentoParaMs(p.momento), texto: limpo(p.texto), tipo: "fala", elementos: [], imagem: null };
  }
  const texto = p.observacao?.trim() || (p.elementos.length > 0 ? `No desenho: ${p.elementos.join(", ")}` : "No desenho");
  return { t: momentoParaMs(p.momento), texto: limpo(texto), tipo: "desenho", elementos: p.elementos, imagem: p.imagem };
}

function regraDoQuadro(r: NonNullable<CriterioVisto["aprendidoComOTime"]>[number]): RegraComum {
  const origem = (r as RegraVista).origem;
  return { texto: r.texto, efeito: r.efeito, ...(origem === "vaga" || origem === "empresa" ? { origem } : {}) };
}

function criterioDoQuadro(c: CriterioVisto): CriterioComum {
  return {
    id: c.id,
    nome: limpo(c.nome),
    nota: c.nota,
    significado: c.significado ? limpo(c.significado) : null,
    justificativa: limpo(c.justificativa),
    provas: c.provas.map(provaDoQuadro),
    regras: (c.aprendidoComOTime ?? []).map(regraDoQuadro),
  };
}

function adaptacaoDoQuadro(a: AdaptacaoVista): AdaptacaoComum {
  return {
    titulo: "Como se adaptou",
    descricao: a.mudanca,
    anunciadaEm: momentoParaMs(a.momento),
    nota: a.nota,
    significado: a.significado ? limpo(a.significado) : null,
    justificativa: limpo(a.justificativa),
    detalhes: [
      `Depois da mudança: ${plural(a.falasDepois, "fala", "falas")} e ${plural(a.desenhosDepois, "versão nova do desenho", "versões novas do desenho")}.`,
    ],
    provas: a.provas.map(provaDoQuadro),
  };
}

/** Os eliminatórios do relatório, quando existirem (campo opcional que outra frente acrescenta). */
function eliminatoriosDoQuadro(r: RelatorioVisto): EliminatorioComum[] {
  const lista = (r as RelatorioVisto & ComCamposNovos).eliminatorios;
  if (!Array.isArray(lista)) return [];
  return lista.map((e) => ({
    regra: limpo(e.regra),
    status: e.status,
    justificativa: limpo(e.justificativa),
    provas: (e.provas ?? []).map(provaDoQuadro),
  }));
}

export function relatorioDoQuadro(r: RelatorioVisto): RelatorioComum {
  const adaptacao = r.adaptacao ? adaptacaoDoQuadro(r.adaptacao) : null;
  const acontecimentos: AcontecimentoComum[] = [
    ...(r.gravacao?.acontecimentos ?? []),
    ...(adaptacao && adaptacao.anunciadaEm !== null
      ? [{ t: adaptacao.anunciadaEm, tipo: "mudanca" as const, titulo: `Mudança: ${adaptacao.descricao}` }]
      : []),
  ];
  const comNota = r.criterios.filter((c) => c.nota !== null).length;
  const estimativaTempo = estimativaTempoDesenhandoFalando(r);
  const fechamento = r.gravacao?.fases.find(f => f.nome === "Fechamento")?.t;
  const naFaseDeDesenho = (t: number) => r.gravacao?.fases.filter(f => f.t <= t).at(-1)?.nome === "Alto nível" || r.gravacao?.fases.filter(f => f.t <= t).at(-1)?.nome === "Aprofundamento";
  const fatos: RelatorioComum["fatos"] = [
    { nome: "Critérios com prova", valor: `${comNota} de ${r.criterios.length}` },
    { nome: "Perguntas do Totti", valor: String(r.perguntas) },
    ...(r.gravacao ? [
      { nome: "Perguntas durante o desenho", valor: String(r.gravacao.acontecimentos.filter(a => a.tipo === "pergunta" && naFaseDeDesenho(a.t) && (fechamento === undefined || a.t < fechamento)).length) },
      { nome: "Perguntas no fechamento", valor: String(r.gravacao.acontecimentos.filter(a => a.tipo === "pergunta" && fechamento !== undefined && a.t >= fechamento).length) },
      ...(MOSTRAR_TEMPO_DESENHANDO_FALANDO && estimativaTempo ? [estimativaTempo] : []),
    ] : []),
    ...(r.duracao ? [{ nome: "Duração", valor: r.duracao }] : []),
    { nome: "Provas conferidas", valor: String(r.provasConferidas) },
  ];
  return {
    formato: "system_design",
    id: r.sessaoId,
    titulo: r.problema,
    contexto: `relatório da entrevista de ${r.area}`,
    candidato: r.candidatoId || null,
    realizadaEm: r.realizadaEm,
    duracao: r.duracao,
    duracaoMs: r.gravacao?.duracaoMs ?? null,
    recomendacao: r.recomendacao,
    notaGeral: r.notaGeral,
    resumo: limpo(r.resumoDaEntrevista),
    briefing: limpo(r.briefing),
    resumoDaSolucao: limpo(r.resumoDaSolucao),
    enunciado: r.enunciado,
    desenhoFinal: r.desenhoFinal,
    pontosFortes: r.pontosFortes.map(limpo),
    pontosDeAtencao: r.pontosAAprofundar.map(limpo),
    proximosPassos: [],
    criterios: r.criterios.map(criterioDoQuadro),
    eliminatorios: eliminatoriosDoQuadro(r),
    adaptacao,
    aprendizado: null,
    acontecimentos,
    gravacaoQuadro: r.gravacao ?? null,
    serie: r.gravacao && r.gravacao.desenho.length ? { eixo: "crescimento do desenho", pontos: r.gravacao.desenho.map(d => ({ t: d.t, valor: (d.pecas + d.conexoes) / Math.max(1, ...r.gravacao!.desenho.map(x => x.pecas + x.conexoes)) })) } : { eixo: "crescimento do desenho", pontos: [] },
    faixas: r.gravacao ? [
      { nome: "Candidato", marcas: r.gravacao.falas.filter(f => f.role === "candidate").map(f => f.t) },
      { nome: "Totti", marcas: r.gravacao.falas.filter(f => f.role === "agent").map(f => f.t) },
      { nome: "Desenho", marcas: r.gravacao.desenho.map(d => d.t) },
    ] : [],
    fases: r.gravacao?.fases ?? [],
    fatos,
    perguntasEsperadas: r.perguntas,
    provasConferidas: r.provasConferidas,
    ajustes: r.ajustes,
    demonstracao: r.demonstracao,
  };
}
