export type TipoDeSinal =
  | "colagem_de_fora"
  | "saida_de_foco"
  | "escrita_linear"
  | "bloco_apos_saida"
  | "canario"
  | "injecao"
  | "eco_da_pergunta"
  | "tempo_plano"
  | "bloco_sem_fala";

export interface SinalDeIntegridade {
  id: string;
  tipo: TipoDeSinal;
  t: number;
  fim?: number;
  texto: string;
  detalhe?: string;
}

export interface DestaqueDeIntegridade {
  texto: string;
  t: number;
  sinais: string[];
}

export interface BlocoDeIntegridade {
  temposDeResposta?: import("./conversa").DistribuicaoDeResposta[];
  destaques: DestaqueDeIntegridade[];
  sinais: SinalDeIntegridade[];
}
