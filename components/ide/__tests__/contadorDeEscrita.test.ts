import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContadorDeEscrita, mesmoTrecho } from "../contadorDeEscrita";

const tecla = (linha: number, texto: string) => ({ linha, apagou: 0, texto });

describe("ContadorDeEscrita", () => {
  it("conta o digitado, o maior trecho sem pausa e esvazia", () => {
    const c = new ContadorDeEscrita();
    "def f():".split("").forEach((ch, i) => c.registrar([tecla(1, ch)], i * 100));
    c.registrar([tecla(1, "\n    ")], 900);
    assert.deepEqual(c.esvaziar(), { digitados: 13, apagados: 0, maiorTrechoSemPausa: 13, voltouParaCima: false });
    assert.equal(c.esvaziar(), null);
  });

  it("uma pausa de 2 s começa outro trecho", () => {
    const c = new ContadorDeEscrita();
    c.registrar([tecla(1, "abc")], 0);
    c.registrar([tecla(1, "de")], 2_500);
    assert.equal(c.esvaziar()?.maiorTrechoSemPausa, 3);
  });

  it("apagar zera o trecho e conta os apagados", () => {
    const c = new ContadorDeEscrita();
    c.registrar([tecla(1, "abcd")], 0);
    c.registrar([{ linha: 1, apagou: 2, texto: "" }], 100);
    c.registrar([tecla(1, "x")], 200);
    assert.deepEqual(c.esvaziar(), { digitados: 5, apagados: 2, maiorTrechoSemPausa: 4, voltouParaCima: false });
  });

  it("editar uma linha acima da última marca que voltou", () => {
    const c = new ContadorDeEscrita();
    c.registrar([tecla(1, "a")], 0);
    c.registrar([tecla(1, "\n")], 100);
    c.registrar([tecla(2, "b")], 200);
    assert.equal(c.esvaziar()?.voltouParaCima, false);
    c.registrar([tecla(1, "c")], 300);
    assert.equal(c.esvaziar()?.voltouParaCima, true);
  });

  it("colagem e inserções grandes não contam como digitação", () => {
    const c = new ContadorDeEscrita();
    c.registrar([tecla(1, "x".repeat(200))], 0, true);
    c.registrar([tecla(5, "y".repeat(80))], 100);
    assert.equal(c.esvaziar(), null);
  });

  it("o trecho em curso continua no snapshot seguinte", () => {
    const c = new ContadorDeEscrita();
    c.registrar([tecla(1, "abc")], 0);
    c.esvaziar();
    c.registrar([tecla(1, "de")], 500);
    assert.equal(c.esvaziar()?.maiorTrechoSemPausa, 5);
  });
});

describe("mesmoTrecho", () => {
  it("ignora fins de linha do Windows e espaço nas pontas", () => {
    assert.equal(mesmoTrecho("a = 1\r\nb = 2\r\n", "a = 1\nb = 2"), true);
    assert.equal(mesmoTrecho("a = 1", "a = 2"), false);
    assert.equal(mesmoTrecho("  ", ""), false);
  });
});
