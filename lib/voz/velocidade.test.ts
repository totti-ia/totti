import assert from "node:assert/strict";
import { test } from "node:test";
import { CARACTERES_DE_FALA_LONGA, velocidadeDaFala } from "./velocidade";

test("fala até 200 caracteres sai no ritmo atual (1,1); acima de 200, mais calma (1,0)", () => {
  assert.equal(CARACTERES_DE_FALA_LONGA, 200);
  assert.equal(velocidadeDaFala("a".repeat(200)), 1.1);
  assert.equal(velocidadeDaFala("a".repeat(201)), 1);
});

test("os espaços em volta não contam para o tamanho da fala", () => {
  assert.equal(velocidadeDaFala(`  ${"a".repeat(200)}  `), 1.1);
});
