import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
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
/** 100 ms de silêncio em PCM 16 kHz (o tamanho do bloco da captura). */
const SILENCIO_BASE64 = btoa("\0".repeat(3200));

/** Bloco de `ms` em 16 kHz: voz (mesma amplitude de VOZ_BASE64) ou silêncio. */
function bloco(ms: number, voz = true): string {
  let binario = "";
  for (let i = 0; i < ms * 16; i++) {
    const valor = (voz ? (i % 2 ? 8000 : -8000) : 0) & 0xffff;
    binario += String.fromCharCode(valor & 0xff, valor >> 8);
  }
  return btoa(binario);
}

/** Amostras (16 bits) de um bloco base64, como o Scribe recebe. */
function amostrasDe(base64: string): number[] {
  const binario = atob(base64);
  const saida: number[] = [];
  for (let i = 0; i + 1 < binario.length; i += 2) {
    const valor = binario.charCodeAt(i) | (binario.charCodeAt(i + 1) << 8);
    saida.push(valor >= 32768 ? valor - 65536 : valor);
  }
  return saida;
}

const totalAmostras = (enviados: string[]) => enviados.reduce((soma, base64) => soma + amostrasDe(base64).length, 0);

/** Relógio controlado: o de performance (manter viva) e os timers andam juntos. Devolve o avanço. */
function relogio(t: TestContext) {
  let agora = 0;
  t.mock.method(performance, "now", () => agora);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return (ms: number) => { agora += ms; t.mock.timers.tick(ms); };
}

/** Deixa rodar as tarefas assíncronas pendentes (a reconexão espera o token e a sessão entre os timers). */
const andar = () => new Promise<void>((resolver) => setImmediate(resolver));

/** Avança o relógio em passos de 100 ms, deixando a reconexão andar entre eles. */
async function correr(avancar: (ms: number) => void, ms: number) {
  for (let restante = ms; restante > 0; restante -= 100) {
    avancar(Math.min(100, restante));
    await andar();
  }
}

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

/** Uma conexão falsa do Scribe: guarda o que foi enviado e registra os eventos como o SDK. */
class ConexaoFalsa {
  enviados: string[] = [];
  keyterms: string[] | undefined;
  fechado = false;
  commits = 0;
  private listeners = new Map<string, ((data: unknown) => void)[]>();
  on(evento: string, cb: (data: unknown) => void) { this.listeners.set(evento, [...(this.listeners.get(evento) ?? []), cb]); }
  emit(evento: RealtimeEvents, data: unknown = undefined) { this.listeners.get(evento)?.forEach((cb) => cb(data)); }
  close() { this.fechado = true; this.emit(RealtimeEvents.CLOSE); }
  send({ audioBase64 }: { audioBase64: string }) { this.enviados.push(audioBase64); }
  commit() { this.commits++; }
}

/**
 * Scribe falso com uma conexão por `conectar`. Os getters (enviados, commits, fechado, emit) valem para a conexão
 * mais recente, como a sessão atual. `naoAbrir(n)` faz a conexão de índice n nunca iniciar a sessão.
 */
function scribeFalso({ sessaoManual = false, naoAbrir = (_n: number): boolean => false }: { sessaoManual?: boolean; naoAbrir?: (n: number) => boolean } = {}) {
  const conexoes: ConexaoFalsa[] = [];
  const tokens: string[] = [];
  let capturaCancelada = false;
  let capturaParada = false;
  let signalCaptura: AbortSignal | undefined;
  let enviarAudio: ((audio: string) => void) | undefined;
  const atual = () => conexoes[conexoes.length - 1];
  const dependencias: Parameters<typeof iniciarScribe>[1] = {
    conectar: (opcoes) => {
      const c = new ConexaoFalsa();
      c.keyterms = (opcoes as { keyterms?: string[] }).keyterms;
      tokens.push((opcoes as { token: string }).token);
      conexoes.push(c);
      if (!sessaoManual && !naoAbrir(conexoes.length - 1)) queueMicrotask(() => c.emit(RealtimeEvents.SESSION_STARTED, {}));
      return c as unknown as RealtimeConnection;
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
    dependencias, tokens, conexoes,
    emit: (evento: RealtimeEvents, data: unknown = undefined) => atual().emit(evento, data),
    /** 0,5 s de voz (PCM 16 bits, amplitude ~0,25): passa pelo portão de voz da pré-entrevista. */
    audio: () => enviarAudio?.(VOZ_BASE64),
    silencio: () => enviarAudio?.(SILENCIO_BASE64),
    enviar: (base64: string) => enviarAudio?.(base64),
    get fechado() { return atual().fechado; },
    get capturaCancelada() { return capturaCancelada; },
    get capturaParada() { return capturaParada; },
    get signalCaptura() { return signalCaptura; },
    get commits() { return atual().commits; },
    get enviados() { return atual().enviados; },
    get opcoesConexao() { return { keyterms: atual().keyterms }; },
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
  assert.equal(totalAmostras(falso.enviados) * 2, 64000); // completa 2 s sem apagar uma fala curta
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
  assert.deepEqual(falso.enviados, [VOZ_BASE64, SILENCIO_BASE64]);
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

test("portão de voz: silêncio não vai ao Scribe, mas cada bloco informa a energia", async (t) => {
  relogio(t);
  const energias: number[] = [];
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({
    token: "teste", signal: new AbortController().signal,
    eventos: { ...c.eventos, aoEnergia: (energia) => energias.push(energia) },
  }, falso.dependencias);
  for (let i = 0; i < 10; i++) falso.enviar(bloco(100, false));
  assert.equal(falso.enviados.length, 0);
  assert.equal(energias.length, 10);
  assert.ok(energias.every((energia) => energia === 0));
  sessao.cancelar();
});

test("portão de voz: a fala sai com 300 ms de antes, a folga de 1,2 s sai inteira e depois o portão fecha", async (t) => {
  relogio(t);
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: c.eventos }, falso.dependencias);
  falso.enviar(bloco(400, false));
  falso.enviar(bloco(2000, true));
  assert.equal(falso.enviados.length, 1);
  const primeiro = amostrasDe(falso.enviados[0]);
  assert.equal(primeiro.length, 4800 + 32000, "300 ms de antes mais a fala");
  assert.ok(primeiro.slice(0, 4800).every((valor) => valor === 0), "o antes é silêncio");
  falso.enviar(bloco(1200, false));
  assert.equal(falso.enviados.length, 2, "a folga de 1,2 s sai inteira");
  falso.enviar(bloco(100, false));
  assert.equal(falso.enviados.length, 2, "com o portão fechado, silêncio não sai");
  sessao.cancelar();
});

test("pré-entrevista: parcial sem 200 ms de voz no trecho não é repassado", async (t) => {
  relogio(t);
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: c.eventos }, falso.dependencias);
  falso.enviar(bloco(100, true));
  falso.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, { text: "Oi" });
  assert.deepEqual(c.parciais, []);
  falso.enviar(bloco(200, true));
  falso.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, { text: "Oi tudo bem" });
  assert.deepEqual(c.parciais, ["Oi tudo bem"]);
  sessao.cancelar();
});

test("fala curta ('sim', 300 ms) recebe silêncio de complemento e commit sem esperar o VAD", async (t) => {
  const avancar = relogio(t);
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: coletar().eventos }, falso.dependencias);
  falso.enviar(bloco(300, true));
  falso.enviar(bloco(1200, false));
  // Trecho de 4800 + 19200 amostras: completado até 32000 com silêncio, antes do commit.
  assert.equal(totalAmostras(falso.enviados), 32000);
  assert.equal(falso.commits, 0);
  avancar(299);
  assert.equal(falso.commits, 0, "o commit espera COMMIT_TRECHO_CURTO_MS");
  avancar(1);
  assert.equal(falso.commits, 1);
  assert.equal(totalAmostras(falso.enviados), 32000 + 1600, "o commit leva um bloco de silêncio");
  sessao.cancelar();
});

test("sem confirmação do VAD, o commit de segurança fecha o trecho 1 s depois do portão fechar", async (t) => {
  const avancar = relogio(t);
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: coletar().eventos }, falso.dependencias);
  falso.enviar(bloco(1000, true));
  falso.enviar(bloco(1200, false));
  avancar(999);
  assert.equal(falso.commits, 0);
  avancar(1);
  assert.equal(falso.commits, 1);
  sessao.cancelar();
});

test("o VAD confirmar o trecho cancela o commit de segurança e o texto passa", async (t) => {
  const avancar = relogio(t);
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: c.eventos }, falso.dependencias);
  falso.enviar(bloco(1000, true));
  falso.enviar(bloco(1200, false));
  falso.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, { text: "Sim, claro." });
  avancar(5000);
  assert.equal(falso.commits, 0);
  assert.deepEqual(c.textos, ["Sim, claro."]);
  sessao.cancelar();
});

test("voz de novo antes do commit de segurança cancela o commit", async (t) => {
  const avancar = relogio(t);
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: coletar().eventos }, falso.dependencias);
  falso.enviar(bloco(1000, true));
  falso.enviar(bloco(1200, false));
  avancar(500);
  falso.enviar(bloco(100, true));
  avancar(2000);
  assert.equal(falso.commits, 0);
  sessao.cancelar();
});

test("portão fechado: um bloco de silêncio a cada 5 s mantém o Scribe ouvindo", async (t) => {
  const avancar = relogio(t);
  const falso = scribeFalso();
  const sessao = await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: coletar().eventos }, falso.dependencias);
  for (let i = 0; i < 60; i++) {
    avancar(100);
    falso.enviar(bloco(100, false));
  }
  assert.equal(falso.enviados.length, 1, "6 s de silêncio geram um único keep-alive");
  assert.equal(totalAmostras(falso.enviados), 1600);
  sessao.cancelar();
});

test("queda inesperada reconecta com token novo; o áudio captado durante a reconexão chega à nova conexão, em ordem", async (t) => {
  const avancar = relogio(t);
  const c = coletar();
  const falso = scribeFalso();
  let novos = 0;
  const sessao = await iniciarScribe({
    token: "teste", signal: new AbortController().signal, eventos: c.eventos,
    obterToken: async () => `novo-${++novos}`,
  }, falso.dependencias);
  falso.enviar(bloco(300, true));
  falso.emit(RealtimeEvents.CLOSE);
  // Durante a espera e a reconexão, a captura segue: o áudio espera na fila.
  falso.enviar(bloco(100, true));
  falso.enviar(bloco(200, true));
  await correr(avancar, 500);
  assert.deepEqual(falso.tokens, ["teste", "novo-1"]);
  assert.equal(c.erros.length, 0, "queda com reconexão não gera erro");
  assert.deepEqual(
    falso.enviados.flatMap(amostrasDe),
    [...amostrasDe(bloco(100, true)), ...amostrasDe(bloco(200, true))],
    "o áudio da queda sai na nova conexão, na ordem",
  );
  falso.enviar(bloco(100, true));
  assert.equal(falso.enviados.length, 3, "depois de reconectar, o áudio vai direto");
  sessao.cancelar();
});

test("erro transitório do Scribe também reconecta; sem obterToken, a queda encerra como antes", async (t) => {
  const avancar = relogio(t);
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({
    token: "teste", signal: new AbortController().signal, eventos: c.eventos,
    obterToken: async () => "novo",
  }, falso.dependencias);
  falso.emit(RealtimeEvents.ERROR, { message_type: "internal_error", message: "oscilou" });
  await correr(avancar, 500);
  assert.deepEqual(falso.tokens, ["teste", "novo"]);
  assert.equal(c.erros.length, 0);
  sessao.cancelar();

  const semRenovar = coletar();
  const outra = scribeFalso();
  await iniciarScribe({ token: "teste", signal: new AbortController().signal, eventos: semRenovar.eventos }, outra.dependencias);
  outra.emit(RealtimeEvents.ERROR, { message_type: "internal_error", message: "oscilou" });
  assert.equal(semRenovar.erros.length, 1);
  assert.equal(semRenovar.encerramentos, 1);
});

test("reconexão espera esperaParaReconectar entre tentativas e desiste no limite com aoErro", async (t) => {
  const avancar = relogio(t);
  const c = coletar();
  const falso = scribeFalso({ naoAbrir: (n) => n > 0 });
  const sessao = await iniciarScribe({
    token: "teste", signal: new AbortController().signal, eventos: c.eventos,
    obterToken: async () => "novo",
  }, falso.dependencias);
  falso.emit(RealtimeEvents.CLOSE);
  // Esperas 500, 1000, 2000, 4000 e 8000 ms; cada conexão que não abre espera 10 s pelo timeout.
  await correr(avancar, 499);
  assert.equal(falso.tokens.length, 1);
  await correr(avancar, 1);
  assert.equal(falso.tokens.length, 2, "primeira tentativa depois de 500 ms");
  await correr(avancar, 10_999);
  assert.equal(falso.tokens.length, 2);
  await correr(avancar, 1);
  assert.equal(falso.tokens.length, 3, "segunda tentativa depois de 1 s");
  await correr(avancar, 53_999);
  assert.equal(c.erros.length, 0, "ainda dentro das tentativas");
  assert.equal(falso.tokens.length, 6, "uma inicial e cinco tentativas");
  await correr(avancar, 1);
  assert.equal(c.erros.length, 1, "esgotou as tentativas: erro para o usuário");
  assert.equal(c.encerramentos, 1);
});

test("erro permanente do Scribe não reconecta: aoErro e encerra", async () => {
  const c = coletar();
  const falso = scribeFalso();
  await iniciarScribe({
    token: "teste", signal: new AbortController().signal, eventos: c.eventos,
    obterToken: async () => "novo",
  }, falso.dependencias);
  falso.emit(RealtimeEvents.ERROR, { message_type: "quota_exceeded", message: "cota" });
  assert.equal(c.erros.length, 1);
  assert.equal(c.encerramentos, 1);
  assert.equal(falso.tokens.length, 1, "não tentou abrir outra conexão");
});

test("parar durante a reconexão interrompe a espera, encerra limpo e não abre conexão", async (t) => {
  const avancar = relogio(t);
  const c = coletar();
  const falso = scribeFalso();
  const sessao = await iniciarScribe({
    token: "teste", signal: new AbortController().signal, eventos: c.eventos,
    obterToken: async () => "novo",
  }, falso.dependencias);
  falso.enviar(bloco(300, true));
  falso.emit(RealtimeEvents.CLOSE);
  await sessao.parar();
  await correr(avancar, 1000);
  assert.equal(falso.tokens.length, 1, "nenhuma conexão nova depois de parar");
  assert.equal(c.encerramentos, 1);
  assert.equal(falso.capturaParada, true);
  assert.equal(c.erros.length, 0);
});
