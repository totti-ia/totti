import assert from "node:assert/strict";
import { test } from "node:test";
import { acrescentarFala, erroMicrofone, type EventosTranscricao } from "./tipos";
import { iniciarNavegador, type ConstrutorReconhecimento } from "./navegador";
import { energiaPcm16, iniciarScribe } from "./scribe";
import { iniciarCapturaAntecipada } from "./capturaAntecipada";
import { RealtimeEvents, type RealtimeConnection } from "@elevenlabs/client";

const VOZ_BASE64 = (() => {
  let binario = "";
  for (let i = 0; i < 8000; i++) {
    const valor = (i % 2 ? 8000 : -8000) & 0xffff;
    binario += String.fromCharCode(valor & 0xff, valor >> 8);
  }
  return btoa(binario);
})();

function coletar() {
  const textos: string[] = [];
  const parciais: string[] = [];
  const erros: string[] = [];
  let encerramentos = 0;
  const eventos: EventosTranscricao = {
    aoTexto: (texto) => textos.push(texto),
    aoParcial: (texto) => parciais.push(texto),
    aoErro: (erro) => erros.push(erro.message),
    aoEncerrar: () => { encerramentos++; },
  };
  return { eventos, textos, parciais, erros, get encerramentos() { return encerramentos; } };
}

class ReconhecimentoFalso {
  static atual: ReconhecimentoFalso;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: InstanceType<ConstrutorReconhecimento>["onresult"] = null;
  onerror: ((evento: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  abortado = false;
  parou = false;
  constructor() { ReconhecimentoFalso.atual = this; }
  start() {}
  stop() { this.parou = true; }
  abort() { this.abortado = true; }
  resultado(textos: [string, boolean][], resultIndex = 0) {
    this.onresult?.({ resultIndex, results: textos.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal })) });
  }
}

test("ditado preserva texto existente e separa falas com espaço", () => {
  assert.equal(acrescentarFala("Preciso de alguém.\n", " Com experiência em Python. "), "Preciso de alguém. Com experiência em Python.");
  assert.equal(acrescentarFala("", " Olá. "), "Olá.");
});

test("navegador separa parciais e confirma cada índice uma única vez", () => {
  const c = coletar();
  const sessao = iniciarNavegador(ReconhecimentoFalso, c.eventos);
  const r = ReconhecimentoFalso.atual;
  assert.equal(r.lang, "pt-BR");
  r.resultado([["Quero", false]]);
  assert.deepEqual(c.textos, []);
  r.resultado([["Quero Python.", true], ["e", false]]);
  r.resultado([["Quero Python.", true], ["e React.", true]]);
  r.resultado([["Quero Python.", true], ["e React.", true]]);
  assert.deepEqual(c.textos, ["Quero Python.", "e React."]);
  assert.ok(c.parciais.includes("e"));
  sessao.cancelar();
});

test("parar espera a última fala do navegador; cancelar ignora callbacks atrasados", async () => {
  const c = coletar();
  const sessao = iniciarNavegador(ReconhecimentoFalso, c.eventos);
  const r = ReconhecimentoFalso.atual;
  let terminou = false;
  const parada = sessao.parar().then(() => { terminou = true; });
  await Promise.resolve();
  assert.equal(terminou, false);
  assert.equal(r.parou, true);
  r.resultado([["Última palavra.", true]]);
  r.onend?.();
  await parada;
  assert.deepEqual(c.textos, ["Última palavra."]);
  assert.equal(c.encerramentos, 1);

  const outra = iniciarNavegador(ReconhecimentoFalso, c.eventos);
  const antigo = ReconhecimentoFalso.atual.onresult;
  outra.cancelar();
  antigo?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "descartar" } }] });
  assert.equal(c.textos.length, 1);
  assert.equal(ReconhecimentoFalso.atual.abortado, true);
});

test("permissão negada encerra a captura e permite uma nova tentativa", () => {
  const c = coletar();
  iniciarNavegador(ReconhecimentoFalso, c.eventos);
  ReconhecimentoFalso.atual.onerror?.({ error: "not-allowed" });
  assert.match(c.erros[0], /Permita/);
  assert.equal(c.encerramentos, 1);
  assert.equal(ReconhecimentoFalso.atual.abortado, true);
  assert.match(erroMicrofone(new DOMException("denied", "NotAllowedError")).message, /Permita/);
});

function scribeFalso({ sessaoManual = false } = {}) {
  let opcoesConexao: { keyterms?: string[] } | undefined;
  const enviados: string[] = [];
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  let fechado = false;
  let capturaCancelada = false;
  let capturaParada = false;
  let signalCaptura: AbortSignal | undefined;
  let enviarAudio: ((audio: string) => void) | undefined;
  let commits = 0;
  let bytesEnviados = 0;
  const emit = (evento: RealtimeEvents, data: unknown = undefined) => listeners.get(evento)?.forEach((cb) => cb(data));
  const conexao = {
    on: (evento: string, cb: (data: unknown) => void) => listeners.set(evento, [...(listeners.get(evento) ?? []), cb]),
    close: () => { fechado = true; emit(RealtimeEvents.CLOSE); },
    send: ({ audioBase64 }: { audioBase64: string }) => { enviados.push(audioBase64); bytesEnviados += atob(audioBase64).length; },
    commit: () => { commits++; },
  } as unknown as RealtimeConnection;
  const dependencias: Parameters<typeof iniciarScribe>[1] = {
    conectar: (opcoes) => {
      opcoesConexao = opcoes as { keyterms?: string[] };
      if (!sessaoManual) queueMicrotask(() => emit(RealtimeEvents.SESSION_STARTED, {}));
      return conexao;
    },
    capturar: async ({ aoAudio, signal }) => {
      signalCaptura = signal;
      enviarAudio = aoAudio;
      return {
        cancelar: () => { capturaCancelada = true; },
        parar: async () => { capturaParada = true; },
      };
    },
  };
  return {
    dependencias, emit,
    /** 0,5 s de voz (PCM 16 bits, amplitude ~0,25): passa pelo portão de voz da pré-entrevista. */
    audio: () => enviarAudio?.(VOZ_BASE64),
    silencio: () => enviarAudio?.("AAAA"),
    get fechado() { return fechado; },
    get capturaCancelada() { return capturaCancelada; },
    get capturaParada() { return capturaParada; },
    get signalCaptura() { return signalCaptura; },
    get commits() { return commits; },
    get bytesEnviados() { return bytesEnviados; },
    get enviados() { return enviados; },
    get opcoesConexao() { return opcoesConexao; },
  };
}

test("Scribe faz commit e mantém a última fala ao parar", async () => {
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: c.eventos }, falso.dependencias);
  falso.audio();
  falso.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, { text: "Fala final" });
  assert.deepEqual(c.textos, []);
  const parada = sessao.parar();
  await Promise.resolve();
  assert.equal(falso.capturaParada, true);
  assert.equal(falso.fechado, false);
  assert.equal(falso.commits, 1);
  assert.equal(falso.bytesEnviados, 64000); // completa 2 s sem apagar uma fala curta
  falso.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, { text: "Fala final." });
  await parada;
  assert.deepEqual(c.textos, ["Fala final."]);
  assert.equal(falso.fechado, true);
  assert.equal(falso.capturaCancelada, true);
  assert.equal(c.encerramentos, 1);
});

test("Scribe cancela recursos e não publica transcrições depois do abort", async () => {
  const c = coletar();
  const falso = scribeFalso();
  const controlador = new AbortController();
  await iniciarScribe({ token: "teste", signal: controlador.signal, eventos: c.eventos }, falso.dependencias);
  controlador.abort();
  falso.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, { text: "descartar" });
  assert.deepEqual(c.textos, []);
  assert.equal(falso.fechado, true);
  assert.equal(falso.signalCaptura?.aborted, true);
  assert.equal(c.encerramentos, 1);
});

test("commit anterior não dispensa a finalização do áudio seguinte", async () => {
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: c.eventos }, falso.dependencias);
  falso.audio();
  falso.audio();
  falso.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, { text: "Primeiro segmento." });
  const parada = sessao.parar();
  await Promise.resolve();
  assert.equal(falso.commits, 1);
  assert.equal(falso.fechado, false);
  falso.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, { text: "Segundo segmento." });
  await parada;
  assert.deepEqual(c.textos, ["Primeiro segmento.", "Segundo segmento."]);
});

test("Scribe informa queda de conexão e solta o microfone", async () => {
  const c = coletar();
  const falso = scribeFalso();
  await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: c.eventos }, falso.dependencias);
  falso.emit(RealtimeEvents.CLOSE);
  assert.equal(c.erros.length, 1);
  assert.equal(falso.capturaCancelada, true);
  assert.equal(c.encerramentos, 1);
});

test("o áudio de antes da sessão abrir é guardado e enviado em ordem: a primeira palavra não se perde", async () => {
  const c = coletar();
  const falso = scribeFalso({ sessaoManual: true });
  const inicio = iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: c.eventos }, falso.dependencias);
  await new Promise((r) => setImmediate(r));
  // A captura já está aberta enquanto o socket conecta: a pessoa começa a responder.
  falso.audio();
  falso.silencio();
  assert.equal(falso.enviados.length, 0, "nada sai antes do SESSION_STARTED");
  falso.emit(RealtimeEvents.SESSION_STARTED, {});
  const sessao = await inicio;
  assert.deepEqual(falso.enviados, [VOZ_BASE64, "AAAA"]);
  falso.audio();
  assert.equal(falso.enviados.length, 3, "depois de ligar, o áudio vai direto");
  sessao.cancelar();
});

test("captura antecipada pelo chamador é a mesma usada pela sessão", async () => {
  const c = coletar();
  const falso = scribeFalso();
  const captura = iniciarCapturaAntecipada({ capturar: falso.dependencias.capturar });
  await new Promise((r) => setImmediate(r));
  falso.audio(); // falou antes de o token chegar
  const sessao = await iniciarScribe({ token: "teste", captura, signal: new AbortController().signal, eventos: c.eventos }, falso.dependencias);
  assert.deepEqual(falso.enviados, [VOZ_BASE64]);
  sessao.cancelar();
  assert.equal(falso.capturaCancelada, true);
});

test("buffer antecipado guarda no máximo o limite e descarta o mais antigo", async () => {
  let aoAudio: ((b: string) => void) | undefined;
  const captura = iniciarCapturaAntecipada({
    maximoBytes: 6,
    capturar: async (o) => { aoAudio = o.aoAudio; return { cancelar() {}, parar: async () => {} }; },
  });
  await captura.pronta;
  for (const b of ["AAAA", "AQEB", "AgIC"]) aoAudio?.(b); // 3 bytes cada
  const recebidos: string[] = [];
  captura.ligar((b) => recebidos.push(b));
  assert.deepEqual(recebidos, ["AQEB", "AgIC"]);
});

test("pré-entrevista: frase sem voz no microfone (ruído) não vira texto", async () => {
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: c.eventos }, falso.dependencias);
  falso.silencio();
  falso.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, { text: "Tchau. Até mais, Fábio." });
  assert.deepEqual(c.textos, []);
  falso.audio();
  falso.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, { text: "Pode ir direto pra solução." });
  assert.deepEqual(c.textos, ["Pode ir direto pra solução."]);
  sessao.cancelar();
});

test("pré-entrevista manda o vocabulário de recrutamento e o do título como keyterms", async () => {
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", termos: ["Pagamentos"], signal: new AbortController().signal, eventos: c.eventos }, falso.dependencias);
  const termos = falso.opcoesConexao?.keyterms ?? [];
  assert.ok(termos.includes("live coding") && termos.includes("system design") && termos.includes("Pagamentos"));
  assert.ok(termos.length <= 50 && termos.every((t) => t.length <= 20));
  sessao.cancelar();
});

test("Scribe informa a energia RMS de cada bloco enviado (o fim do turno usa)", async () => {
  const energias: number[] = [];
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({
    token: "teste", signal: new AbortController().signal,
    eventos: { ...c.eventos, aoEnergia: (energia) => energias.push(energia) },
  }, falso.dependencias);
  falso.audio();
  falso.silencio();
  assert.equal(energias.length, 2);
  assert.ok(Math.abs(energias[0] - 8000 / 32768) < 1e-6);
  assert.equal(energias[1], 0);
  sessao.cancelar();
});

test("energiaPcm16 mede a voz do bloco e a duração em 16 kHz", () => {
  const { energia, duracaoMs } = energiaPcm16(VOZ_BASE64);
  assert.ok(Math.abs(energia - 8000 / 32768) < 1e-6);
  assert.equal(duracaoMs, 500);
  assert.equal(energiaPcm16("AAAA").energia, 0);
});
