import type { BlocoDeIntegridade } from "./tipos";
import { nomeDoCanario } from "./canario";

/** Evidências fictícias para revisar o visual nas duas salas. */
export const INTEGRIDADE_EXEMPLO: BlocoDeIntegridade = {
  sinais: [
    { id: "foco-exemplo", tipo: "saida_de_foco", t: 720_000, fim: 760_000, texto: "saiu da janela por 40 s no minuto 12" },
    { id: "colagem-exemplo", tipo: "colagem_de_fora", t: 765_000, texto: "colou 14 linhas de fora no minuto 12" },
  ],
  destaques: [{ t: 720_000, sinais: ["foco-exemplo", "colagem-exemplo"], texto: "saiu da janela por 40 s no minuto 12 e, ao voltar, colou 14 linhas de fora no minuto 12" }],
};

export const INTEGRIDADE_QUADRO_EXEMPLO: BlocoDeIntegridade = {
  sinais: [{ id: "canario-exemplo", tipo: "canario", t: 720_000, texto: "o identificador do enunciado copiado apareceu numa caixa do quadro no minuto 12", detalhe: nomeDoCanario("exemplo") }],
  destaques: [{ t: 720_000, sinais: ["canario-exemplo"], texto: "o identificador do enunciado copiado apareceu numa caixa do quadro no minuto 12" }],
};
