import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarTempoDeResposta } from "../../conversa/tempoDeResposta";
import { criarFilaDeFalas, type TelaVoz } from "../../voz/filaDeFalas";

describe("marca de tempo sem interferir no turno", () => {
  it("mede o primeiro bloco de voz, sem somar silêncio de fechamento nem parciais posteriores", () => {
    let agora = 1000;
    const t = criarTempoDeResposta(() => agora);
    t.audio.iniciou(); agora = 3000; t.audio.terminou(true);
    t.inicioDaVoz(8000); t.inicioDaVoz(9500);
    agora = 15_000;
    assert.equal(t.tomar(), 5000);
    t.inicioDaVoz(20_000);
    assert.equal(t.tomar(), undefined, "continuação sem nova fala do Totti não recebe latência");
  });
  it("corte, sobreposição e fala já iniciada não medem resposta", () => {
    for (const caso of ["corte", "sobreposicao", "jaFalando"] as const) {
      let agora = 1000;
      const t = criarTempoDeResposta(() => agora);
      if (caso === "jaFalando") t.inicioDaVoz();
      t.audio.iniciou();
      if (caso === "sobreposicao") t.inicioDaVoz(2000);
      agora = 3000;
      t.audio.terminou(caso !== "corte");
      if (caso === "corte") t.interromper();
      t.inicioDaVoz(8000);
      assert.equal(t.tomar(), undefined, caso);
    }
  });
  it("usa o último áudio real e ignora reação que não tocou", () => {
    let agora = 1000;
    const t = criarTempoDeResposta(() => agora);
    t.audio.iniciou(); agora = 2000; t.audio.terminou(true);
    agora = 4000; t.audio.iniciou(); agora = 5000; t.audio.terminou(true);
    agora = 6000; t.audio.terminou(true); // Gravação ausente, sem aoIniciar.
    t.inicioDaVoz(10_000);
    assert.equal(t.tomar(), 5000);
  });
  it("retry e substituição preservam a marca da primeira parte da fala", () => {
    let agora = 1000;
    const t = criarTempoDeResposta(() => agora);
    t.audio.iniciou(); agora = 2000; t.audio.terminou(true);
    t.inicioDaVoz(7000);
    assert.equal(t.tomar(), 5000);
    t.inicioDaVoz(12_000);
    assert.equal(t.tomar(true), 5000);
    assert.equal(t.tomar(true), 5000);
  });
  it("a fila só publica fim natural depois do player e invalida áudio cortado", async () => {
    let agora = 1000;
    const t = criarTempoDeResposta(() => agora);
    let encerrar!: () => void;
    let iniciou!: () => void;
    const pronta = new Promise<void>((r) => { iniciou = r; });
    const tela: TelaVoz = { estado() {}, erro() {}, aviso() {}, provedor() {}, fala() {} };
    const fila = criarFilaDeFalas({ agora: () => agora, pausaMs: 0, audio: t.audio, tela,
      foco: { aguardarMicrofone: async () => {}, assumir: () => () => {} },
      reproduzir: async (_texto, sinal, eventos, antes) => {
        await antes?.(); eventos.aoIniciar("elevenlabs"); iniciou();
        await new Promise<void>((r) => { encerrar = r; sinal.addEventListener("abort", () => r(), { once: true }); });
      },
    });
    const fala = fila.falar("Como funciona esse algoritmo?");
    await pronta; agora = 3000; encerrar(); await fala;
    t.inicioDaVoz(8000); assert.equal(t.tomar(), 5000);
    const outra = fila.falar("Por que escolheu essa estrutura?");
    await new Promise<void>((r) => setImmediate(r));
    fila.parar(); await outra;
    t.inicioDaVoz(15_000); assert.equal(t.tomar(), undefined);
  });
});
