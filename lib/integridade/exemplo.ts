import type { BlocoDeIntegridade } from "./tipos";

// Evidências fictícias para revisar o visual (#123), no formato que lib/integridade/montar.ts produz.

/** Live Coding de exemplo (também a demo pública): uma entrevista honesta, com uma saída curta e nenhum destaque. */
export const INTEGRIDADE_EXEMPLO: BlocoDeIntegridade = {
  sinais: [{ id: "saida_de_foco-1", tipo: "saida_de_foco", t: 580_000, fim: 592_000, texto: "Saiu da aba da entrevista por 12 s" }],
  destaques: [],
};

/** Quadro de exemplo: sem nenhum sinal. */
export const INTEGRIDADE_QUADRO_EXEMPLO: BlocoDeIntegridade = { sinais: [], destaques: [] };

/** Quadro de exemplo que não avança: dois sinais independentes que se encontram no tempo. */
export const INTEGRIDADE_QUADRO_CONVERGENCIA: BlocoDeIntegridade = {
  sinais: [
    { id: "saida_de_foco-1", tipo: "saida_de_foco", t: 245_000, fim: 268_000, texto: "Saiu da janela da entrevista por 23 s" },
    { id: "saida_de_foco-2", tipo: "saida_de_foco", t: 400_000, fim: 465_000, texto: "Saiu da aba da entrevista por 1 min 5 s" },
    { id: "colagem_de_fora-3", tipo: "colagem_de_fora", t: 470_000, texto: "Entraram 9 peças no quadro de uma só vez" },
  ],
  destaques: [
    {
      t: 400_000,
      sinais: ["saida_de_foco-2", "colagem_de_fora-3"],
      texto: "Saiu da aba da entrevista por 1 min 5 s e, 5 s depois de voltar, entraram 9 peças no quadro de uma só vez",
    },
  ],
};
