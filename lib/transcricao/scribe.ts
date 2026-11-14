import { AudioFormat, CommitStrategy, RealtimeEvents, Scribe } from "@elevenlabs/client";
import { capturarAudio } from "./captura";
import { iniciarCapturaAntecipada, type CapturaAntecipada } from "./capturaAntecipada";
import type { EventosTranscricao, SessaoTranscricao } from "./tipos";
import { normalizarTermos, TERMOS_RECRUTAMENTO } from "./vocabulario";
import { criarDetectorDeFala, trechoPlausivel } from "../presenca/transcricao";
import { energiaPcm16 } from "./energia";

export { energiaPcm16 } from "./energia";

/** Igual ao vadSilenceThresholdSecs (0,9 s, como nas salas): voz mais recente que isso, quando um trecho é confirmado, já é do próximo. */
const JANELA_DO_PROXIMO_TRECHO_MS = 900;

export async function iniciarScribe({ token, termos, stream, signal, eventos, captura: antecipada }: {
  token: string;
  /** Vocabulário extra (palavras do título da vaga), somado à lista fixa de recrutamento técnico. */
  termos?: readonly string[];
  stream?: MediaStream | null;
  signal: AbortSignal;
  eventos: EventosTranscricao;
  /** Captura já iniciada pelo chamador (no clique, antes do token): o áudio guardado vai quando a sessão abrir. */
  captura?: CapturaAntecipada;
}, dependencias = { conectar: Scribe.connect, capturar: capturarAudio }): Promise<SessaoTranscricao> {
  if (signal.aborted) { antecipada?.cancelar(); signal.throwIfAborted(); }
  // A captura começa antes da sessão do Scribe abrir; o áudio espera no buffer e sai todo no SESSION_STARTED.
  const captura = antecipada ?? iniciarCapturaAntecipada({ stream, capturar: dependencias.capturar });
  const conexao = (() => {
    try {
      return dependencias.conectar({
        token,
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
    } catch (erro) {
      captura.cancelar();
      throw erro;
    }
  })();
  let encerrada = false;
  let parando = false;
  let confirmar: (() => void) | undefined;
  let rejeitarInicio: ((erro: Error) => void) | undefined;
  let parada: Promise<void> | undefined;
  let enviouAudio = false;
  let bytesEnviados = 0;
  /** Voz (ms) que o microfone captou desde o último trecho confirmado: o mesmo portão das salas. */
  let vozNoTrecho = 0;
  /** Últimos blocos enviados (duração e se tinham voz), cobrindo ao menos JANELA_DO_PROXIMO_TRECHO_MS. */
  const recentes: { ms: number; voz: boolean }[] = [];
  const detector = criarDetectorDeFala();

  function encerrar() {
    if (encerrada) return;
    encerrada = true;
    signal.removeEventListener("abort", cancelar);
    captura.cancelar();
    conexao.close();
    confirmar?.();
    eventos.aoParcial("");
    eventos.aoEncerrar();
  }
  function cancelar() {
    rejeitarInicio?.(new DOMException("Transcrição cancelada", "AbortError"));
    encerrar();
  }
  function falhar(erro: Error) {
    if (encerrada) return;
    rejeitarInicio?.(erro);
    eventos.aoErro(erro);
    encerrar();
  }
  signal.addEventListener("abort", cancelar, { once: true });
  conexao.on(RealtimeEvents.PARTIAL_TRANSCRIPT, ({ text }) => {
    if (!encerrada) eventos.aoParcial(text);
  });
  conexao.on(RealtimeEvents.COMMITTED_TRANSCRIPT, ({ text }) => {
    if (encerrada) return;
    eventos.aoParcial("");
    const texto = text.trim();
    // Sem voz no microfone, ou voz curta demais para o tamanho do texto: frase inventada pelo Scribe.
    if (texto && trechoPlausivel(texto, vozNoTrecho)) eventos.aoTexto(texto);
    else if (texto) console.info("[transcrição] descartada (voz insuficiente para o texto)", { vozMs: Math.round(vozNoTrecho), texto });
    // O VAD só confirma depois de 0,9 s de silêncio: voz no último segundo enviado já é do trecho seguinte (o commit
    // pode chegar depois de o próximo áudio sair). Zerar aqui descartaria esse trecho como inventado.
    vozNoTrecho = recentes.reduce((soma, b) => soma + (b.voz ? b.ms : 0), 0);
    if (parando) confirmar?.();
  });
  conexao.on(RealtimeEvents.ERROR, (evento) => {
    if (parando && evento.message_type === "insufficient_audio_activity") {
      confirmar?.();
      return;
    }
    falhar(new Error("A transcrição de voz falhou. Confira a conexão e a configuração da ElevenLabs."));
  });
  conexao.on(RealtimeEvents.CLOSE, () => {
    if (!encerrada) falhar(new Error("A conexão da transcrição foi interrompida. Tente novamente."));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("A transcrição demorou para conectar. Tente novamente.")), 10000);
      rejeitarInicio = (erro) => { clearTimeout(timer); reject(erro); };
      conexao.on(RealtimeEvents.SESSION_STARTED, () => {
        clearTimeout(timer);
        rejeitarInicio = undefined;
        resolve();
      });
    });
    signal.throwIfAborted();
    await captura.pronta;
    signal.throwIfAborted();
    if (encerrada) throw new Error("A transcrição foi interrompida.");
    captura.ligar((audioBase64) => {
      if (encerrada) return;
      const { energia, duracaoMs } = energiaPcm16(audioBase64);
      const { voz } = detector.medir(energia, duracaoMs, vozNoTrecho > 0);
      if (voz) vozNoTrecho += duracaoMs;
      recentes.push({ ms: duracaoMs, voz });
      let total = recentes.reduce((soma, b) => soma + b.ms, 0);
      while (recentes.length > 1 && total - recentes[0].ms >= JANELA_DO_PROXIMO_TRECHO_MS) total -= recentes.shift()!.ms;
      try {
        conexao.send({ audioBase64 });
        bytesEnviados += atob(audioBase64).length;
        enviouAudio = true;
        eventos.aoEnergia?.(energia);
      } catch { falhar(new Error("Não consegui enviar o áudio. Tente novamente.")); }
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
        // Um commit por silêncio pode chegar depois que o próximo áudio já foi enviado.
        // Sempre drena o fim da captura, mesmo se um segmento acabou de ser confirmado.
        if (!enviouAudio) { encerrar(); return; }
        // O modelo começa a processar após ~2 s de áudio. Completa falas curtas
        // (como "sim") com silêncio para que o primeiro commit possa ser reconhecido.
        if (bytesEnviados < 64000) {
          try {
            conexao.send({ audioBase64: btoa("\0".repeat(64000 - bytesEnviados)) });
          } catch { falhar(new Error("Não consegui finalizar o áudio. Tente novamente.")); return; }
        }
        parando = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>((resolve) => {
          confirmar = resolve;
          timer = setTimeout(() => {
            eventos.aoErro(new Error("Não recebi o fim da transcrição. Confira o texto antes de enviar."));
            resolve();
          }, 4000);
          try { conexao.commit(); } catch { resolve(); }
        });
        clearTimeout(timer);
        encerrar();
      })();
      return parada;
    },
  };
}
