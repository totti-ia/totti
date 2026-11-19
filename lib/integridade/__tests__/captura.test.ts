import assert from "node:assert/strict";
import { it } from "node:test";
import { criarEscutaTranscricao } from "../../presenca/useTranscricao";
import { criarTempoDeResposta } from "../../conversa/tempoDeResposta";

it("captura a abertura do portão antes do parcial, sem esperar confirmação nem fechamento do turno", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let agora = 1000;
  t.mock.method(Date, "now", () => agora);
  const tempo = criarTempoDeResposta();
  tempo.audio.iniciou(); agora = 3000; tempo.audio.terminou(true);
  let processar: ((evento: unknown) => void) | null = null;
  class No {
    gain = { value: 1 };
    connect(no: unknown) { return no; }
    disconnect() {}
  }
  class Contexto {
    sampleRate = 48000;
    state = "running";
    destination = {};
    createMediaStreamSource() { return new No(); }
    createGain() { return new No(); }
    createScriptProcessor() {
      return Object.defineProperty(new No(), "onaudioprocess", { set(fn: typeof processar) { processar = fn; } });
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  class Socket {
    readyState = 0;
    bufferedAmount = 0;
    close() {}
    send() {}
  }
  for (const [nome, valor] of Object.entries({ window: { AudioContext: Contexto }, WebSocket: Socket })) {
    const anterior = Object.getOwnPropertyDescriptor(globalThis, nome);
    Object.defineProperty(globalThis, nome, { configurable: true, value: valor });
    t.after(() => { if (anterior) Object.defineProperty(globalThis, nome, anterior); else Reflect.deleteProperty(globalThis, nome); });
  }
  const trilha = Object.assign(new EventTarget(), { readyState: "live", enabled: true, muted: false });
  let parciais = 0, aberturas = 0;
  const escuta = criarEscutaTranscricao({
    stream: { getAudioTracks: () => [trilha] } as unknown as MediaStream,
    sessaoId: "teste", servidor: true, obterToken: async () => "token-falso", aoEstado() {},
    aoTrecho: () => { parciais++; },
    aoInicioDaVoz: (em) => { aberturas++; tempo.inicioDaVoz(em); },
  });
  t.after(() => escuta.parar());
  escuta.ativar(true);
  await new Promise<void>((r) => setImmediate(r));
  const bloco = (energia: number) => (processar as unknown as (e: unknown) => void)({
    inputBuffer: { numberOfChannels: 1, getChannelData: () => new Float32Array(4096).fill(energia) },
    outputBuffer: { getChannelData: () => new Float32Array(4096) },
  });
  agora = 7900; bloco(0);
  assert.equal(aberturas, 0);
  agora = 8000 + 4096 / 48; bloco(0.25);
  agora = 8200; bloco(0.25);
  assert.equal(aberturas, 1);
  assert.equal(parciais, 0);
  agora = 15_000;
  assert.equal(tempo.tomar(), 5000);
});
