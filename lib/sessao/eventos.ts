export type TipoEvento = "desenho" | "fala" | "analise" | "analise_falhou" | "pergunta" | "resposta" | "fase" | "foco" | "colagem";
export type EventoLinhaDoTempo = { horario: string; tipo: TipoEvento; dados: unknown };

export function criarLinhaDoTempo(opcoes: {
  enviar: (lote: EventoLinhaDoTempo[]) => Promise<void>;
  intervaloMs?: number;
  maxLote?: number;
  agora?: () => Date;
}): {
  registrar(tipo: TipoEvento, dados: unknown): void;
  descarregar(): Promise<void>;
  parar(): void;
} {
  const intervaloMs = opcoes.intervaloMs ?? 5000;
  const maxLote = opcoes.maxLote ?? 50;
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0) throw new RangeError("O intervalo deve ser finito e maior que zero.");
  if (!Number.isSafeInteger(maxLote) || maxLote <= 0) throw new RangeError("O tamanho do lote deve ser um inteiro positivo.");
  const agora = opcoes.agora ?? (() => new Date());
  let fila: EventoLinhaDoTempo[] = [];
  let emAndamento: Promise<void> | null = null;
  let parado = false;
  let enviarTudo = false;
  let envioManual = false;
  let aguardarCiclo = false;

  function processar(tudo: boolean, manual: boolean): Promise<void> {
    enviarTudo ||= tudo;
    envioManual ||= manual;
    if (emAndamento) return emAndamento;
    // A promessa também protege contra chamadas reentrantes de enviar().
    emAndamento = Promise.resolve().then(async () => {
      try {
        while (fila.length > 0 && (enviarTudo || fila.length >= maxLote) && (!parado || envioManual)) {
          const lote = fila.splice(0, maxLote);
          try {
            await opcoes.enviar([...lote]);
          } catch (erro) {
            fila = lote.concat(fila);
            aguardarCiclo = true;
            throw erro;
          }
        }
      } finally {
        emAndamento = null;
        enviarTudo = false;
        envioManual = false;
      }
    });
    return emAndamento;
  }

  const temporizador = setInterval(() => {
    if (parado) return;
    aguardarCiclo = false;
    void processar(true, false).catch(() => {});
  }, intervaloMs);

  return {
    registrar(tipo, dados) {
      if (parado) return;
      fila.push({ horario: agora().toISOString(), tipo, dados });
      if (fila.length >= maxLote && !aguardarCiclo && !emAndamento) {
        void processar(false, false).catch(() => {});
      }
    },
    /** Falhas rejeitam a promessa e preservam o lote para nova tentativa. */
    descarregar() {
      aguardarCiclo = false;
      return processar(true, true);
    },
    /** Cancela envios automáticos; descarregar continua disponível para finalizar. */
    parar() {
      parado = true;
      clearInterval(temporizador);
    },
  };
}
