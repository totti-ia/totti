import { ReacaoRetida } from "../audio/filaDoAgente";
import type { FocoAudio } from "../audio/foco";
import { tocarGravacao, type ProvedorVoz, type ReproduzirFala, type ReproduzirGravacao } from "./cliente";
import { ESPERA_DA_REACAO_MS, juntarReacao, slugDaReacao, urlDaReacao } from "./reacao";

export type EstadoVoz = "inativa" | "preparando" | "falando" | "erro";
export type LegendaAgente = { quem: "agente"; texto: string; ate: number };

/**
 * Duas falas seguidas do agente não se encostam: a primeira termina, ele respira, e só então vem a próxima.
 * Vale também quando a fala anterior foi cortada (parar) e para a pergunta que chega logo depois de uma resposta.
 */
export const PAUSA_ENTRE_FALAS_MS = 1500;

/** O que a fila mostra na tela (no hook, os setters do React). */
export type TelaVoz = {
  estado: (e: EstadoVoz) => void;
  erro: (e: string | null) => void;
  aviso: (a: string | null) => void;
  provedor: (p: ProvedorVoz) => void;
  fala: (f: LegendaAgente | null) => void;
};

/** Uma fala pedida: tocando, com a vez ou na fila atrás da que toca. */
type Entrada = {
  controle: AbortController;
  /**
   * O áudio já começou a sair: daqui em diante termina antes da próxima, não é substituída. Uma fala com a vez que
   * ainda não tocou (por exemplo, esperando um toque na tela para o navegador liberar o som) continua substituível.
   */
  emReproducao: boolean;
  /** Resolve quando esta fala e todas as anteriores a ela pararam (terminaram, foram cortadas ou substituídas). */
  terminou: Promise<void>;
};

/** Espera `promessa`, mas desiste (rejeita) se o sinal abortar antes. */
function esperar<T>(promessa: Promise<T>, sinal: AbortSignal): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    if (sinal.aborted) { rejeitar(sinal.reason); return; }
    const abortar = () => rejeitar(sinal.reason);
    sinal.addEventListener("abort", abortar, { once: true });
    promessa.then(
      (valor) => { sinal.removeEventListener("abort", abortar); resolver(valor); },
      (erro) => { sinal.removeEventListener("abort", abortar); rejeitar(erro); },
    );
  });
}

function dormir(ms: number, sinal: AbortSignal): Promise<void> {
  let id: ReturnType<typeof setTimeout> | undefined;
  return esperar(new Promise<void>((r) => { id = setTimeout(r, ms); }), sinal).finally(() => clearTimeout(id));
}

/**
 * Fila das falas do agente: só uma toca por vez e entre duas há sempre PAUSA_ENTRE_FALAS_MS.
 * Uma fala nova não corta a que está tocando: o áudio dela é preparado em paralelo e toca depois que a anterior
 * termina, com a pausa. Uma fala que ainda não tinha começado a tocar (esperando a vez, a pausa do candidato ou um
 * toque na tela) fica velha e é substituída pela nova. `parar` corta a que toca e descarta as da fila.
 */
export function criarFilaDeFalas(dependencias: {
  reproduzir: ReproduzirFala;
  /** Toca a gravação de uma reação sem fala seguinte (padrão: lib/voz/cliente.ts). */
  reproduzirGravacao?: ReproduzirGravacao;
  foco: Pick<FocoAudio, "aguardarMicrofone" | "assumir">;
  tela: TelaVoz;
  pausaMs?: number;
  esperaDaReacaoMs?: number;
  agora?: () => number;
}) {
  const { reproduzir, reproduzirGravacao = tocarGravacao, foco, tela, pausaMs = PAUSA_ENTRE_FALAS_MS, esperaDaReacaoMs = ESPERA_DA_REACAO_MS, agora = Date.now } = dependencias;
  /** A fala pedida por último (tocando ou na fila). */
  let ultima: Entrada | null = null;
  /** A fala com a vez: a única que mexe na legenda e no estado. */
  let vez: Entrada | null = null;
  const vivas = new Set<AbortController>();
  /**
   * Uma reação pura ("Hm.") espera a fala seguinte. Quem chega antes do prazo sai junto com ela numa só síntese
   * (`falar` consome a reação); se o prazo passa, a reação toca a gravação (ver lib/voz/reacao.ts). Cada entrada
   * guarda a promessa de quem a pediu: resolve false quando a reação some (junta, parar).
   */
  const reacoes = new ReacaoRetida<{ opcoes?: { antesDeTocar?: () => Promise<boolean> }; resolver: (tocou: boolean) => void }>(
    (texto, carga) => { void enfileirar(texto, carga.opcoes).then(carga.resolver); },
    esperaDaReacaoMs,
  );
  /** Quando o áudio do agente parou pela última vez (fim natural ou corte). */
  let fimDaUltimaFala = Number.NEGATIVE_INFINITY;
  /**
   * A fila segura o foco de saída do áudio do primeiro pedido até esvaziar (síntese, pausa e reprodução), como a fala
   * única fazia antes: se o microfone assume no meio, ele chama `parar` e nenhuma fala velha toca depois do ditado.
   */
  let soltarFoco: (() => void) | undefined;

  function liberarFoco() {
    soltarFoco?.();
    soltarFoco = undefined;
  }

  function parar() {
    if (vez?.emReproducao) fimDaUltimaFala = agora();
    const controles = [...vivas];
    vivas.clear();
    ultima = null;
    vez = null;
    reacoes.limpar()?.carga.resolver(false);
    controles.forEach((c) => c.abort());
    liberarFoco();
    tela.estado("inativa");
    tela.fala(null);
    tela.aviso(null);
  }

  /**
   * `antesDeTocar`: com o áudio pronto e a vez do agente, espera a pessoa fazer uma pausa; false desiste da fala.
   * Devolve true se a fala tocou até o fim (false: cancelada, substituída, junta a uma reação ou com erro).
   */
  async function falar(texto: string, opcoes?: { antesDeTocar?: () => Promise<boolean> }): Promise<boolean> {
    const retida = reacoes.consumir();
    if (retida) {
      retida.carga.resolver(false);
      return enfileirar(juntarReacao(retida.texto, texto), opcoes);
    }
    if (!slugDaReacao(texto)) return enfileirar(texto, opcoes);
    return new Promise<boolean>((resolver) => {
      // Sem reação retida (acabou de ser consumida), reter dá certo; se não der, a reação segue direto.
      if (!reacoes.reter(texto, { opcoes, resolver })) void enfileirar(texto, opcoes).then(resolver);
    });
  }

  /** A fala entra na fila: uma reação (texto só de reação) toca a gravação; as outras, a síntese. */
  async function enfileirar(texto: string, opcoes?: { antesDeTocar?: () => Promise<boolean> }): Promise<boolean> {
    const slug = slugDaReacao(texto);
    const anterior = ultima;
    if (anterior && !anterior.emReproducao) anterior.controle.abort();
    const controle = new AbortController();
    vivas.add(controle);
    let fimProprio!: () => void;
    const proprio = new Promise<void>((r) => { fimProprio = r; });
    const entrada: Entrada = {
      controle,
      emReproducao: false,
      terminou: Promise.all([anterior?.terminou, proprio]).then(() => {}),
    };
    ultima = entrada;
    const daVez = () => vez === entrada && !controle.signal.aborted;
    if (vez === null) { tela.erro(null); tela.estado("preparando"); }
    let tocou = false;
    let falhou = false;
    const eventos = {
      aoIniciar: (fonte: ProvedorVoz) => {
        if (!daVez()) return;
        tocou = true;
        entrada.emReproducao = true;
        tela.estado("falando");
        tela.provedor(fonte);
        tela.aviso(null);
      },
      aoAguardarGesto: () => { if (daVez()) tela.aviso("Toque na tela para ouvir o Totti."); },
      aoProgresso: (ate: number) => { if (daVez()) tela.fala({ quem: "agente", texto, ate }); },
    };
    const antesDaVez = async () => {
      // A fala anterior termina e o agente respira antes desta.
      if (anterior) await esperar(anterior.terminou, controle.signal);
      const falta = fimDaUltimaFala + pausaMs - agora();
      if (falta > 0) await dormir(falta, controle.signal);
      vez = entrada;
      tela.erro(null);
      tela.estado("preparando");
      tela.fala({ quem: "agente", texto, ate: 0 });
      // Substituída ou cortada enquanto espera a pausa do candidato: desiste na hora, sem segurar a próxima.
      if (opcoes?.antesDeTocar && !(await esperar(opcoes.antesDeTocar(), controle.signal))) return false;
      controle.signal.throwIfAborted();
      return true;
    };
    try {
      await foco.aguardarMicrofone(controle.signal);
      controle.signal.throwIfAborted();
      soltarFoco ??= foco.assumir("saida", parar);
      // Reação sem fala seguinte toca a gravação; as demais falas, a síntese.
      if (slug) await reproduzirGravacao(urlDaReacao(slug), texto, controle.signal, eventos, antesDaVez);
      else await reproduzir(texto, controle.signal, eventos, antesDaVez);
      return tocou && !controle.signal.aborted;
    } catch (e) {
      // Reação sem gravação que carregue: descartada em silêncio, sem erro na tela e sem síntese.
      if (!controle.signal.aborted && !slug) {
        falhou = true;
        tela.erro(e instanceof Error ? e.message : "A voz está indisponível. A resposta continua no texto.");
        // Com outra fala tocando, ela segue: o erro desta não derruba o estado daquela.
        if (vez === null || vez === entrada) tela.estado("erro");
      }
      return false;
    } finally {
      vivas.delete(controle);
      if (tocou) fimDaUltimaFala = agora();
      const ultimaDaFila = ultima === null || ultima === entrada;
      if (ultima === entrada) ultima = null;
      // A fila esvaziou: devolve o foco (o microfone pode abrir). Com outra fala atrás, segue com ele na pausa.
      if (ultima === null) liberarFoco();
      if (vez === entrada) {
        vez = null;
        tela.fala(null);
        tela.aviso(null);
        // Com outra fala na fila, o agente segue "preparando" na pausa: ninguém toma a vez dele no meio.
        if (!ultimaDaFila) tela.estado("preparando");
        else if (!falhou) tela.estado("inativa");
      } else if (ultimaDaFila && vez === null && !falhou && !controle.signal.aborted) {
        tela.estado("inativa");
      }
      fimProprio();
    }
  }

  return { falar, parar };
}

export type FilaDeFalas = ReturnType<typeof criarFilaDeFalas>;
