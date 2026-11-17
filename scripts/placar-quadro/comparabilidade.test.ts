import assert from "node:assert/strict";
import { test } from "node:test";
import { comparavel, diferencasDeBase } from "./comparabilidade";

test("só compara medições com todos os casos e conversas julgados", () => {
  const completo = { casos: [{ nota: {} }], conversas: [{ juiz: {} }] };
  assert.equal(comparavel(completo), true);
  assert.equal(comparavel({ ...completo, casos: [{}] }), false);
  assert.equal(comparavel({ ...completo, conversas: [{}] }), false);
  assert.equal(comparavel({ ...completo, conversas: [] }), false);
  assert.equal(comparavel({ ...completo, casos: [] }), false);
  // Falha do Totti é resultado da versão medida: entra na comparação, não a impede.
  const comFalhasDoTotti = { ...completo, resumo: { falhasDeProvedor: 3 } };
  assert.equal(comparavel(comFalhasDoTotti), true);
});

test("só compara medições com os mesmos casos, personas, juiz e candidato", () => {
  const base = {
    casos: [{ nome: "a" }, { nome: "b" }],
    conversas: [{ persona: "x" }, { persona: "y" }],
    modelos: { juiz: "kimi", candidato: "deepseek" },
  };
  assert.deepEqual(diferencasDeBase(base, { ...base, casos: [{ nome: "b" }, { nome: "a" }] }), []);
  assert.match(diferencasDeBase(base, { ...base, conversas: [{ persona: "x" }] }).join(), /personas diferentes/);
  assert.match(diferencasDeBase(base, { ...base, casos: [{ nome: "a" }] }).join(), /casos fixos diferentes/);
  assert.match(diferencasDeBase(base, { ...base, modelos: { juiz: "outro", candidato: "deepseek" } }).join(), /juiz diferente/);
  assert.match(diferencasDeBase(base, { ...base, modelos: { juiz: "kimi", candidato: "outro" } }).join(), /candidato diferente/);
});
