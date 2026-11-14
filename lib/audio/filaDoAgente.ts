import { ESPERA_DA_REACAO_MS, slugDaReacao } from "../voz/reacao";

/**
 * Fila única das falas do Totti. Uma fala nova que chega enquanto OUTRA está tocando (áudio audível) não corta a
 * atual: espera, ou é descartada se já não faz sentido. Módulo puro (sem áudio, sem React): o hook decide quando
 * perguntar e o que fazer com o resultado.
 *
 * Cada fala entra com uma ORIGEM, e a origem define o predicado "ainda vale?" avaliado imediatamente antes de tocar.
 * Só estado e eventos decidem (quem falou ou desenhou depois, fase, pergunta ativa, idade): nada de heurística de texto.
 *
 *  - "sempre"     abertura, desafio e despedida: tocam sempre, sem limite de idade.
 *  - "resposta"   resposta direta ao candidato (/perguntar): espera a fala atual; vale se a fase é a mesma.
 *                 (Uma fala mais nova do candidato retira a resposta pelo `remover`, ver lib/audio/filaFalas.ts.)
 *  - "mudanca"    mudança no problema (empecilho): já virou requisito no quadro e não se repete, então espera como a
 *                 resposta (fase e idade), em vez de ser descartada.
 *  - "pergunta"   pergunta do Analista (plin): espera; vale se ainda é a pergunta ativa (não foi cancelada, não
 *                 expirou, não virou outra) e a fase é a mesma.
 *  - "iniciativa" o Totti falando por conta própria ("pode repetir?"): a premissa é "o candidato está quieto e a vez
 *                 é do Totti". Se o Totti já está falando, é descartada na hora; se esperou, só toca se o candidato
 *                 não falou nem desenhou depois de ela entrar.
 * Todas, menos "sempre", expiram com `IDADE_MAXIMA_NA_FILA_MS`.
 */

export type OrigemDaFala = "sempre" | "resposta" | "mudanca" | "pergunta" | "iniciativa";

export type MotivoDoDescarte =
  | "agente_ocupado" // iniciativa que chegou com o Totti falando
  | "expirou" // passou do limite de espera
  | "fase_mudou"
  | "candidato_agiu" // o candidato falou ou desenhou depois de ela entrar na fila
  | "pergunta_obsoleta" // a pergunta do Analista foi cancelada, expirou ou virou outra
  | "substituida" // uma fala nova do candidato retirou a resposta
  | "silenciado"; // barge-in, silenciar, desligar a voz, encerrar

/** Limite de espera na fila: depois disso a fala já está velha demais para ser dita. */
export const IDADE_MAXIMA_NA_FILA_MS = 12_000;

export interface PedidoDeFala<T> {
  origem: OrigemDaFala;
  carga: T;
  /** Fase da entrevista quando a fala foi pedida. */
  fase: string;
  /** Número da pergunta ativa do Analista quando foi pedida (só para a origem "pergunta"). */
  numeroPergunta?: number | null;
}

export interface ItemDaFila<T> extends PedidoDeFala<T> {
  id: number;
  entrouEm: number;
}

/** O que vale na hora de tocar. */
export interface ContextoDeTocar {
  agora: number;
  fase: string;
  /** Última vez que o candidato falou ou mexeu no desenho. */
  ultimaAtividadeDoCandidatoEm: number;
  /** Número da pergunta ativa do Analista agora (null se não há). */
  numeroPerguntaAtiva: number | null;
}

/** O predicado "ainda vale?" de um item: null se vale, senão o motivo do descarte. */
export function motivoDeDescarte<T>(item: ItemDaFila<T>, ctx: ContextoDeTocar, idadeMaxima = IDADE_MAXIMA_NA_FILA_MS): MotivoDoDescarte | null {
  if (item.origem === "sempre") return null;
  if (ctx.agora - item.entrouEm > idadeMaxima) return "expirou";
  if (ctx.fase !== item.fase) return "fase_mudou";
  if (item.origem === "pergunta" && (item.numeroPergunta == null || ctx.numeroPerguntaAtiva !== item.numeroPergunta)) return "pergunta_obsoleta";
  if (item.origem === "iniciativa" && ctx.ultimaAtividadeDoCandidatoEm > item.entrouEm) return "candidato_agiu";
  return null;
}

export type Admissao<T> =
  | { resultado: "tocar" }
  | { resultado: "esperar"; item: ItemDaFila<T> }
  | { resultado: "descartar"; motivo: MotivoDoDescarte };

export interface Descartado<T> { item: ItemDaFila<T>; motivo: MotivoDoDescarte }

export class FilaDoAgente<T> {
  private itens: ItemDaFila<T>[] = [];
  private contador = 0;

  constructor(private readonly idadeMaxima = IDADE_MAXIMA_NA_FILA_MS) {}

  get tamanho(): number {
    return this.itens.length;
  }

  /**
   * Uma fala nova chegou. Sem fala tocando (`agenteTocando` false) ela toca já: a fila só existe atrás de uma fala
   * audível. Tocando: "iniciativa" é descartada; as demais esperam, em ordem.
   */
  admitir(pedido: PedidoDeFala<T>, agenteTocando: boolean, agora: number): Admissao<T> {
    if (!agenteTocando) return { resultado: "tocar" };
    if (pedido.origem === "iniciativa") return { resultado: "descartar", motivo: "agente_ocupado" };
    const item: ItemDaFila<T> = { ...pedido, id: ++this.contador, entrouEm: agora };
    this.itens.push(item);
    return { resultado: "esperar", item };
  }

  /** A fala atual terminou: devolve a próxima que ainda vale (e as que ficaram para trás, descartadas). */
  proximo(ctx: ContextoDeTocar): { item: ItemDaFila<T> | null; descartados: Descartado<T>[] } {
    const descartados: Descartado<T>[] = [];
    while (this.itens.length) {
      const item = this.itens.shift()!;
      const motivo = motivoDeDescarte(item, ctx, this.idadeMaxima);
      if (!motivo) return { item, descartados };
      descartados.push({ item, motivo });
    }
    return { item: null, descartados };
  }

  /** Tira da fila os itens que passam no filtro (ex.: respostas substituídas por uma fala nova do candidato). */
  remover(filtro: (item: ItemDaFila<T>) => boolean, motivo: MotivoDoDescarte): Descartado<T>[] {
    const saem = this.itens.filter(filtro);
    this.itens = this.itens.filter((i) => !filtro(i));
    return saem.map((item) => ({ item, motivo }));
  }

  /** Barge-in, silenciar, voz desligada, encerrar: nada do que esperava toca. */
  limpar(motivo: MotivoDoDescarte = "silenciado"): Descartado<T>[] {
    return this.remover(() => true, motivo);
  }
}

/**
 * Reação pura ("Hm.", "Uhum.") retida: não entra na fila nem toca sozinha. Espera ESPERA_DA_REACAO_MS pela fala seguinte
 * (`consumir` tira a reação para sair junto dela, ver juntarReacao). Se o prazo passa, `vencer` recebe a reação para
 * tocá-la como gravação (lib/voz/reacao.ts). Só uma fica retida por vez: a fila de quem usa garante a ordem.
 */
export class ReacaoRetida<T> {
  private retida: { texto: string; carga: T; prazo: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly vencer: (texto: string, carga: T) => void,
    private readonly esperaMs = ESPERA_DA_REACAO_MS,
  ) {}

  /** Retém a fala se ela é reação pura e nenhuma outra está retida. false: quem chama segue como antes. */
  reter(texto: string, carga: T): boolean {
    if (this.retida || !slugDaReacao(texto)) return false;
    const prazo = setTimeout(() => {
      const retida = this.tirar();
      if (retida) this.vencer(retida.texto, retida.carga);
    }, this.esperaMs);
    this.retida = { texto, carga, prazo };
    return true;
  }

  /** Chegou uma fala seguinte: tira a reação retida (se houver) para sair junto dela. */
  consumir(): { texto: string; carga: T } | null {
    return this.tirar();
  }

  /** Silenciar, parar ou encerrar: a reação retida some sem tocar. */
  limpar(): { texto: string; carga: T } | null {
    return this.tirar();
  }

  private tirar(): { texto: string; carga: T } | null {
    const retida = this.retida;
    if (!retida) return null;
    clearTimeout(retida.prazo);
    this.retida = null;
    return { texto: retida.texto, carga: retida.carga };
  }
}
