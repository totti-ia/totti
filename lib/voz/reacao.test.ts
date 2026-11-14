import assert from "node:assert/strict";
import { test } from "node:test";
import { ESPERA_DA_REACAO_MS, juntarReacao, slugDaReacao, urlDaReacao } from "./reacao";

test("reações puras viram o slug da gravação, com ou sem pontuação, acento e maiúsculas", () => {
  assert.equal(slugDaReacao("Hm."), "hm");
  assert.equal(slugDaReacao("Hmm."), "hm");
  assert.equal(slugDaReacao("hmmm"), "hm");
  assert.equal(slugDaReacao("Hum"), "hum");
  assert.equal(slugDaReacao("Humm"), "hum");
  assert.equal(slugDaReacao("Uhum."), "uhum");
  assert.equal(slugDaReacao("Uhum!"), "uhum");
  assert.equal(slugDaReacao("Tá"), "ta");
  assert.equal(slugDaReacao("ta."), "ta");
  assert.equal(slugDaReacao("Certo."), "certo");
  assert.equal(slugDaReacao("  certo  "), "certo");
});

test("qualquer fala que não é só a reação não é reação pura", () => {
  assert.equal(slugDaReacao("Hum, certo."), null);
  assert.equal(slugDaReacao("Por quê?"), null);
  assert.equal(slugDaReacao("Certo, e o cache?"), null);
  assert.equal(slugDaReacao("Hum?"), null);
  assert.equal(slugDaReacao(""), null);
  assert.equal(slugDaReacao("E como você escalaria isso?"), null);
});

test("juntar a reação com a fala seguinte garante a pontuação da reação", () => {
  assert.equal(juntarReacao("Hm", "E como você escalaria isso?"), "Hm. E como você escalaria isso?");
  assert.equal(juntarReacao("Uhum!", "Faz sentido."), "Uhum! Faz sentido.");
  assert.equal(juntarReacao("Tá.", "  Qual o gargalo?  "), "Tá. Qual o gargalo?");
});

test("a gravação de cada reação fica em public/audio/reacoes", () => {
  assert.equal(urlDaReacao("hm"), "/audio/reacoes/hm.mp3");
  assert.equal(ESPERA_DA_REACAO_MS, 1200);
});
