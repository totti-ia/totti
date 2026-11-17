import assert from "node:assert/strict";
import { test } from "node:test";
import { comparavel } from "./comparabilidade";

test("só compara medições avaliadas e sem falhas de provedor", () => {
  const completo = { casos: [{ nota: {} }], conversas: [{ juiz: {} }], resumo: { falhasDeProvedor: 0 } };
  assert.equal(comparavel(completo), true);
  assert.equal(comparavel({ ...completo, casos: [{}] }), false);
  assert.equal(comparavel({ ...completo, conversas: [{}] }), false);
  assert.equal(comparavel({ ...completo, resumo: { falhasDeProvedor: 1 } }), false);
  assert.equal(comparavel({ ...completo, conversas: [] }), false);
});
