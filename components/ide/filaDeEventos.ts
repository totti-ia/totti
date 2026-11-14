/**
 * Fila de reenvio dos eventos que não podem se perder (run, colagem, código, fim da sessão). Cada evento tenta até o
 * servidor confirmar, com espera crescente entre as tentativas; um erro definitivo (o servidor recusou o evento) não
 * se repete. Os envios correm em paralelo, como antes: um run que espera a análise (6 a 15 s) não segura o código
 * que vem depois. A ordem na linha do tempo é o servidor que garante, pelo `t` (lib/session/store.ts).
 */

/** Espera antes de cada nova tentativa; depois da última, repete a última. */
const ESPERAS_MS = [1000, 2000, 4000, 8000, 15_000];

type Opcoes<E, R> = {
  enviar: (evento: E) => Promise<R>;
  aoConfirmar?: (evento: E, resposta: R, tentativas: number) => void;
  aoFalhar?: (evento: E, erro: unknown, definitivo: boolean) => void;
  /** O erro não adianta repetir (o servidor recusou o evento). */
  definitivo?: (erro: unknown) => boolean;
  esperasMs?: number[];
  dormir?: (ms: number) => Promise<void>;
};

const dormirDeVerdade = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export class FilaDeEventos<E = unknown, R = unknown> {
  private emVoo = new Set<Promise<void>>();
  private parada = false;
  private readonly o: Opcoes<E, R>;

  constructor(opcoes: Opcoes<E, R>) {
    this.o = opcoes;
  }

  /** Eventos ainda sem confirmação. */
  get pendentes(): number {
    return this.emVoo.size;
  }

  /** Manda o evento e resolve quando o servidor confirmar (ou desistir de vez, ou a fila parar). */
  enfileirar(evento: E): Promise<void> {
    const envio = this.tentar(evento).finally(() => this.emVoo.delete(envio));
    this.emVoo.add(envio);
    return envio;
  }

  /** Resolve quando não houver mais nada esperando confirmação (inclusive o que entrar enquanto espera). */
  async vazia(): Promise<void> {
    while (this.emVoo.size > 0) await Promise.allSettled([...this.emVoo]);
  }

  /** Para os reenvios (a tela saiu). O que estava esperando resolve sem confirmação. */
  parar(): void {
    this.parada = true;
  }

  /**
   * Volta a enviar depois de `parar`. O React em desenvolvimento (StrictMode) desmonta e monta o componente de novo
   * logo na entrada: sem isto, a limpeza da primeira montagem deixava a fila parada para sempre e nada era enviado.
   */
  retomar(): void {
    this.parada = false;
  }

  private async tentar(evento: E): Promise<void> {
    const esperas = this.o.esperasMs ?? ESPERAS_MS;
    const dormir = this.o.dormir ?? dormirDeVerdade;
    for (let tentativa = 1; !this.parada; tentativa++) {
      try {
        const resposta = await this.o.enviar(evento);
        this.o.aoConfirmar?.(evento, resposta, tentativa);
        return;
      } catch (erro) {
        const definitivo = this.o.definitivo?.(erro) === true;
        this.o.aoFalhar?.(evento, erro, definitivo);
        if (definitivo) return;
        await dormir(esperas[Math.min(tentativa - 1, esperas.length - 1)]);
      }
    }
  }
}

/** Espera a fila esvaziar até `tetoMs`. true: esvaziou; false: o teto chegou antes. */
export async function esperarFila(fila: Pick<FilaDeEventos, "vazia">, tetoMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const teto = new Promise<false>((resolver) => {
    timer = setTimeout(() => resolver(false), tetoMs);
  });
  try {
    return await Promise.race([fila.vazia().then(() => true as const), teto]);
  } finally {
    clearTimeout(timer);
  }
}
