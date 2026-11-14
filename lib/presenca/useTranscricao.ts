"use client";

import { useEffect, useRef, useState } from "react";
import { ErroTokenTranscricao, tokenTranscricao, type CredencialTranscricao } from "./tokenTranscricao";
import {
  atualizarTranscricao, criarDetectorDeFala, criarFilaDeAmostras, criarPortaoDeVoz, esperaParaReconectar, estadoInicialTranscricao,
  energiaRms, mensagemDeAudio, misturarMono, reamostrar, silencioParaCompletar, trechoPlausivel, urlDoScribe, VOZ_MINIMA_MS,
  AMOSTRAS_MINIMAS_TRECHO, AMOSTRAS_MANTER_VIVO, COMMIT_DE_SEGURANCA_MS, COMMIT_TRECHO_CURTO_MS, MANTER_VIVO_MS, MAXIMO_PENDENTE,
  type EstadoReamostragem, type TrechoTranscrito,
} from "./transcricao";
import { AMOSTRAS_ANTES_DO_DISPARO, criarRegraDeInterrupcao, type OpcoesRegra } from "../voz/detectorDeInterrupcao";

export type { TrechoTranscrito } from "./transcricao";

/**
 * Interrupção pela voz nas salas (#97): enquanto a escuta está pausada porque o Totti fala, ela mede o microfone
 * (sem mandar nada ao Scribe) com a mesma regra da pré-entrevista. Ao disparar, chama `aoInterromper`; quando a sala
 * reativa a escuta, os ~600 ms anteriores ao disparo vão primeiro, e a primeira palavra do candidato não se perde.
 */
export type InterrupcaoPelaVoz = {
  /** Pode interromper agora (o Totti está falando e a fala não é a despedida). */
  ativa: () => boolean;
  aoInterromper: () => void;
  regra?: OpcoesRegra;
};

/** Tempo de pausa (sem poder ouvir) com o socket aberto antes de fechá-lo. */
const PAUSA_MAXIMA_MS = 30_000;
/** Acima disso no buffer do socket, a rede não está escoando: reconecta. */
const SOCKET_SATURADO = 262_144;
/**
 * Uma rajada (o que esperava a conexão) para de enviar acima disso e segue no próximo bloco ou tique: o
 * bufferedAmount só baixa entre tarefas, então mandar tudo de uma vez passaria de SOCKET_SATURADO sozinho.
 */
const LIMITE_RAJADA = 65_536;
export type EstadoEscuta = { motor: "elevenlabs" | "navegador" | "nenhum"; escutando: boolean; erro: string | null };
/** Uso do Scribe por sessão de escuta: o que é cobrado (áudio enviado) contra o tempo de sessão. */
export type UsoTranscricao = { audioEnviadoS: number; sessaoS: number; conexoes: number; reconexoes: number };

// Tipos locais: a Web Speech API ainda não integra todas as versões de lib.dom.
type ResultadoNativo = { isFinal: boolean; 0: { transcript: string } };
type EventoResultado = { resultIndex: number; results: { length: number; [indice: number]: ResultadoNativo } };
type Reconhecimento = {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((evento: { error: string }) => void) | null;
  onresult: ((evento: EventoResultado) => void) | null;
  start(trilha?: MediaStreamTrack): void; abort(): void;
};
type JanelaDeVoz = Window & {
  AudioContext?: typeof AudioContext;
  SpeechRecognition?: new () => Reconhecimento;
  webkitSpeechRecognition?: new () => Reconhecimento;
  webkitAudioContext?: typeof AudioContext;
};

/** Controlador separado do React para testar pausa, reconexão e liberação de recursos. */
export function criarEscutaTranscricao(opcoes: {
  stream: MediaStream;
  sessaoId: string | null;
  servidor: boolean;
  aoEstado: (estado: EstadoEscuta) => void;
  aoTrecho?: (trecho: TrechoTranscrito) => void;
  /** Token do Scribe; o servidor pode mandar junto o vocabulário da sessão (keyterms). */
  obterToken?: (sessaoId: string) => Promise<string | CredencialTranscricao>;
  interrupcao?: InterrupcaoPelaVoz;
}): { ativar(ativo: boolean): void; parar(): void; uso(): UsoTranscricao } {
  const trilha = opcoes.stream.getAudioTracks()[0];
  const janela = typeof window === "undefined" ? undefined : window as JanelaDeVoz;
  let inicio: number | null = null;
  let estado: EstadoEscuta = { motor: "nenhum", escutando: false, erro: null };
  let texto = estadoInicialTranscricao();
  let ativo = false;
  let ouvindoAntes = false;
  let pausadoDesde: number | null = null;
  let encerrado = false;
  let geracao = 0;
  let tentativas = 0;
  let conectadoEm = 0;
  let conectando = false;
  let conexoes = 0;
  let pronto = false;
  let segmento = 0;
  /** Quanto de voz (ms) o microfone captou desde o último trecho fechado. */
  let vozNoTrecho = 0;
  /** Amostras (16 kHz) que o portão deixou passar desde que abriu: trecho curto é completado com silêncio. */
  let amostrasNoTrecho = 0;
  let socket: WebSocket | null = null;
  let contexto: AudioContext | null = null;
  let fonte: MediaStreamAudioSourceNode | null = null;
  let processador: ScriptProcessorNode | null = null;
  let ganho: GainNode | null = null;
  let reamostragem: EstadoReamostragem = { soma: 0, peso: 0 };
  const pendentes = criarFilaDeAmostras(MAXIMO_PENDENTE);
  /** Voz enviada que o Scribe ainda não confirmou com committed_transcript. */
  let vozSemCommit = false;
  let commitDeSeguranca: ReturnType<typeof setTimeout> | null = null;
  const portao = criarPortaoDeVoz();
  const detector = criarDetectorDeFala();
  let ultimoEnvio = 0;
  let amostrasEnviadas = 0;
  let fimDaSessao: number | null = null;
  let repetir: ReturnType<typeof setTimeout> | null = null;
  let prazo: ReturnType<typeof setTimeout> | null = null;
  let reconhecimento: Reconhecimento | null = null;
  let reconhecendo = false;
  let iniciando = false;
  let rodada = 0;
  let falhasNavegador = 0;
  let navegadorBloqueado = false;
  let aceitaTrilha = true;
  /** Vigília da interrupção (escuta pausada pelo Totti falando): regra, últimas amostras e se já disparou. */
  const regraDeInterrupcao = criarRegraDeInterrupcao(opcoes.interrupcao?.regra);
  let reamostragemVigia: EstadoReamostragem = { soma: 0, peso: 0 };
  let antesDoDisparo = new Float32Array(0);
  let disparou = false;
  /** A sala dizia, no bloco anterior, que dava para interromper: cada fala nova do Totti recalibra a regra. */
  let vigiaAtiva = false;

  const microfoneAberto = () => (typeof document === "undefined" || !document.hidden)
    && !!trilha && trilha.readyState === "live" && trilha.enabled && !trilha.muted;
  const podeOuvir = () => ativo && microfoneAberto();
  /** Começa uma vigília nova (o Totti começou a falar): mede o vazamento de novo e esquece o áudio guardado. */
  function reiniciarVigia() {
    regraDeInterrupcao.reiniciar();
    reamostragemVigia = { soma: 0, peso: 0 };
    antesDoDisparo = new Float32Array(0);
    disparou = false;
    vigiaAtiva = false;
  }
  /** Escuta pausada só porque o Totti fala (microfone aberto): mede e guarda, sem mandar nada ao Scribe. */
  function vigiar(amostras: Float32Array, taxa: number) {
    if (ativo || !opcoes.interrupcao || !microfoneAberto()) return;
    const convertido = reamostrar(amostras, taxa, 16000, reamostragemVigia);
    reamostragemVigia = convertido.estado;
    const junto = new Float32Array(antesDoDisparo.length + convertido.amostras.length);
    junto.set(antesDoDisparo);
    junto.set(convertido.amostras, antesDoDisparo.length);
    // Depois do disparo, guarda tudo até a sala reativar a escuta (é a fala do candidato).
    antesDoDisparo = disparou ? junto.slice(Math.max(0, junto.length - MAXIMO_PENDENTE)) : junto.slice(Math.max(0, junto.length - AMOSTRAS_ANTES_DO_DISPARO));
    if (disparou) return;
    const ativa = opcoes.interrupcao.ativa();
    // Uma fala nova do Totti (ou o microfone religado no meio dela): a linha de base é medida de novo.
    if (ativa && !vigiaAtiva) regraDeInterrupcao.reiniciar();
    vigiaAtiva = ativa;
    if (!ativa) return;
    if (regraDeInterrupcao.medir(energiaRms(amostras), (amostras.length / taxa) * 1000)) {
      disparou = true;
      opcoes.interrupcao.aoInterromper();
    }
  }
  /** A escuta voltou depois de uma interrupção: o áudio do disparo entra primeiro, como fala, pelo portão. */
  function retomarDepoisDoDisparo() {
    const antes = antesDoDisparo;
    const retomar = disparou && antes.length > 0;
    reiniciarVigia();
    if (!retomar) return;
    const passou = portao.passar(antes, true);
    amostrasNoTrecho = passou.amostras.length;
    // O disparo pediu ~250 ms seguidos acima do vazamento: é voz, e conta para o trecho não parecer inventado.
    vozNoTrecho += (antes.length / 16000) * 1000;
    pendentes.guardar(passou.amostras);
    vozSemCommit = true;
    cancelarCommitDeSeguranca();
  }
  const agora = () => inicio === null ? 0 : Math.max(0, performance.now() - inicio);
  function publicar(novo: EstadoEscuta) {
    if (encerrado) return;
    if (novo.motor === estado.motor && novo.escutando === estado.escutando && novo.erro === estado.erro) return;
    estado = novo;
    opcoes.aoEstado({ ...estado });
  }
  function limparParcial() {
    if (texto.parcial && !encerrado) opcoes.aoTrecho?.({ texto: "", final: false, inicio: agora() });
    texto = { ...texto, parcial: null };
    vozNoTrecho = 0;
    reamostragem = { soma: 0, peso: 0 };
  }
  /** Descarta o áudio que ainda não saiu e o estado do portão: só quando o socket deixa de existir. */
  function descartarAudio() {
    pendentes.limpar();
    amostrasNoTrecho = 0;
    portao.reiniciar();
    detector.reiniciar();
  }
  function receber(valor: string, final: boolean, chave: string) {
    if (encerrado || !podeOuvir()) return;
    const resultado = atualizarTranscricao(texto, { texto: valor, final, inicio: agora() }, chave);
    texto = resultado.estado;
    if (resultado.trecho) opcoes.aoTrecho?.(resultado.trecho);
  }
  function cancelarRepeticao() {
    if (repetir !== null) clearTimeout(repetir);
    repetir = null;
  }
  function limparSocket() {
    geracao++;
    cancelarCommitDeSeguranca();
    vozSemCommit = false;
    conectando = pronto = false;
    if (prazo !== null) clearTimeout(prazo);
    prazo = null;
    const anterior = socket;
    socket = null;
    if (anterior) {
      anterior.onopen = anterior.onmessage = anterior.onclose = anterior.onerror = null;
      try { anterior.close(); } catch {}
    }
    limparParcial();
    descartarAudio();
  }
  function limparAudio() {
    if (processador) processador.onaudioprocess = null;
    fonte?.disconnect();
    processador?.disconnect();
    ganho?.disconnect();
    if (contexto) void contexto.close().catch(() => {});
    contexto = fonte = processador = ganho = null;
  }
  function falharScribe(definitivo = false) {
    if (encerrado || estado.motor !== "elevenlabs") return;
    if (pronto && performance.now() - conectadoEm >= 10000) tentativas = 0;
    limparSocket();
    const espera = definitivo ? null : esperaParaReconectar(tentativas++);
    if (espera === null) {
      limparAudio();
      usarNavegador("Scribe indisponível; tentando transcrição do navegador.");
      return;
    }
    publicar({ motor: "elevenlabs", escutando: false, erro: `reconectando microfone (${tentativas}/5)` });
    if (podeOuvir()) repetir = setTimeout(() => { repetir = null; void conectarScribe(); }, espera);
  }
  /** Devolve se o bloco saiu; com o socket não aberto (ou fechando) nada é enviado. */
  function enviarAudio(amostras: Float32Array, commit = false): boolean {
    if (!socket || !pronto || socket.readyState !== 1) return false;
    if (socket.bufferedAmount > SOCKET_SATURADO) { falharScribe(); return false; }
    try { socket.send(mensagemDeAudio(amostras, commit)); } catch { falharScribe(); return false; }
    ultimoEnvio = performance.now();
    amostrasEnviadas += amostras.length;
    return true;
  }
  function cancelarCommitDeSeguranca() {
    if (commitDeSeguranca !== null) clearTimeout(commitDeSeguranca);
    commitDeSeguranca = null;
  }
  function agendarCommitDeSeguranca(esperaMs = COMMIT_DE_SEGURANCA_MS) {
    cancelarCommitDeSeguranca();
    if (!vozSemCommit) return;
    commitDeSeguranca = setTimeout(() => {
      commitDeSeguranca = null;
      // Portão aberto: uma fala nova começou, e o fechamento dela agenda o próximo commit.
      if (!vozSemCommit || portao.aberto) return;
      // Ainda há áudio do trecho na fila (rajada ou socket conectando): tenta escoar e confere de novo depois.
      if (pendentes.length) {
        escoar(true);
        agendarCommitDeSeguranca();
        return;
      }
      if (enviarAudio(new Float32Array(AMOSTRAS_MANTER_VIVO), true)) vozSemCommit = false;
      else agendarCommitDeSeguranca();
    }, esperaMs);
  }
  /**
   * O portão fechou: trecho curto ganha o silêncio que falta para o Scribe processá-lo e um commit mais cedo; os
   * outros esperam o VAD e, se ele não confirmar, o commit de segurança.
   */
  function fecharTrecho() {
    // Se o VAD já confirmou o trecho na folga, completar só gastaria áudio cobrado.
    const curto = vozSemCommit && amostrasNoTrecho < AMOSTRAS_MINIMAS_TRECHO;
    if (curto) pendentes.guardar(silencioParaCompletar(amostrasNoTrecho));
    amostrasNoTrecho = 0;
    escoar(true);
    agendarCommitDeSeguranca(curto ? COMMIT_TRECHO_CURTO_MS : COMMIT_DE_SEGURANCA_MS);
  }
  /** Envia o que o portão deixou passar em blocos de 200 ms; `tudo` manda também o resto menor que um bloco. */
  function escoar(tudo: boolean) {
    if (!pronto || !socket || !pendentes.length) return;
    if (socket.bufferedAmount > SOCKET_SATURADO) { falharScribe(); return; }
    while (pronto && socket && socket.bufferedAmount <= LIMITE_RAJADA && pendentes.length
      && (tudo || pendentes.length >= 3200)) {
      const bloco = pendentes.tirar(3200);
      if (!enviarAudio(bloco)) {
        // Saturado: falharScribe já limpou a fila. Socket não aberto: o bloco volta e espera.
        if (pronto) pendentes.devolver(bloco);
        return;
      }
    }
  }
  /** Parou de poder ouvir no meio de uma fala: completa a folga com silêncio para o Scribe fechar o trecho. */
  function fecharTrechoAberto() {
    if (!portao.aberto) return;
    const folga = portao.encerrar();
    amostrasNoTrecho += folga.length;
    pendentes.guardar(folga);
    fecharTrecho();
  }
  async function prepararAudio() {
    if (!contexto) {
      const Construtor = janela?.AudioContext ?? janela?.webkitAudioContext;
      if (!Construtor) throw new Error("Web Audio indisponível.");
      contexto = new Construtor();
      fonte = contexto.createMediaStreamSource(opcoes.stream);
      processador = contexto.createScriptProcessor(4096, 1, 1);
      ganho = contexto.createGain();
      ganho.gain.value = 0;
      processador.onaudioprocess = (evento) => {
        evento.outputBuffer.getChannelData(0).fill(0);
        if (encerrado || !contexto) return;
        const canais = Array.from({ length: evento.inputBuffer.numberOfChannels }, (_, i) => evento.inputBuffer.getChannelData(i));
        const amostras = misturarMono(canais);
        // Sem poder ouvir (Totti falando, mudo, aba escondida) o microfone não vai ao Scribe: o tempo enviado é
        // cobrado. Só o bloco curto que mantém a conexão (o Scribe fecha após 15 s sem mensagens) continua. Com o
        // Totti falando, a vigília da interrupção mede o microfone, mesmo com o socket fechado pela pausa longa.
        if (!podeOuvir()) {
          vigiar(amostras, contexto.sampleRate);
          if (socket || conectando) fecharTrechoAberto();
          return;
        }
        // Enquanto conecta (token e handshake) o áudio também passa pelo portão e espera em `pendentes`.
        if (!socket && !conectando) return;
        const duracaoMs = (amostras.length / contexto.sampleRate) * 1000;
        // Aberto, o portão segue com fala mais baixa (fim de frase dito baixo) por um tempo limitado depois da
        // última voz, para ruído constante não o manter aberto; abrir pede LIMIAR_VOZ_RMS.
        const { voz, fala } = detector.medir(energiaRms(amostras), duracaoMs, portao.aberto);
        if (voz) vozNoTrecho += duracaoMs;
        const convertido = reamostrar(amostras, contexto.sampleRate, 16000, reamostragem);
        reamostragem = convertido.estado;
        const passou = portao.passar(convertido.amostras, fala);
        amostrasNoTrecho = (passou.abriu ? 0 : amostrasNoTrecho) + passou.amostras.length;
        pendentes.guardar(passou.amostras);
        if (fala) { vozSemCommit = true; cancelarCommitDeSeguranca(); }
        // Enquanto o socket conecta, o áudio espera em `pendentes` e sai todo no session_started.
        if (passou.fechou) fecharTrecho();
        else escoar(false);
      };
      fonte.connect(processador);
      processador.connect(ganho);
      ganho.connect(contexto.destination);
    }
    if (contexto.state === "suspended") await contexto.resume();
  }
  async function conectarScribe() {
    if (encerrado || conectando || socket || !podeOuvir() || !opcoes.sessaoId) return;
    conectando = true;
    const atual = ++geracao;
    prazo = setTimeout(() => { if (atual === geracao) falharScribe(); }, 10000);
    try {
      try { await prepararAudio(); } catch {
        if (!encerrado && atual === geracao) falharScribe(true);
        return;
      }
      if (encerrado || atual !== geracao) return;
      let credencial: CredencialTranscricao;
      try {
        const resposta = await (opcoes.obterToken ?? tokenTranscricao)(opcoes.sessaoId);
        credencial = typeof resposta === "string" ? { token: resposta, termos: [] } : resposta;
      } catch (erro) {
        // Sem chave, sessão inexistente ou encerrada: repetir não resolve, vai direto ao navegador.
        if (!encerrado && atual === geracao) falharScribe(erro instanceof ErroTokenTranscricao && erro.permanente);
        return;
      }
      if (encerrado || atual !== geracao) return;
      const ws = new WebSocket(urlDoScribe(credencial.token, credencial.termos));
      conexoes++;
      socket = ws;
      ws.onmessage = (evento) => {
        if (encerrado || atual !== geracao) return;
        let mensagem: unknown;
        try { mensagem = JSON.parse(String(evento.data)); } catch { falharScribe(); return; }
        if (!mensagem || typeof mensagem !== "object") return;
        const m = mensagem as { message_type?: string; text?: unknown; error?: unknown };
        if (m.message_type === "session_started") {
          if (prazo !== null) clearTimeout(prazo);
          prazo = null;
          pronto = true;
          conectando = false;
          conectadoEm = ultimoEnvio = performance.now();
          publicar({ motor: "elevenlabs", escutando: podeOuvir(), erro: null });
          escoar(!portao.aberto);
        } else if (m.message_type === "partial_transcript" && typeof m.text === "string") {
          // Sem voz no microfone, o parcial é alucinação: não mostra nem segura o turno do agente.
          if (vozNoTrecho >= VOZ_MINIMA_MS) receber(m.text, false, `${atual}:${segmento}`);
        } else if (m.message_type === "committed_transcript" && typeof m.text === "string") {
          // Commit vazio (resposta ao commit de segurança, às vezes atrasada) não fecha trecho nenhum. Tratado como
          // trecho, ele zerava a voz e gastava a chave da frase seguinte, que já estava sendo dita: ela era
          // descartada como alucinação ou como repetida (visto no Scribe real).
          if (m.text.trim()) {
            // Sem voz no microfone, ou voz curta demais para o tamanho do texto: é frase inventada pelo Scribe.
            if (trechoPlausivel(m.text, vozNoTrecho)) receber(m.text, true, `${atual}:${segmento}`);
            else {
              console.info("[transcrição] descartada (voz insuficiente para o texto)", { vozMs: Math.round(vozNoTrecho), texto: m.text });
              if (texto.parcial) opcoes.aoTrecho?.({ texto: "", final: false, inicio: agora() });
              texto = { ...texto, parcial: null };
            }
            segmento++;
            vozNoTrecho = 0;
          }
          vozSemCommit = false;
          cancelarCommitDeSeguranca();
        } else if (typeof m.error === "string") {
          falharScribe(["quota_exceeded", "unaccepted_terms", "input_error", "invalid_request", "chunk_size_exceeded"].includes(m.message_type ?? ""));
        }
      };
      ws.onerror = ws.onclose = () => { if (atual === geracao) falharScribe(); };
    } catch {
      if (!encerrado && atual === geracao) falharScribe();
    }
  }
  function agendarNavegador(erro = false) {
    if (encerrado || !podeOuvir() || navegadorBloqueado || repetir !== null) return;
    const espera = erro ? esperaParaReconectar(falhasNavegador++) : 250;
    if (espera === null) {
      navegadorBloqueado = true;
      publicar({ motor: "nenhum", escutando: false, erro: "Não foi possível reiniciar a transcrição do navegador." });
      return;
    }
    if (erro) publicar({ motor: "navegador", escutando: false, erro: "reconectando microfone" });
    repetir = setTimeout(() => { repetir = null; iniciarNavegador(); }, espera);
  }
  function iniciarNavegador() {
    if (encerrado || !podeOuvir() || !reconhecimento || reconhecendo || iniciando || navegadorBloqueado) return;
    iniciando = true;
    rodada++;
    try {
      if (aceitaTrilha) reconhecimento.start(trilha);
      else reconhecimento.start();
    } catch (erro) {
      iniciando = false;
      if (aceitaTrilha && erro instanceof TypeError) {
        aceitaTrilha = false;
        iniciarNavegador();
        return;
      }
      agendarNavegador(true);
    }
  }
  function usarNavegador(motivo: string | null = null) {
    cancelarRepeticao();
    const Construtor = janela?.SpeechRecognition ?? janela?.webkitSpeechRecognition;
    if (!Construtor) {
      publicar({ motor: "nenhum", escutando: false, erro: "Transcrição de voz indisponível neste navegador." });
      return;
    }
    try { reconhecimento = new Construtor(); } catch {
      publicar({ motor: "nenhum", escutando: false, erro: "Não foi possível iniciar a transcrição do navegador." });
      return;
    }
    reconhecimento.lang = "pt-BR";
    reconhecimento.continuous = reconhecimento.interimResults = true;
    reconhecimento.onstart = () => {
      iniciando = false;
      reconhecendo = true;
      if (!podeOuvir()) { reconhecendo = false; reconhecimento?.abort(); return; }
      publicar({ motor: "navegador", escutando: true, erro: null });
    };
    reconhecimento.onresult = (evento) => {
      if (encerrado || !podeOuvir()) return;
      const parciais: string[] = [];
      for (let i = 0; i < evento.results.length; i++) {
        const resultado = evento.results[i];
        if (resultado.isFinal && i >= evento.resultIndex) {
          receber(resultado[0].transcript, true, `n:${rodada}:${i}`);
          falhasNavegador = 0;
        } else if (!resultado.isFinal) parciais.push(resultado[0].transcript);
      }
      if (parciais.length) receber(parciais.join(" "), false, `n:${rodada}:${evento.results.length - parciais.length}`);
      else if (texto.parcial) limparParcial();
    };
    reconhecimento.onend = () => {
      iniciando = reconhecendo = false;
      limparParcial();
      publicar({ ...estado, escutando: false });
      agendarNavegador();
    };
    reconhecimento.onerror = (evento) => {
      if (encerrado || !podeOuvir()) return;
      if (["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"].includes(evento.error)) {
        navegadorBloqueado = true;
        publicar({ motor: "nenhum", escutando: false, erro: `Microfone indisponível para transcrição (${evento.error}).` });
      } else agendarNavegador(!["aborted", "no-speech"].includes(evento.error));
      iniciando = reconhecendo = false;
      try { reconhecimento?.abort(); } catch {}
    };
    publicar({ motor: "navegador", escutando: false, erro: motivo });
    if (podeOuvir()) iniciarNavegador();
  }
  function sincronizarAtividade() {
    if (encerrado) return;
    const ouvir = podeOuvir();
    if (!ouvir && ouvindoAntes) {
      // A folga de fechamento e o que a rajada não mandou ficam na fila e saem nos próximos tiques: descartá-los
      // deixaria o trecho sem fechamento no Scribe. O portão volta ao zero para não levar áudio de antes da pausa.
      fecharTrechoAberto();
      portao.reiniciar();
      detector.reiniciar();
      limparParcial();
      cancelarRepeticao();
      if (reconhecimento && (reconhecendo || iniciando)) {
        iniciando = reconhecendo = false;
        try { reconhecimento.abort(); } catch {}
      }
    }
    if (ouvir && !ouvindoAntes) retomarDepoisDoDisparo();
    ouvindoAntes = ouvir;
    pausadoDesde = ouvir ? null : (pausadoDesde ?? performance.now());
    // Pausa longa: fecha o socket em vez de mantê-lo vivo (retomar pede token novo).
    if (!ouvir && socket && pausadoDesde !== null && performance.now() - pausadoDesde >= PAUSA_MAXIMA_MS) limparSocket();
    else if (socket && pronto && pendentes.length) escoar(!portao.aberto);
    else if (socket && pronto && !portao.aberto && performance.now() - ultimoEnvio >= MANTER_VIVO_MS) {
      enviarAudio(new Float32Array(AMOSTRAS_MANTER_VIVO));
    }
    if (estado.motor === "elevenlabs") {
      publicar({ ...estado, escutando: ouvir && pronto });
      if (ouvir && !socket && !conectando && repetir === null) void conectarScribe();
    } else if (estado.motor === "navegador") {
      if (!ouvir) publicar({ ...estado, escutando: false });
      else if (repetir === null) iniciarNavegador();
    }
  }

  if (!trilha || trilha.readyState !== "live") publicar({ motor: "nenhum", escutando: false, erro: "Microfone sem trilha de áudio ativa." });
  else if (opcoes.servidor && opcoes.sessaoId) publicar({ motor: "elevenlabs", escutando: false, erro: null });
  else usarNavegador();
  const monitor = setInterval(sincronizarAtividade, 200);
  const aoEncerrarTrilha = () => {
    publicar({ motor: "nenhum", escutando: false, erro: "Microfone encerrado." });
    parar();
  };
  trilha?.addEventListener("ended", aoEncerrarTrilha);
  function parar() {
    if (encerrado) return;
    encerrado = true;
    fimDaSessao = performance.now();
    clearInterval(monitor);
    cancelarRepeticao();
    limparSocket();
    limparAudio();
    trilha?.removeEventListener("ended", aoEncerrarTrilha);
    if (reconhecimento) {
      reconhecimento.onstart = reconhecimento.onend = reconhecimento.onresult = reconhecimento.onerror = null;
      try { reconhecimento.abort(); } catch {}
    }
    // O stream pertence a useMidiaLocal: suas trilhas nunca são paradas aqui.
  }
  return {
    ativar(valor) {
      if (valor) inicio ??= performance.now();
      // O Totti começou a falar (a sala pausou a escuta): a vigília começa do zero, para esta fala.
      if (!valor && ativo) reiniciarVigia();
      ativo = valor;
      sincronizarAtividade();
    },
    parar,
    uso: () => ({
      audioEnviadoS: amostrasEnviadas / 16000,
      sessaoS: inicio === null ? 0 : Math.max(0, ((fimDaSessao ?? performance.now()) - inicio) / 1000),
      conexoes,
      reconexoes: Math.max(0, conexoes - 1),
    }),
  };
}

export function useTranscricao(opcoes: {
  stream: MediaStream | null;
  ativo: boolean;
  sessaoId: string | null;
  aoParcial?: (texto: string) => void;
  aoFinal?: (texto: string) => void;
  contexto?: "coding" | "quadro";
  servidor?: boolean;
  /** Interrupção pela voz enquanto a escuta está pausada pelo Totti falando (ver InterrupcaoPelaVoz). */
  interrupcao?: { ativa: boolean; aoInterromper: () => void };
}): EstadoEscuta {
  const { stream, ativo, sessaoId, aoParcial, aoFinal } = opcoes;
  const interrupcao = useRef(opcoes.interrupcao);
  interrupcao.current = opcoes.interrupcao;
  const [estado, setEstado] = useState<EstadoEscuta>({ motor: "nenhum", escutando: false, erro: null });
  const callbacks = useRef({ aoParcial, aoFinal });
  const escuta = useRef<ReturnType<typeof criarEscutaTranscricao> | null>(null);
  // Scribe por padrão; "0" (demonstração) usa só a transcrição do navegador.
  const servidor = opcoes.servidor ?? (process.env.NEXT_PUBLIC_USAR_SERVIDOR !== "0");
  const contexto = opcoes.contexto ?? "coding";
  useEffect(() => { callbacks.current = { aoParcial, aoFinal }; }, [aoParcial, aoFinal]);
  useEffect(() => {
    if (!stream) {
      setEstado({ motor: "nenhum", escutando: false, erro: null });
      return;
    }
    const controle = criarEscutaTranscricao({
      stream, sessaoId, servidor, aoEstado: setEstado,
      obterToken: (id) => tokenTranscricao(id, contexto),
      interrupcao: {
        ativa: () => !!interrupcao.current?.ativa,
        aoInterromper: () => interrupcao.current?.aoInterromper(),
      },
      aoTrecho: (trecho) => {
        if (trecho.final) {
          callbacks.current.aoParcial?.("");
          callbacks.current.aoFinal?.(trecho.texto);
        } else callbacks.current.aoParcial?.(trecho.texto);
      },
    });
    escuta.current = controle;
    const escutaId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const enviarUso = (final: boolean) => {
      const uso = controle.uso();
      if (!sessaoId || uso.sessaoS < 1) return;
      const payload = JSON.stringify({ sessao_id: sessaoId, contexto, tipo: "transcricao_uso", dados: {
        contexto, escuta_id: escutaId, audioEnviadoS: uso.audioEnviadoS, sessaoS: uso.sessaoS,
        conexoes: uso.conexoes, reconexoes: uso.reconexoes, final,
      } });
      if (final && typeof navigator !== "undefined" && navigator.sendBeacon) {
        if (navigator.sendBeacon("/api/uso", new Blob([payload], { type: "application/json" }))) return;
      }
      void fetch("/api/uso", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: final }).catch(() => {});
    };
    const intervaloUso = setInterval(() => enviarUso(false), 60_000);
    return () => {
      clearInterval(intervaloUso);
      escuta.current = null;
      controle.parar();
      const uso = controle.uso();
      // Economia do portão de voz nos dados reais: áudio cobrado pelo Scribe contra o tempo de sessão.
      // >= 1 s: a montagem dupla do StrictMode (e trocas imediatas) não vira registro de uso.
      if (uso.sessaoS >= 1) {
        enviarUso(true);
      }
    };
  }, [stream, sessaoId, servidor, contexto]);
  useEffect(() => { escuta.current?.ativar(ativo); }, [ativo, stream, sessaoId, servidor]);
  return estado;
}
