// Pedido de rascunho (resposta antecipada): enquanto a pessoa ainda fala, a tela pede ao servidor a resposta ao texto
// acumulado até aqui, sem usá-la. Só um pedido vale por vez: texto novo aborta o anterior. O rascunho nunca mostra erro:
// falha, cancelamento ou atraso só deixam o turno seguir do jeito de sempre (o envio final pega o caminho normal).
// Cliente, sem React: cada tela liga `pedir` aos trechos confirmados e `cancelar` quando a conversa para.

export type PedidoDeRascunho = {
  /** Pede o rascunho para este texto. Vazio ou igual ao último pedido não faz nada. */
  pedir(texto: string): void;
  /** Aborta o pedido em curso e esquece o último texto (assim o mesmo texto pode ser pedido de novo). */
  cancelar(): void;
};

export function criarPedidoDeRascunho(enviar: (texto: string, sinal: AbortSignal) => Promise<unknown>): PedidoDeRascunho {
  let ultimo: string | null = null;
  let controle: AbortController | null = null;

  return {
    pedir(texto) {
      if (!texto.trim() || texto === ultimo) return;
      controle?.abort();
      const novo = new AbortController();
      controle = novo;
      ultimo = texto;
      try {
        // O rascunho é opcional: qualquer erro (inclusive o AbortError de um pedido substituído) fica aqui.
        void Promise.resolve(enviar(texto, novo.signal)).catch(() => {});
      } catch {
        // Mesmo motivo: enviar que falha de imediato não vira erro para a tela.
      }
    },
    cancelar() {
      controle?.abort();
      controle = null;
      ultimo = null;
    },
  };
}
