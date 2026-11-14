import { test } from "node:test";
import assert from "node:assert/strict";
import { chaveDoRascunho, comRascunho, criarCacheDeRascunho, pedeRascunho, RASCUNHOS_POR_SESSAO } from "../rascunho";

test("rascunho com a mesma chave é usado uma vez só", async () => {
  const cache = criarCacheDeRascunho<string>();
  cache.guardar("s1", "k", Promise.resolve("olá"));
  let chamadas = 0;
  const aoVivo = async () => { chamadas += 1; return "ao vivo"; };
  assert.deepEqual(await comRascunho(cache, "s1", "k", aoVivo), { valor: "olá", doRascunho: true });
  assert.deepEqual(await comRascunho(cache, "s1", "k", aoVivo), { valor: "ao vivo", doRascunho: false });
  assert.equal(chamadas, 1);
});

test("chave diferente ou outra sessão não usa o rascunho", async () => {
  const cache = criarCacheDeRascunho<string>();
  cache.guardar("s1", "k", Promise.resolve("olá"));
  assert.equal((await comRascunho(cache, "s1", "outra", async () => "x")).doRascunho, false);
  assert.equal((await comRascunho(cache, "s2", "k", async () => "x")).doRascunho, false);
  assert.ok(cache.tem("s1", "k"));
});

test("rascunho que falhou cai no caminho normal, sem rejeição solta", async () => {
  const cache = criarCacheDeRascunho<string>();
  cache.guardar("s1", "k", Promise.reject(new Error("modelo caiu")));
  assert.deepEqual(await comRascunho(cache, "s1", "k", async () => "ao vivo"), { valor: "ao vivo", doRascunho: false });
});

test("confirmação com o rascunho em preparo espera ele terminar", async () => {
  const cache = criarCacheDeRascunho<string>();
  let soltar!: (v: string) => void;
  cache.guardar("s1", "k", new Promise((r) => { soltar = r; }));
  const pendente = comRascunho(cache, "s1", "k", async () => "ao vivo");
  soltar("rascunho");
  assert.deepEqual(await pendente, { valor: "rascunho", doRascunho: true });
});

test("rascunho vence e só os mais recentes ficam", () => {
  let t = 0;
  const cache = criarCacheDeRascunho<number>({ validadeMs: 1000, agora: () => t });
  cache.guardar("s1", "velho", Promise.resolve(1));
  t = 1000;
  assert.equal(cache.tem("s1", "velho"), false);
  for (let i = 0; i < RASCUNHOS_POR_SESSAO + 2; i++) cache.guardar("s1", `k${i}`, Promise.resolve(i));
  assert.equal(cache.tem("s1", "k0"), false);
  assert.equal(cache.tem("s1", "k1"), false);
  assert.ok(cache.tem("s1", `k${RASCUNHOS_POR_SESSAO + 1}`));
});

test("chave não depende da ordem das propriedades e muda com o conteúdo", () => {
  assert.equal(chaveDoRascunho({ a: 1, b: { c: 2, d: 3 } }), chaveDoRascunho({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(chaveDoRascunho({ texto: "oi" }), chaveDoRascunho({ texto: "oi, tudo" }));
  assert.equal(chaveDoRascunho({ a: 1, b: undefined }), chaveDoRascunho({ a: 1 }));
});

test("pedeRascunho só com rascunho: true", () => {
  assert.equal(pedeRascunho({ rascunho: true }), true);
  assert.equal(pedeRascunho({ rascunho: "true" }), false);
  assert.equal(pedeRascunho(null), false);
});
