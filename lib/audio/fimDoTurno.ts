// Fim do turno do candidato (regra única, só pela energia do microfone).
// Silêncio contínuo de 3,5 s fecha o turno; fala baixa ou ruído fecha em 8 s; voz alta nunca fecha.
// As faixas são relativas ao piso de ruído: um seguidor de mínimo que desce na hora (pausas da fala)
// e sobe devagar (ruído constante), limitado a PISO_MAXIMO e aos mínimos absolutos.
import { LIMIAR_SUSTENTAR_RMS, LIMIAR_VOZ_RMS } from "../presenca/transcricao";

export const SILENCIO_FECHA_MS = 3500; // silêncio contínuo que fecha o turno
export const BAIXA_FECHA_MS = 8000; // tempo sem voz alta (fala baixa, ruído ou silêncio) que fecha o turno
export const FATOR_SILENCIO = 2; // múltiplo do piso abaixo do qual um bloco é silêncio
export const FATOR_VOZ_ALTA = 4; // múltiplo do piso a partir do qual um bloco é voz alta
export const PISO_MINIMO_DE_DADOS_MS = 500; // medição acumulada necessária antes de existir piso
export const SUBIDA_DO_PISO_MS = 10_000; // constante de tempo com que o piso sobe em direção ao ruído
export const PISO_MAXIMO = 0.05; // acima disso não é ruído de fundo, é voz; o piso nunca passa daqui
export const JANELA_DO_TRECHO_ATRASADO_MS = 2000; // o Scribe confirma o trecho ~0,9 s depois da fala; mais que isso é fala nova

export type FaixaDeEnergia = "silencio" | "baixa" | "alta";

export type FimDoTurno = {
  medir(energia: number, duracaoMs: number): { faixa: FaixaDeEnergia; fechou: boolean };
  reiniciar(): void; // zera contagens e "houve voz alta"; mantém o piso (o ambiente não mudou)
  piso(): number; // piso de ruído atual (0 enquanto há menos de PISO_MINIMO_DE_DADOS_MS medidos)
  marcarFala(): void; // texto transcrito prova que houve fala, mesmo baixa
};

export function faixaDaEnergia(energia: number, piso: number): FaixaDeEnergia {
  const limiteSilencio = Math.max(LIMIAR_SUSTENTAR_RMS, piso * FATOR_SILENCIO);
  let limiteAlta = Math.max(LIMIAR_VOZ_RMS, piso * FATOR_VOZ_ALTA);
  if (limiteAlta <= limiteSilencio) limiteAlta = limiteSilencio * 2;
  if (energia < limiteSilencio) return "silencio";
  if (energia >= limiteAlta) return "alta";
  return "baixa";
}

export function criarFimDoTurno(): FimDoTurno {
  let pisoInterno: number | null = null;
  let medidoMs = 0;
  let silencioMs = 0;
  let semVozAltaMs = 0;
  let houveVozAlta = false;
  let desarmado = false; // já devolveu true desde a última voz alta

  function pisoAtual(): number {
    if (medidoMs < PISO_MINIMO_DE_DADOS_MS || pisoInterno === null) return 0;
    return pisoInterno;
  }

  function atualizarPiso(energia: number, duracaoMs: number) {
    if (pisoInterno === null || energia < pisoInterno) pisoInterno = energia;
    else pisoInterno += (energia - pisoInterno) * Math.min(1, duracaoMs / SUBIDA_DO_PISO_MS);
    pisoInterno = Math.min(pisoInterno, PISO_MAXIMO);
  }

  return {
    medir(energia, duracaoMs) {
      if (!(duracaoMs > 0) || !Number.isFinite(energia)) return { faixa: "silencio", fechou: false };

      // Classifica com o piso de antes; só depois o bloco atualiza o piso.
      const faixa = faixaDaEnergia(energia, pisoAtual());
      medidoMs += duracaoMs;
      atualizarPiso(energia, duracaoMs);

      if (faixa === "alta") {
        houveVozAlta = true;
        desarmado = false;
        silencioMs = 0;
        semVozAltaMs = 0;
      } else {
        semVozAltaMs += duracaoMs;
        silencioMs = faixa === "silencio" ? silencioMs + duracaoMs : 0;
      }

      const deveFechar =
        houveVozAlta && !desarmado && (silencioMs >= SILENCIO_FECHA_MS || semVozAltaMs >= BAIXA_FECHA_MS);
      if (deveFechar) {
        desarmado = true;
        return { faixa, fechou: true };
      }
      return { faixa, fechou: false };
    },

    reiniciar() {
      silencioMs = 0;
      semVozAltaMs = 0;
      houveVozAlta = false;
      desarmado = false;
    },

    piso() {
      return pisoAtual();
    },

    marcarFala() {
      // Já fechado: o texto é fala nova, então a contagem recomeça. Armado: não zera, o texto chega ~0,9 s depois da fala.
      if (desarmado) {
        silencioMs = 0;
        semVozAltaMs = 0;
      }
      houveVozAlta = true;
      desarmado = false;
    },
  };
}
