import assert from "node:assert/strict";
import { test } from "node:test";
import { paraJulgar } from "./completar";

const casos = [{ nome: "a", nota: { escuta: 4 } }, { nome: "b" }];
const conversas = [{ persona: "x", juiz: { geral: 3 } }, { persona: "y", erroJuiz: "erro de rede" }];

test("completar mantém as notas dadas e devolve à fila só o que ficou sem avaliação", () => {
  const r = paraJulgar(casos, conversas, true);
  assert.deepEqual(r.casos, [{ nome: "a", nota: { escuta: 4 } }, { nome: "b" }]);
  assert.deepEqual(r.conversas, [{ persona: "x", juiz: { geral: 3 } }, { persona: "y" }]);
});

test("rejulgar devolve tudo à fila", () => {
  const r = paraJulgar(casos, conversas, false);
  assert.deepEqual(r.casos, [{ nome: "a" }, { nome: "b" }]);
  assert.deepEqual(r.conversas, [{ persona: "x" }, { persona: "y" }]);
});
