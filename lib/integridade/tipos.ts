export type TipoDeSinal =
  | "colagem_de_fora"
  | "saida_de_foco"
  | "escrita_linear"
  | "bloco_apos_saida"
  | "canario"
  | "injecao";

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
  destaques: DestaqueDeIntegridade[];
  sinais: SinalDeIntegridade[];
}
