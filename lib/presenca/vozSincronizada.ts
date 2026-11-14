import { momentoDoTrecho, textoFaladoAte, type Alinhamento } from "./alinhamento";

export type MarcaDeFala = { trecho: string; aoChegar: () => void };

/** Parte pura: horários ordenados, com índices estáveis para marcas simultâneas. */
export function agendaDasMarcas(alinhamento: Alinhamento, trechos: readonly string[]): { indice: number; tempo: number }[] {
  return trechos.map((trecho, indice) => ({ indice, tempo: momentoDoTrecho(alinhamento, trecho) ?? 0 }))
    .sort((a, b) => a.tempo - b.tempo || a.indice - b.indice);
}

/** Quantidade em unidades UTF-16, como String.length e o recorte da legenda. */
export function progressoDaFala(alinhamento: Alinhamento, tempo: number): number {
  return textoFaladoAte(alinhamento, tempo).length;
}

// Safari (e Chrome em alguns casos) só deixa tocar áudio que começou num gesto do usuário. A voz chega depois de
// uma chamada assíncrona, então o play() seria bloqueado e a fala cairia na voz do navegador. Um elemento tocado
// uma vez num clique fica "liberado" e é reaproveitado nas falas seguintes.
const WAV_SILENCIO = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let elementoLiberado: HTMLAudioElement | null = null;

// No WebKit (principalmente iOS), pointerdown e touchstart de toque não contam como gesto para tocar mídia:
// quem conta é touchend, pointerup e click. Os de "down" ficam para destravar o mais cedo possível no desktop.
export const GESTOS_DE_ATIVACAO = ["pointerdown", "keydown", "touchstart", "pointerup", "touchend", "click"] as const;

/**
 * Chame dentro de um gesto do usuário (clique ou tecla). Depois disso, as falas tocam sem bloqueio.
 * Cada gesto tenta de novo enquanto nenhum deu certo, mesmo com uma tentativa anterior pendente: um pointerdown
 * sem ativação (Safari) não pode tirar a vez do click que vem logo depois.
 */
export function liberarAudio(): void {
  acordarSaida();
  // O contexto da rampa nasce e retoma aqui, no gesto: parado, ele deixaria a fala muda.
  contextoPronto();
  if (elementoLiberado || typeof Audio === "undefined") return;
  try {
    const elemento = new Audio(WAV_SILENCIO);
    Promise.resolve(elemento.play()).then(
      () => {
        elemento.pause();
        elementoLiberado ??= elemento;
      },
      () => {},
    );
  } catch {}
}

/**
 * Saída de som acordada (#73). Entre o destrave e a primeira fala, e entre uma fala e outra, a saída fica parada, e
 * a saída (fone Bluetooth, placa que dorme, Chrome no macOS) leva mais de meio segundo para acordar: o começo da
 * fala sumia ("...otti, vou montar"). Enquanto uma tela que fala está montada, um AudioContext toca um tom de 20 Hz
 * a -80 dB (inaudível) para a saída não dormir. Contado por uso: a última tela que desmonta fecha o contexto.
 */
const GANHO_ACORDADO = 0.0001;
const acordador: { usuarios: number; contexto: AudioContext | null } = { usuarios: 0, contexto: null };

type JanelaComAudio = { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };

/** Liga (ou retoma) o tom inaudível se alguma tela que fala está montada. Retomar pede gesto ou ativação anterior. */
function acordarSaida(): void {
  if (!acordador.usuarios || typeof window === "undefined") return;
  if (acordador.contexto) {
    if (acordador.contexto.state === "suspended") void acordador.contexto.resume().catch(() => {});
    return;
  }
  const janela = window as unknown as JanelaComAudio;
  const Construtor = janela.AudioContext ?? janela.webkitAudioContext;
  if (!Construtor) return;
  try {
    const contexto = new Construtor();
    const tom = contexto.createOscillator();
    const ganho = contexto.createGain();
    tom.frequency.value = 20;
    ganho.gain.value = GANHO_ACORDADO;
    tom.connect(ganho).connect(contexto.destination);
    tom.start();
    acordador.contexto = contexto;
    if (contexto.state === "suspended") void contexto.resume().catch(() => {});
  } catch {}
}

/** Mantém a saída de som acordada enquanto a tela que fala estiver montada; devolve a liberação. */
export function manterSaidaAcordada(): () => void {
  acordador.usuarios++;
  acordarSaida();
  let liberado = false;
  return () => {
    if (liberado) return;
    liberado = true;
    acordador.usuarios = Math.max(0, acordador.usuarios - 1);
    if (acordador.usuarios || !acordador.contexto) return;
    void acordador.contexto.close().catch(() => {});
    acordador.contexto = null;
  };
}

/** Rampa de entrada: a fala sobe de silêncio em 80 ms, para o primeiro milissegundo não sair em volume cheio. */
export const RAMPA_DE_ENTRADA_MS = 80;

/** Parte pura: ganho 0 no instante dado e subida linear até 1 em RAMPA_DE_ENTRADA_MS. */
export function agendarRampaDeEntrada(ganho: { gain: AudioParam }, agora: number): void {
  ganho.gain.cancelScheduledValues(agora);
  ganho.gain.setValueAtTime(0, agora);
  ganho.gain.linearRampToValueAtTime(1, agora + RAMPA_DE_ENTRADA_MS / 1000);
}

// Grafo da rampa: um AudioContext próprio, criado no primeiro gesto e nunca fechado (um elemento ligado a um contexto
// fechado fica mudo). createMediaElementSource só pode ser chamado uma vez por elemento: a ligação fica guardada.
type LigacaoDaRampa = { origem: MediaElementAudioSourceNode; ganho: GainNode };
let grafoDaRampa: { contexto: AudioContext; ligacoes: WeakMap<HTMLAudioElement, LigacaoDaRampa> } | null = null;

function contextoDaRampa(): AudioContext | null {
  if (grafoDaRampa) return grafoDaRampa.contexto;
  if (typeof window === "undefined") return null;
  const janela = window as unknown as JanelaComAudio;
  const Construtor = janela.AudioContext ?? janela.webkitAudioContext;
  if (!Construtor) return null;
  try {
    grafoDaRampa = { contexto: new Construtor(), ligacoes: new WeakMap() };
    return grafoDaRampa.contexto;
  } catch {
    return null;
  }
}

/** O contexto da rampa, retomado se estiver parado. Só liga elementos ao grafo quando ele está rodando. */
function contextoPronto(): AudioContext | null {
  const contexto = contextoDaRampa();
  if (!contexto) return null;
  if (contexto.state === "suspended") void contexto.resume().catch(() => {});
  return contexto.state === "running" ? contexto : null;
}

/** Elemento já ligado ao grafo: se o contexto parar, ele fica mudo, e a fala tem de sair por outro elemento. */
function ligadoAoGrafo(elemento: HTMLAudioElement): boolean {
  return grafoDaRampa?.ligacoes.has(elemento) ?? false;
}

/** Liga o elemento ao grafo (se o contexto estiver rodando) com o ganho em 0; null quando a fala sai sem rampa. */
function ganhoDaRampa(elemento: HTMLAudioElement): GainNode | null {
  const contexto = contextoPronto();
  if (!contexto || !grafoDaRampa) return null;
  let ligacao = grafoDaRampa.ligacoes.get(elemento);
  if (!ligacao) {
    try {
      const origem = contexto.createMediaElementSource(elemento);
      const ganho = contexto.createGain();
      origem.connect(ganho).connect(contexto.destination);
      ligacao = { origem, ganho };
      grafoDaRampa.ligacoes.set(elemento, ligacao);
    } catch {
      return null;
    }
  }
  ligacao.ganho.gain.cancelScheduledValues(contexto.currentTime);
  ligacao.ganho.gain.setValueAtTime(0, contexto.currentTime);
  return ligacao.ganho;
}

/** Só para testes: descarta o grafo, para que o próximo contexto seja o do teste. */
export function esquecerRampaDeEntrada(): void {
  grafoDaRampa = null;
}

/** Quanto esperar o áudio carregar o bastante para tocar sem engasgo antes de chamar play(). */
const ESPERA_CARREGAR_MS = 1_500;
const HAVE_ENOUGH_DATA = 4;

export function tocarComAlinhamento(
  audio: Blob,
  alinhamento: Alinhamento,
  opcoes: {
    aoProgresso?: (caracteres: number) => void;
    marcas?: MarcaDeFala[];
    sinal?: AbortSignal;
    /** O navegador bloqueou o play(): o áudio toca no próximo gesto do usuário (toque, clique ou tecla). */
    aoAguardarGesto?: () => void;
  },
): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    const marcas = opcoes.marcas ?? [];
    const agenda = agendaDasMarcas(alinhamento, marcas.map((m) => m.trecho));
    let proximaMarca = 0;
    let ultimoProgresso = -1;
    let midia: HTMLAudioElement | null = null;
    let url: string | null = null;
    let quadro: number | null = null;
    let terminou = false;
    let pararDeEsperarGesto: (() => void) | null = null;
    let ganho: GainNode | null = null;
    let rampaAgendada = false;

    // A rampa começa no início real da reprodução e só uma vez por fala: um engasgo (waiting → playing) não a repete.
    function iniciarRampa() {
      if (rampaAgendada || !ganho) return;
      rampaAgendada = true;
      agendarRampaDeEntrada(ganho, ganho.context.currentTime);
    }

    function terminar(erro?: unknown) {
      if (terminou) return;
      terminou = true;
      pararDeEsperarGesto?.();
      if (quadro !== null) cancelAnimationFrame(quadro);
      opcoes.sinal?.removeEventListener("abort", cancelar);
      if (midia) {
        midia.onended = null;
        midia.onerror = null;
        midia.onplaying = null;
        try {
          midia.pause();
          midia.removeAttribute("src");
        } catch {}
      }
      if (url !== null) URL.revokeObjectURL(url);
      if (erro !== undefined) rejeitar(erro);
      else resolver();
    }

    function cancelar() {
      terminar(opcoes.sinal?.reason ?? new DOMException("Reprodução cancelada.", "AbortError"));
    }

    function atualizar(tempo: number) {
      const progresso = progressoDaFala(alinhamento, tempo);
      if (progresso !== ultimoProgresso) {
        ultimoProgresso = progresso;
        opcoes.aoProgresso?.(progresso);
      }
      while (!terminou && proximaMarca < agenda.length && agenda[proximaMarca].tempo <= tempo) {
        const marca = agenda[proximaMarca++];
        marcas[marca.indice].aoChegar();
      }
    }

    function animar() {
      quadro = null;
      if (terminou || !midia) return;
      try {
        atualizar(midia.currentTime);
        if (!terminou) quadro = requestAnimationFrame(animar);
      } catch (erro) {
        terminar(erro);
      }
    }

    /** Espera dados suficientes para tocar sem engasgo (canplaythrough), com prazo: nunca segura a fala de vez. */
    function carregado(elemento: HTMLAudioElement): Promise<void> {
      if (typeof elemento.readyState !== "number" || elemento.readyState >= HAVE_ENOUGH_DATA) return Promise.resolve();
      return new Promise((pronto) => {
        const limpar = () => {
          clearTimeout(prazo);
          elemento.removeEventListener?.("canplaythrough", fim);
          opcoes.sinal?.removeEventListener("abort", fim);
          pronto();
        };
        const fim = () => limpar();
        const prazo = setTimeout(fim, ESPERA_CARREGAR_MS);
        elemento.addEventListener?.("canplaythrough", fim, { once: true });
        opcoes.sinal?.addEventListener("abort", fim, { once: true });
      });
    }

    // Bloqueio de autoplay: em vez de trocar de voz, espera o próximo gesto e toca o mesmo áudio dentro dele.
    function esperarGesto() {
      const tentar = () => {
        const elemento = midia;
        if (terminou || !elemento) return;
        Promise.resolve(elemento.play()).then(() => {
          if (terminou) return;
          pararDeEsperarGesto?.();
          elementoLiberado ??= elemento;
          iniciarRampa();
          if (quadro === null) animar();
        }, () => {});
      };
      GESTOS_DE_ATIVACAO.forEach((e) => window.addEventListener(e, tentar, { capture: true }));
      pararDeEsperarGesto = () => {
        GESTOS_DE_ATIVACAO.forEach((e) => window.removeEventListener(e, tentar, { capture: true }));
        pararDeEsperarGesto = null;
      };
      opcoes.aoAguardarGesto?.();
    }

    if (opcoes.sinal?.aborted) {
      cancelar();
      return;
    }
    try {
      url = URL.createObjectURL(audio);
      // Elemento ligado ao grafo com o contexto parado ficaria mudo: nesse caso a fala sai por um elemento novo.
      if (elementoLiberado && (!ligadoAoGrafo(elementoLiberado) || contextoPronto())) {
        midia = elementoLiberado;
        midia.src = url;
      } else midia = new Audio(url);
      midia.preload = "auto";
      midia.onended = () => {
        try {
          atualizar(Infinity);
          terminar();
        } catch (erro) {
          terminar(erro);
        }
      };
      midia.onerror = () => terminar(new Error("Não foi possível reproduzir o áudio da fala."));
      // O relógio da legenda (e da mão) só começa quando o som sai de fato ("playing"), não quando o play() foi
      // aceito. Depois de um engasgo (waiting → playing) ele continua de onde a mídia está.
      const comecarRelogio = () => {
        if (terminou) return;
        iniciarRampa();
        if (quadro === null) animar();
      };
      midia.onplaying = comecarRelogio;
      opcoes.sinal?.addEventListener("abort", cancelar, { once: true });
      const elemento = midia;
      void carregado(elemento).then(() => {
        if (terminou) return;
        // Sem contexto rodando, ganho é null e o elemento toca direto, sem a rampa.
        ganho = ganhoDaRampa(elemento);
        Promise.resolve(elemento.play()).then(() => {
          // Sem o evento (navegador antigo, testes): o play() aceito vale como começo.
          if (!terminou && !elemento.paused) comecarRelogio();
        }, (erro: unknown) => {
          if (terminou) return;
          if (erro instanceof DOMException && erro.name === "NotAllowedError") esperarGesto();
          else terminar(new Error("Reprodução de áudio indisponível."));
        });
      });
    } catch {
      terminar(new Error("Não foi possível iniciar a reprodução do áudio."));
    }
  });
}
