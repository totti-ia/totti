import { AudioFormat, CommitStrategy, RealtimeEvents, Scribe, type RealtimeConnection } from "@elevenlabs/client";
import { capturarAudio } from "./captura";
import { iniciarCapturaAntecipada, type CapturaAntecipada } from "./capturaAntecipada";
import type { EventosTranscricao, SessaoTranscricao } from "./tipos";
import { normalizarTermos, TERMOS_RECRUTAMENTO } from "./vocabulario";
import {
  AMOSTRAS_MANTER_VIVO, AMOSTRAS_MINIMAS_TRECHO, COMMIT_DE_SEGURANCA_MS, COMMIT_TRECHO_CURTO_MS, criarDetectorDeFala,
  criarFilaDeAmostras, criarPortaoDeVoz, esperaParaReconectar, MANTER_VIVO_MS, MAXIMO_PENDENTE, pcm16LE,
  silencioParaCompletar, trechoPlausivel, VOZ_MINIMA_MS,
} from "../presenca/transcricao";
import { ErroTokenTranscricao } from "../presenca/tokenTranscricao";
import { energiaPcm16 } from "./energia";

export { energiaPcm16 } from "./energia";

/** Igual ao vadSilenceThresholdSecs (0,9 s, como nas salas): voz mais recente que isso, quando um trecho é confirmado, já é do próximo. */
const JANELA_DO_PROXIMO_TRECHO_MS = 900;
/** Tempo para a sessão abrir (o mesmo de B). */
const TEMPO_PARA_CONECTAR_MS = 10_000;
/** Sessão aberta por pelo menos isso zera as tentativas de reconexão (o mesmo de B). */
const SESSAO_ESTAVEL_MS = 10_000;
/** Tamanho dos blocos com que o áudio guardado na queda sai ao reconectar (200 ms, como em B). */
const BLOCO_DRENAGEM = 3200;
/** Erros que repetir não resolve (a mesma lista de B). */
const ERROS_PERMANENTES = ["quota_exceeded", "unaccepted_terms", "input_error", "invalid_request", "chunk_size_exceeded"];

type ErroConexao = Error & { permanente?: boolean };

function erroDeConexao(mensagem: string, permanente: boolean): ErroConexao {
  return Object.assign(new Error(mensagem), { permanente });
}

/** Permanente: sem chave, sessão encerrada ou erro do Scribe que repetir não resolve (critério de B). */
function ehPermanente(erro: unknown): boolean {
  if (erro instanceof ErroTokenTranscricao) return erro.permanente;
  return (erro as ErroConexao | null)?.permanente === true;
}

/** PCM 16 bits little-endian em base64 para amostras de 16 kHz (o portão de voz trabalha em float). */
function amostrasDeBase64(base64: string): Float32Array {
  const binario = atob(base64);
  const amostras = new Float32Array(Math.floor(binario.length / 2));
  for (let i = 0; i < amostras.length; i++) {
    const bruto = binario.charCodeAt(2 * i) | (binario.charCodeAt(2 * i + 1) << 8);
    // Inverso exato de pcm16LE: a volta ao base64 não altera o áudio.
    amostras[i] = bruto >= 32768 ? (bruto - 65536) / 32768 : bruto / 32767;
  }
  return amostras;
}

function base64DeAmostras(amostras: Float32Array): string {
  let binario = "";
  for (const byte of pcm16LE(amostras)) binario += String.fromCharCode(byte);
  return btoa(binario);
}

export async function iniciarScribe({ token, termos, stream, signal, eventos, captura: antecipada, obterToken }: {
  token: string;
  /** Vocabulário extra (palavras do título da vaga), somado à lista fixa de recrutamento técnico. */
  termos?: readonly string[];
  stream?: MediaStream | null;
  signal: AbortSignal;
  eventos: EventosTranscricao;
  /** Captura já iniciada pelo chamador (no clique, antes do token): o áudio guardado vai quando a sessão abrir. */
  captura?: CapturaAntecipada;
  /**
   * Token novo para reconectar depois de uma queda (o mesmo caminho do primeiro token). Sem ele, queda encerra,
   * como antes. A reconexão segue B: espera crescente e tentativas limitadas.
   */
  obterToken?: () => Promise<string>;
}, dependencias = { conectar: Scribe.connect, capturar: capturarAudio }): Promise<SessaoTranscricao> {
  if (signal.aborted) { antecipada?.cancelar(); signal.throwIfAborted(); }
  // A captura começa antes da sessão do Scribe abrir; o áudio espera no buffer e sai todo no SESSION_STARTED.
  const captura = antecipada ?? iniciarCapturaAntecipada({ stream, capturar: dependencias.capturar });
  let encerrada = false;
  let parando = false;
  let confirmar: (() => void) | undefined;
  /** Abertura em curso (até SESSION_STARTED): quem espera a sessão rejeita por aqui. */
  let abertura: ((erro: Error) => void) | null = null;
  let parada: Promise<void> | undefined;
  let enviouAudio = false;
  /** Voz (ms) que o microfone captou desde o último trecho confirmado: o mesmo portão das salas. */
  let vozNoTrecho = 0;
  /** Últimos blocos (duração e se tinham voz), cobrindo ao menos JANELA_DO_PROXIMO_TRECHO_MS. */
  const recentes: { ms: number; voz: boolean }[] = [];
  const detector = criarDetectorDeFala();
  /** Só o áudio que o portão libera vai ao Scribe, que cobra pelo tempo enviado (mesmo portão das salas). */
  const portao = criarPortaoDeVoz();
  /** Amostras (16 kHz) que o portão liberou desde que abriu: trecho curto é completado com silêncio. */
  let amostrasNoTrecho = 0;
  /** Voz enviada que o Scribe ainda não confirmou com committed_transcript. */
  let vozSemCommit = false;
  let commitDeSeguranca: ReturnType<typeof setTimeout> | null = null;
  /** Relógio de performance do último envio: com o portão fechado, o silêncio de manter viva a conexão sai daqui. */
  let ultimoEnvio = 0;
  /** Conexão atual. A geração muda a cada conexão: evento de conexão antiga é ignorado. */
  let conexao: RealtimeConnection | null = null;
  let geracao = 0;
  /** A sessão da conexão atual abriu (SESSION_STARTED): só então o áudio sai direto. */
  let pronto = false;
  let conectadoEm = 0;
  let reconectando = false;
  let tentativas = 0;
  let acordar: (() => void) | null = null;
  /** Áudio que o portão liberou durante a queda: sai em ordem quando a sessão nova abre (mesmo limite de B). */
  const fila = criarFilaDeAmostras(MAXIMO_PENDENTE);

  function encerrar() {
    if (encerrada) return;
    encerrada = true;
    signal.removeEventListener("abort", cancelar);
    cancelarCommitDeSeguranca();
    acordar?.();
    abertura?.(new Error("A transcrição foi interrompida."));
    descartar();
    captura.cancelar();
    confirmar?.();
    eventos.aoParcial("");
    eventos.aoEncerrar();
  }
  function cancelar() {
    abertura?.(new DOMException("Transcrição cancelada", "AbortError"));
    encerrar();
  }
  function falhar(erro: Error) {
    if (encerrada) return;
    abertura?.(erro);
    eventos.aoErro(erro);
    encerrar();
  }
  /** Solta a conexão atual: a geração muda para os eventos dela deixarem de valer, e o socket fecha. */
  function descartar() {
    const anterior = conexao;
    conexao = null;
    pronto = false;
    geracao++;
    if (anterior) { try { anterior.close(); } catch {} }
  }
  /** A queda leva o trecho que não foi confirmado: o estado dele recomeça do zero na conexão nova. */
  function zerarTrecho() {
    cancelarCommitDeSeguranca();
    vozNoTrecho = 0;
    amostrasNoTrecho = 0;
    vozSemCommit = false;
  }
  /**
   * Manda um bloco ao Scribe. Durante a queda o bloco espera na fila e sai com a sessão nova; com a transcrição
   * encerrada, nada sai. Falha de envio é queda da conexão (reconecta, se der).
   */
  function enviar(amostras: Float32Array): boolean {
    if (encerrada || !amostras.length) return false;
    const c = conexao;
    if (!pronto || !c) { fila.guardar(amostras); return false; }
    const minha = geracao;
    try { c.send({ audioBase64: base64DeAmostras(amostras) }); } catch {
      falhaDaConexao(minha, erroDeConexao("Não consegui enviar o áudio. Tente novamente.", false));
      return false;
    }
    enviouAudio = true;
    ultimoEnvio = performance.now();
    return true;
  }
  function cancelarCommitDeSeguranca() {
    if (commitDeSeguranca !== null) clearTimeout(commitDeSeguranca);
    commitDeSeguranca = null;
  }
  /** Commit manual (como as salas): um bloco de silêncio e o commit, para o Scribe fechar o trecho. */
  function commitar() {
    const c = conexao;
    if (!pronto || !c) return;
    const minha = geracao;
    if (!enviar(new Float32Array(AMOSTRAS_MANTER_VIVO))) return;
    try { c.commit(); } catch {
      falhaDaConexao(minha, erroDeConexao("Não consegui finalizar o áudio. Tente novamente.", false));
      return;
    }
    vozSemCommit = false;
  }
  /**
   * O VAD não confirmou a voz enviada até `esperaMs` depois de o portão fechar: confirma à mão. Se a voz voltar
   * antes, o timer é cancelado (a fala nova agenda o próximo commit ao fechar).
   */
  function agendarCommitDeSeguranca(esperaMs = COMMIT_DE_SEGURANCA_MS) {
    cancelarCommitDeSeguranca();
    if (encerrada || !pronto || !vozSemCommit) return;
    commitDeSeguranca = setTimeout(() => {
      commitDeSeguranca = null;
      if (encerrada || !vozSemCommit || portao.aberto) return;
      commitar();
    }, esperaMs);
  }
  /**
   * O portão fechou: trecho curto ("sim") ganha o silêncio que falta para o Scribe processá-lo e um commit mais cedo;
   * os outros esperam o VAD e, se ele não confirmar, o commit de segurança. Igual às salas.
   */
  function fecharTrecho() {
    // Se o VAD já confirmou o trecho na folga, completar só gastaria áudio cobrado.
    const curto = vozSemCommit && amostrasNoTrecho < AMOSTRAS_MINIMAS_TRECHO;
    if (curto) {
      // O complemento conta como amostras do trecho: o parar() não completa de novo o que já foi completado.
      const complemento = silencioParaCompletar(amostrasNoTrecho);
      enviar(complemento);
      amostrasNoTrecho += complemento.length;
    }
    agendarCommitDeSeguranca(curto ? COMMIT_TRECHO_CURTO_MS : COMMIT_DE_SEGURANCA_MS);
  }
  /**
   * Com o portão fechado nada sai, e o Scribe fecha após ~15 s sem áudio: um bloco curto de silêncio a cada
   * MANTER_VIVO_MS, como nas salas (o silêncio de manter viva não passa pelo portão).
   */
  function manterVivo() {
    if (pronto && !portao.aberto && performance.now() - ultimoEnvio >= MANTER_VIVO_MS) enviar(new Float32Array(AMOSTRAS_MANTER_VIVO));
  }
  /** Áudio guardado na queda sai em ordem, em blocos de 200 ms, logo que a sessão nova abre. */
  function drenarFila() {
    while (fila.length && pronto && !encerrada) {
      if (!enviar(fila.tirar(BLOCO_DRENAGEM))) break;
    }
    // Trecho fechado durante a queda: sem o portão aberto, o VAD confirma ou o commit de segurança fecha.
    if (vozSemCommit && !portao.aberto) agendarCommitDeSeguranca();
  }
  function esperar(ms: number) {
    return new Promise<void>((resolver) => {
      const timer = setTimeout(() => { acordar = null; resolver(); }, ms);
      acordar = () => { clearTimeout(timer); acordar = null; resolver(); };
    });
  }
  /**
   * Falha de uma conexão. Na abertura, quem decide é a reconexão (se estiver rodando) ou a falha da primeira vez.
   * Com a sessão aberta, repete se há token novo e o erro não é permanente; parar() em curso encerra, como antes.
   */
  function falhaDaConexao(minha: number, erro: ErroConexao) {
    if (minha !== geracao || encerrada) return;
    if (abertura) {
      if (reconectando) abertura(erro);
      else falhar(erro);
      return;
    }
    if (!obterToken || erro.permanente || parando) { falhar(erro); return; }
    void reconectar(obterToken);
  }
  /** Eventos de uma conexão, registrados na abertura e de novo em cada reconexão. */
  function registrarEventos(c: RealtimeConnection, minha: number, aoIniciar: () => void) {
    c.on(RealtimeEvents.SESSION_STARTED, () => {
      if (minha === geracao && !encerrada) aoIniciar();
    });
    c.on(RealtimeEvents.PARTIAL_TRANSCRIPT, ({ text }) => {
      // Sem voz suficiente no trecho, o parcial é alucinação do Scribe: não mostra (igual às salas).
      if (minha === geracao && !encerrada && vozNoTrecho >= VOZ_MINIMA_MS) eventos.aoParcial(text);
    });
    c.on(RealtimeEvents.COMMITTED_TRANSCRIPT, ({ text }) => {
      if (minha !== geracao || encerrada) return;
      eventos.aoParcial("");
      const texto = text.trim();
      // Sem voz no microfone, ou voz curta demais para o tamanho do texto: frase inventada pelo Scribe.
      if (texto && trechoPlausivel(texto, vozNoTrecho)) eventos.aoTexto(texto);
      else if (texto) console.info("[transcrição] descartada (voz insuficiente para o texto)", { vozMs: Math.round(vozNoTrecho), texto });
      // O VAD só confirma depois de 0,9 s de silêncio: voz no último segundo enviado já é do trecho seguinte (o commit
      // pode chegar depois de o próximo áudio sair). Zerar aqui descartaria esse trecho como inventado.
      vozNoTrecho = recentes.reduce((soma, b) => soma + (b.voz ? b.ms : 0), 0);
      // Trecho confirmado (mesmo vazio, como resposta ao commit): o commit de segurança deixa de ser necessário.
      vozSemCommit = false;
      cancelarCommitDeSeguranca();
      if (parando) confirmar?.();
    });
    c.on(RealtimeEvents.ERROR, (evento) => {
      if (minha !== geracao || encerrada) return;
      if (parando && evento.message_type === "insufficient_audio_activity") {
        confirmar?.();
        return;
      }
      const permanente = ERROS_PERMANENTES.includes(evento.message_type ?? "");
      falhaDaConexao(minha, erroDeConexao("A transcrição de voz falhou. Confira a conexão e a configuração da ElevenLabs.", permanente));
    });
    c.on(RealtimeEvents.CLOSE, () => {
      if (minha !== geracao || encerrada) return;
      falhaDaConexao(minha, erroDeConexao("A conexão da transcrição foi interrompida. Tente novamente.", false));
    });
  }
  /** Abre uma conexão com `tokenAtual` e espera a sessão começar. A falha rejeita; quem chama decide se repete. */
  function abrirConexao(tokenAtual: string): Promise<void> {
    const minha = ++geracao;
    pronto = false;
    return new Promise<void>((resolver, rejeitar) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const falha = (erro: Error) => {
        clearTimeout(timer);
        if (abertura === falha) abertura = null;
        if (minha === geracao) descartar();
        rejeitar(erro);
      };
      abertura = falha;
      timer = setTimeout(() => falha(erroDeConexao("A transcrição demorou para conectar. Tente novamente.", false)), TEMPO_PARA_CONECTAR_MS);
      try {
        const c = dependencias.conectar({
          token: tokenAtual,
          modelId: "scribe_v2_realtime",
          languageCode: "pt",
          audioFormat: AudioFormat.PCM_16000,
          sampleRate: 16000,
          commitStrategy: CommitStrategy.VAD,
          vadSilenceThresholdSecs: 0.9,
          // Sem isso o Scribe transcreve hesitações ao pé da letra ("ca-- s--", "ééé", "hã"). Testado com o
          // scribe_v2_realtime: "Eu tô querendo ca-- ééé, contratar, hã..." vira "Eu tô querendo contratar...".
          noVerbatim: true,
          keyterms: normalizarTermos(TERMOS_RECRUTAMENTO, termos),
        });
        conexao = c;
        registrarEventos(c, minha, () => {
          clearTimeout(timer);
          abertura = null;
          reconectando = false;
          pronto = true;
          conectadoEm = ultimoEnvio = performance.now();
          resolver();
          drenarFila();
        });
      } catch (erro) {
        falha(erro instanceof Error ? erro : erroDeConexao("Não consegui abrir a transcrição.", false));
      }
    });
  }
  /**
   * Reconexão como em B: espera `esperaParaReconectar`, pede token novo pelo mesmo caminho do primeiro e abre outra
   * conexão. O áudio captado nesse meio tempo espera na fila. Erro permanente ou tentativas esgotadas encerram.
   */
  async function reconectar(obter: () => Promise<string>) {
    reconectando = true;
    if (pronto && performance.now() - conectadoEm >= SESSAO_ESTAVEL_MS) tentativas = 0;
    descartar();
    zerarTrecho();
    while (!encerrada) {
      const espera = esperaParaReconectar(tentativas++);
      if (espera === null) {
        falhar(new Error("A conexão da transcrição foi interrompida. Tente novamente."));
        return;
      }
      await esperar(espera);
      if (encerrada) return;
      let novoToken: string;
      try { novoToken = await obter(); } catch (erro) {
        if (ehPermanente(erro)) { falhar(erro instanceof Error ? erro : new Error("Não consegui renovar a transcrição.")); return; }
        continue;
      }
      if (encerrada) return;
      try { await abrirConexao(novoToken); return; } catch (erro) {
        if (ehPermanente(erro)) { falhar(erro as Error); return; }
      }
    }
  }

  signal.addEventListener("abort", cancelar, { once: true });
  try {
    await abrirConexao(token);
    signal.throwIfAborted();
    await captura.pronta;
    signal.throwIfAborted();
    if (encerrada) throw new Error("A transcrição foi interrompida.");
    captura.ligar((audioBase64) => {
      if (encerrada) return;
      const { energia, duracaoMs } = energiaPcm16(audioBase64);
      // Aberto, o portão segue com fala mais baixa por um tempo depois da última voz; abrir pede LIMIAR_VOZ_RMS.
      const { voz, fala } = detector.medir(energia, duracaoMs, portao.aberto);
      if (voz) vozNoTrecho += duracaoMs;
      recentes.push({ ms: duracaoMs, voz });
      let total = recentes.reduce((soma, b) => soma + b.ms, 0);
      while (recentes.length > 1 && total - recentes[0].ms >= JANELA_DO_PROXIMO_TRECHO_MS) total -= recentes.shift()!.ms;
      // A energia de todo bloco vai ao fim do turno, inclusive a dos blocos que o portão segura.
      eventos.aoEnergia?.(energia);
      // Voz abre o portão com o pré-roll de antes da fala; fechado, o bloco é guardado só o tempo do pré-roll.
      const passou = portao.passar(amostrasDeBase64(audioBase64), fala);
      amostrasNoTrecho = (passou.abriu ? 0 : amostrasNoTrecho) + passou.amostras.length;
      if (fala) { vozSemCommit = true; cancelarCommitDeSeguranca(); }
      enviar(passou.amostras);
      if (passou.fechou) fecharTrecho();
      else manterVivo();
    });
  } catch (erro) {
    encerrar();
    throw erro;
  }

  return {
    cancelar,
    parar() {
      if (parada) return parada;
      parada = (async () => {
        if (encerrada) return;
        await captura.parar();
        if (encerrada) return;
        // Queda em curso: não há conexão para confirmar o último trecho. Encerra sem commit e para a reconexão.
        if (!pronto) { encerrar(); return; }
        // Um commit por silêncio pode chegar depois que o próximo áudio já foi enviado.
        // Sempre drena o fim da captura, mesmo se um segmento acabou de ser confirmado.
        if (!enviouAudio) { encerrar(); return; }
        // Portão aberto: a folga sai como silêncio antes do commit final. O pré-roll guardado só tem silêncio (voz
        // abre o portão e sai junto com ele), então nenhuma fala fica retida.
        const folga = portao.encerrar();
        amostrasNoTrecho += folga.length;
        enviar(folga);
        // O modelo começa a processar após ~2 s de áudio. Completa falas curtas (como "sim") com silêncio para que o
        // primeiro commit possa ser reconhecido.
        if (vozSemCommit) {
          const complemento = silencioParaCompletar(amostrasNoTrecho);
          enviar(complemento);
          amostrasNoTrecho += complemento.length;
        }
        const c = conexao;
        if (encerrada) return;
        if (!pronto || !c) { encerrar(); return; }
        parando = true;
        cancelarCommitDeSeguranca();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>((resolve) => {
          confirmar = resolve;
          timer = setTimeout(() => {
            eventos.aoErro(new Error("Não recebi o fim da transcrição. Confira o texto antes de enviar."));
            resolve();
          }, 4000);
          try { c.commit(); } catch { resolve(); }
        });
        clearTimeout(timer);
        encerrar();
      })();
      return parada;
    },
  };
}
