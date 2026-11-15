import assert from "node:assert/strict";
import { test } from "node:test";
import {
  caixaDosElementos, cenaParaTela, estaVisivel, scrollParaCentralizar, telaParaCena, precisaReduzirZoom,
  type Vista,
} from "../coordenadas";

const vista: Vista = { scrollX: -120, scrollY: 80, zoom: 1.75, offsetLeft: 200, offsetTop: 90, largura: 1000, altura: 700 };
const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);

test("cena e tela usam zoom, scroll e offsets do quadro", () => {
  const tela = cenaParaTela({ x: 200, y: -40 }, vista);
  assert.deepEqual(tela, { x: 340, y: 160 });
  assert.deepEqual(telaParaCena(tela, vista), { x: 200, y: -40 });
});

test("ida e volta preserva pontos em vários níveis de zoom e scroll", () => {
  for (const zoom of [0.1, 0.5, 1, 2.75, 5]) {
    for (const p of [{ x: 0, y: 0 }, { x: -480.25, y: 1020.8 }, { x: 9000, y: -10000 }]) {
      const v = { ...vista, zoom };
      const cena = telaParaCena(cenaParaTela(p, v), v);
      perto(cena.x, p.x);
      perto(cena.y, p.y);
      const tela = cenaParaTela(telaParaCena(p, v), v);
      perto(tela.x, p.x);
      perto(tela.y, p.y);
    }
  }
});

test("centralizar preserva zoom e coloca o centro no centro da área do quadro", () => {
  const c = { x: -1000, y: 2000, largura: 180, altura: 120 };
  assert.equal(estaVisivel(c, vista), false);
  const nova = { ...vista, ...scrollParaCentralizar(c, vista) };
  assert.equal(estaVisivel(c, nova), true);
  const centroNaTela = cenaParaTela({ x: -910, y: 2060 }, nova);
  perto(centroNaTela.x, vista.offsetLeft + vista.largura / 2);
  perto(centroNaTela.y, vista.offsetTop + vista.altura / 2);
  assert.equal(nova.zoom, vista.zoom);
});

test("visibilidade exige a caixa inteira e aplica margem em pixels", () => {
  const v = { ...vista, scrollX: 0, scrollY: 0, zoom: 2 };
  assert.equal(estaVisivel({ x: 12, y: 12, largura: 50, altura: 50 }, v), true);
  assert.equal(estaVisivel({ x: 11.9, y: 12, largura: 50, altura: 50 }, v), false);
  assert.equal(estaVisivel({ x: 0, y: 0, largura: 500, altura: 350 }, v, 0), true);
  assert.equal(estaVisivel({ x: 0, y: 0, largura: 500.1, altura: 350 }, v, 0), false);
  assert.equal(estaVisivel({ x: 62, y: 62, largura: -50, altura: -50 }, v), true);
});

test("decisão para vários alvos considera o conjunto e mantém o zoom ao rolar", () => {
  const v = { ...vista, scrollX: 0, scrollY: 0, zoom: 1 };
  const alvos = [{ x: 40, y: 50, largura: 80, altura: 60 }, { x: 800, y: 500, largura: 100, altura: 80 }];
  const conjunto = {
    x: Math.min(...alvos.map((c) => c.x)), y: Math.min(...alvos.map((c) => c.y)),
    largura: Math.max(...alvos.map((c) => c.x + c.largura)) - Math.min(...alvos.map((c) => c.x)),
    altura: Math.max(...alvos.map((c) => c.y + c.altura)) - Math.min(...alvos.map((c) => c.y)),
  };
  assert.equal(estaVisivel(conjunto, v, 60), false, "alvo fora de vista faz rolar o grupo inteiro");
  const destino = { ...v, ...scrollParaCentralizar(conjunto, v) };
  assert.equal(destino.zoom, v.zoom, "rolagem preserva zoom");
  assert.equal(estaVisivel(conjunto, destino, 0), true);
  assert.equal(precisaReduzirZoom(conjunto, v), false);
  assert.equal(precisaReduzirZoom({ ...conjunto, largura: 1200 }, v), true, "só reduz o zoom se o conjunto não couber");
});

test("caixas grandes permanecem cortadas ao centralizar sem mudar zoom", () => {
  const c = { x: 0, y: 0, largura: 2000, altura: 2000 };
  assert.equal(estaVisivel(c, { ...vista, ...scrollParaCentralizar(c, vista) }), false);
});

test("união envolve todos os elementos e aceita dimensões negativas, sem mutar entrada", () => {
  const elementos = Object.freeze([
    Object.freeze({ x: 10, y: 20, width: 100, height: 80 }),
    Object.freeze({ x: -20, y: 30, width: -10, height: -50 }),
  ]);
  assert.deepEqual(caixaDosElementos(elementos, 10), { x: -40, y: -30, largura: 160, altura: 140 });
  assert.deepEqual(caixaDosElementos(elementos, 0), { x: -30, y: -20, largura: 140, altura: 120 });
  assert.deepEqual(caixaDosElementos(elementos, -10), caixaDosElementos(elementos, 0));
  assert.equal(caixaDosElementos([]), null);
});

test("zoom inválido é rejeitado antes de dividir ou converter", () => {
  for (const zoom of [0, -1, NaN, Infinity]) {
    const v = { ...vista, zoom };
    assert.throws(() => telaParaCena({ x: 0, y: 0 }, v), RangeError);
    assert.throws(() => cenaParaTela({ x: 0, y: 0 }, v), RangeError);
    assert.throws(() => scrollParaCentralizar({ x: 0, y: 0, largura: 1, altura: 1 }, v), RangeError);
  }
});
