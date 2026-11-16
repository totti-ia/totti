// O relatório como a tela mostra, igual para os dois formatos (System Design no quadro e Live Coding na IDE).
// Cada formato tem o seu dado de origem (`RelatorioVisto` do quadro, `Report` da IDE); os adaptadores desta pasta
// convergem os dois neste tipo, e `components/relatorio/Relatorio.tsx` só sabe desenhar ele.
// Só tipos e funções puras: serve ao servidor e ao navegador.

import type { BlocoDeIntegridade } from "@/lib/integridade/tipos";
export type { TipoDeSinal, SinalDeIntegridade, DestaqueDeIntegridade, BlocoDeIntegridade } from "@/lib/integridade/tipos";

export type FormatoDoRelatorio = "system_design" | "live_coding";

export const NOME_DO_FORMATO: Record<FormatoDoRelatorio, string> = {
  system_design: "System Design",
  live_coding: "Live Coding",
};

export type RecomendacaoComum = "avancar" | "avancar_com_ressalvas" | "talvez" | "nao_avancar" | "evidencia_insuficiente";

export const NOME_DA_RECOMENDACAO: Record<RecomendacaoComum, string> = {
  avancar: "Avançar",
  avancar_com_ressalvas: "Avançar com ressalvas",
  talvez: "Talvez",
  nao_avancar: "Não avançar",
  evidencia_insuficiente: "Evidência insuficiente",
};

/** Uma prova: o que foi dito, desenhado ou escrito e quando. */
export interface ProvaComum {
  /** Milissegundos desde o começo da entrevista; null quando não se sabe o minuto. */
  t: number | null;
  texto: string;
  tipo: "fala" | "desenho" | "codigo";
  /** Peças do desenho que a prova cita (só no quadro). */
  elementos: string[];
  /** Foto do quadro naquele momento (só no quadro). */
  imagem: string | null;
}

/** De onde veio uma regra aprendida: desta vaga ou de outra vaga da empresa. */
export type OrigemDaRegra = "vaga" | "empresa";

export interface RegraComum {
  texto: string;
  efeito: "valoriza" | "penaliza";
  origem?: OrigemDaRegra;
}

export interface CriterioComum {
  id: string;
  nome: string;
  /** 1 a 4; null = sem nota (não explorado, ou o Totti não provocou o ponto). */
  nota: number | null;
  /** O que a nota significa na rubrica (nível), quando o formato tem. */
  significado: string | null;
  /** Por que a nota. Vazio no Live Coding, onde as provas falam por si. */
  justificativa: string;
  provas: ProvaComum[];
  regras: RegraComum[];
}

/** Regra de reprovação da vaga ("cobrar duas vezes"): atendida, violada ou não observada. */
export interface EliminatorioComum {
  regra: string;
  status: "atendida" | "violada" | "nao_observada";
  justificativa: string;
  provas: ProvaComum[];
}

export const NOME_DO_STATUS_ELIMINATORIO: Record<EliminatorioComum["status"], string> = {
  atendida: "atendida",
  violada: "violada",
  nao_observada: "não observada",
};

/** A mudança no problema e como o candidato reagiu. Fora da nota geral. */
export interface AdaptacaoComum {
  titulo: string;
  /** Uma linha sobre a mudança (tipo e o que ela exigia). */
  descricao: string;
  /** Quando veio a mudança (ms desde o começo). */
  anunciadaEm: number | null;
  nota: number | null;
  significado: string | null;
  justificativa: string;
  /** Fatos medidos, uma frase cada. */
  detalhes: string[];
  provas: ProvaComum[];
}

/** Como o candidato destravou e usou a ajuda (Live Coding). Fora da nota geral. */
export interface AprendizadoComum {
  nota: number | null;
  resumo: string;
  momentos: { t: number; titulo: string; texto: string }[];
  provas: ProvaComum[];
}

export type TipoDeAcontecimento = "travou" | "dica" | "mudanca" | "adaptou" | "colagem" | "pergunta";

/** Um ponto da linha do tempo (travou, dica, mudança...). */
export interface AcontecimentoComum {
  t: number;
  /** Trechos vão até aqui; null = até o fim; ausente = ponto. */
  fim?: number | null;
  tipo: TipoDeAcontecimento;
  titulo: string;
  detalhe?: string;
}

export const SECOES_DO_RELATORIO = ["cabeçalho", "decisão", "pontos fortes/atenção", "notas por critério", "história da entrevista", "momentos"] as const;
// Adaptação é condicional nos dois formatos; torná-la obrigatória mudaria o relatório de live coding.
export const SECOES_CONDICIONAIS_DO_RELATORIO = ["adaptação"] as const;

export interface GravacaoDoQuadro {
  duracaoMs: number;
  falas: { t: number; role: "candidate" | "agent"; text: string }[];
  desenho: { t: number; pecas: number; conexoes: number; imagem: string | null }[];
  fases: { t: number; nome: string }[];
  acontecimentos: AcontecimentoComum[];
}

export interface RelatorioComum {
  /** null: sessão antiga sem dados de integridade. Fora da nota e da recomendação. */
  integridade: BlocoDeIntegridade | null;
  formato: FormatoDoRelatorio;
  id: string;
  /** Título grande: o problema (quadro) ou a vaga (IDE). */
  titulo: string;
  /** Linha pequena de cima do título. */
  contexto: string;
  candidato: string | null;
  /** Já formatado ("7 de novembro, 15:02"); null quando o dado não traz. */
  realizadaEm: string | null;
  /** Já formatado ("34 min"); null quando muito curta ou desconhecida. */
  duracao: string | null;
  duracaoMs: number | null;
  recomendacao: RecomendacaoComum;
  /** Média de 1 a 4; null quando nenhum critério tem prova. */
  notaGeral: number | null;
  /** Resumo da entrevista em um parágrafo. */
  resumo: string;
  /** O que levar para a próxima conversa (parágrafo). */
  briefing: string;
  resumoDaSolucao: string;
  enunciado: string;
  desenhoFinal: string | null;
  pontosFortes: string[];
  pontosDeAtencao: string[];
  /** "Se avançar, explore na próxima etapa". */
  proximosPassos: string[];
  criterios: CriterioComum[];
  eliminatorios: EliminatorioComum[];
  adaptacao: AdaptacaoComum | null;
  aprendizado: AprendizadoComum | null;
  acontecimentos: AcontecimentoComum[];
  gravacaoQuadro?: GravacaoDoQuadro | null;
  serie?: { eixo: string; pontos: { t: number; valor: number }[] };
  faixas?: { nome: string; marcas: number[] }[];
  fases?: { t: number; nome: string }[];
  /** Os números que importam, cada um com o nome em cima. */
  fatos: { nome: string; valor: string }[];
  /** Total independente de perguntas, obtido do estado da sessão para conferir a gravação. */
  perguntasEsperadas?: number;
  /** Quantas provas o servidor conferiu na gravação; null quando o formato não conta. */
  provasConferidas: number | null;
  ajustes: string[];
  demonstracao: boolean;
}
