// Saídas de foco (#123): quando o candidato sai da aba ou da janela da entrevista, e por quanto tempo. Vale nas duas
// salas. Só registra: as saídas ficam em memória e vão em lote no envio que já existe (snapshot na IDE, lote de
// eventos no quadro), nunca um POST por saída. Ouvintes O(1), sem polling.
//
// Não conta o que é da própria entrevista: o pedido de permissão do microfone (`ignorarFocoDurante`) e o tempo antes
// de a sessão começar (o dono só liga o registro com a sessão de pé).

export type MotivoDaSaida = "aba" | "janela";

export interface SaidaDeFoco {
  /** Quando saiu, em ms de `Date.now()` (cada sala converte para a régua dela). */
  inicioEm: number;
  duracaoMs: number;
  motivo: MotivoDaSaida;
}

/** Teto de saídas guardadas entre dois envios (o contrato aceita até 200 por lote). */
const MAX_SAIDAS = 200;

let ignorando = 0;

/**
 * Roda `fn` sem contar saída de foco: o diálogo de permissão do microfone tira o foco da janela em alguns navegadores.
 */
export async function ignorarFocoDurante<T>(fn: () => Promise<T>): Promise<T> {
  ignorando += 1;
  try {
    return await fn();
  } finally {
    // O foco volta um instante depois do diálogo fechar.
    setTimeout(() => {
      ignorando = Math.max(0, ignorando - 1);
    }, 500);
  }
}

/** Núcleo sem DOM (testável): recebe as transições e devolve as saídas fechadas. */
export class RegistroDeFoco {
  private saidas: SaidaDeFoco[] = [];
  private fora: { inicioEm: number; motivo: MotivoDaSaida; ignorada: boolean } | null = null;

  saiu(motivo: MotivoDaSaida, agora: number): void {
    if (this.fora) {
      // Trocar de aba também tira o foco da janela: é uma saída só, e "aba" diz mais.
      if (motivo === "aba") this.fora.motivo = "aba";
      return;
    }
    this.fora = { inicioEm: agora, motivo, ignorada: ignorando > 0 };
  }

  voltou(agora: number): void {
    const f = this.fora;
    this.fora = null;
    if (!f || f.ignorada || ignorando > 0) return;
    const duracaoMs = Math.max(0, Math.round(agora - f.inicioEm));
    if (duracaoMs === 0 || this.saidas.length >= MAX_SAIDAS) return;
    this.saidas.push({ inicioEm: f.inicioEm, duracaoMs, motivo: f.motivo });
  }

  /** As saídas fechadas desde o último envio, e zera. A que está aberta agora vai no envio seguinte. */
  esvaziar(): SaidaDeFoco[] {
    const s = this.saidas;
    this.saidas = [];
    return s;
  }

  /** Um envio falhou: as saídas voltam para o próximo. */
  devolver(saidas: readonly SaidaDeFoco[]): void {
    this.saidas = [...saidas, ...this.saidas].slice(0, MAX_SAIDAS);
  }

  /** Fecha a saída aberta (fim da sessão) e devolve tudo o que sobrou. */
  encerrar(agora: number): SaidaDeFoco[] {
    if (this.fora) this.voltou(agora);
    return this.esvaziar();
  }
}

/** Liga os ouvintes da janela num registro. Devolve a função que desliga. */
export function ouvirFoco(registro: RegistroDeFoco): () => void {
  const aoMudarVisibilidade = () => {
    if (document.visibilityState === "hidden") registro.saiu("aba", Date.now());
    else if (document.hasFocus()) registro.voltou(Date.now());
  };
  const aoSair = () => registro.saiu("janela", Date.now());
  const aoVoltar = () => {
    if (document.visibilityState === "visible") registro.voltou(Date.now());
  };
  document.addEventListener("visibilitychange", aoMudarVisibilidade);
  window.addEventListener("blur", aoSair);
  window.addEventListener("focus", aoVoltar);
  return () => {
    document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    window.removeEventListener("blur", aoSair);
    window.removeEventListener("focus", aoVoltar);
  };
}
