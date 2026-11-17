import assert from "node:assert/strict";
import { test } from "node:test";
import { repetirRespostaIncompleta } from "./tentativas";

test("recupera resposta incompleta sem repetir outros erros", async () => {
  let chamadas = 0;
  const avisos: number[] = [];
  const resultado = await repetirRespostaIncompleta(async () => {
    if (++chamadas === 1) throw new Error("resposta da featherless sem choices[0].message");
    return "fala";
  }, (tentativa) => avisos.push(tentativa));
  assert.equal(resultado, "fala");
  assert.equal(chamadas, 2);
  assert.deepEqual(avisos, [1]);
  let erros = 0;
  await assert.rejects(repetirRespostaIncompleta(async () => { erros++; throw new Error("HTTP 403"); }), /403/);
  assert.equal(erros, 1);
});

test("desiste após três respostas incompletas", async () => {
  let chamadas = 0;
  await assert.rejects(repetirRespostaIncompleta(async () => {
    chamadas++;
    throw new Error("resposta da featherless sem choices[0].message");
  }), /sem choices/);
  assert.equal(chamadas, 3);
});
