import type { Page, WebSocketRoute } from "@playwright/test";

type MicrofoneTeste = {
  blocos(amplitude: number, duracaoMs: number): void;
  processadores: ScriptProcessorNode[];
};
type JanelaMicrofone = Window & { microfoneTeste: MicrofoneTeste };

/**
 * Só para a sobreposição: o fallback SpeechRecognition não mede PCM durante a voz do Totti.
 * Mantém o caminho Scribe aberto localmente e injeta blocos no callback do processador real.
 * O detector, os callbacks da sala e o player continuam sendo os do produto.
 */
export async function prepararScribeFalso(page: Page) {
  let socket: WebSocketRoute | undefined;
  await page.route("**/api/stt-token?**", (rota) => rota.fulfill({ json: { token: "token-local-e2e" } }));
  await page.routeWebSocket(/api\.elevenlabs\.io\/v1\/speech-to-text\/realtime/, (ws) => {
    socket = ws;
    ws.send(JSON.stringify({ message_type: "session_started" }));
    // Sem connectToServer(): nenhum áudio ou texto sai para a ElevenLabs.
  });
  await page.addInitScript(() => {
    const processadores: ScriptProcessorNode[] = [];
    const original = AudioContext.prototype.createScriptProcessor;
    AudioContext.prototype.createScriptProcessor = function (...args) {
      const processador = original.apply(this, args);
      processadores.push(processador);
      return processador;
    };
    (window as unknown as JanelaMicrofone).microfoneTeste = {
      processadores,
      blocos(amplitude, duracaoMs) {
        for (const p of processadores) {
          if (!p.onaudioprocess) continue;
          const n = 4096;
          const entrada = p.context.createBuffer(1, n, p.context.sampleRate);
          const saida = p.context.createBuffer(1, n, p.context.sampleRate);
          const amostras = entrada.getChannelData(0);
          // Energia determinística; não toca nos alto-falantes nem muda a regra do detector.
          for (let i = 0; i < n; i++) amostras[i] = amplitude * Math.sin(i * 0.2);
          const evento = { inputBuffer: entrada, outputBuffer: saida } as AudioProcessingEvent;
          const quantidade = Math.ceil(duracaoMs / (n / p.context.sampleRate * 1000));
          for (let i = 0; i < quantidade; i++) p.onaudioprocess.call(p, evento);
        }
      },
    };
  });
  return {
    conectado: () => !!socket,
    blocos: (amplitude: number, duracaoMs: number) => page.evaluate(({ amplitude, duracaoMs }) => {
      (window as unknown as JanelaMicrofone).microfoneTeste.blocos(amplitude, duracaoMs);
    }, { amplitude, duracaoMs }),
    emitir(texto: string) {
      if (!socket) throw new Error("O Scribe falso ainda não conectou");
      socket.send(JSON.stringify({ message_type: "committed_transcript", text: texto }));
    },
  };
}
