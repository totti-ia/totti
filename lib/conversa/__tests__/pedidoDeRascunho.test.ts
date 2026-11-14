import { test } from "node:test";
import assert from "node:assert/strict";
import { criarPedidoDeRascunho } from "../pedidoDeRascunho";

/** Enviar falso: guarda cada pedido e o sinal dele; `soltar` resolve o pedido i. */
function enviarFalso() {
  const pedidos: { texto: string; sinal: AbortSignal; soltar: () => void }[] = [];
  const enviar = (texto: string, sinal: AbortSignal) =>
    new Promise<void>((resolver) => pedidos.push({ texto, sinal, soltar: resolver }));
  return { enviar, pedidos };
}

test("pede o rascunho com o texto e ignora vazio", () => {
  const { enviar, pedidos } = enviarFalso();
  const pedido = criarPedidoDeRascunho(enviar);
  pedido.pedir("   ");
  pedido.pedir("");
  assert.equal(pedidos.length, 0);
  pedido.pedir("oi, tudo bem");
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].texto, "oi, tudo bem");
});

test("texto igual ao do último pedido não reenvia", () => {
  const { enviar, pedidos } = enviarFalso();
  const pedido = criarPedidoDeRascunho(enviar);
  pedido.pedir("oi");
  pedido.pedir("oi");
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].sinal.aborted, false);
});

test("texto novo aborta o pedido anterior", () => {
  const { enviar, pedidos } = enviarFalso();
  const pedido = criarPedidoDeRascunho(enviar);
  pedido.pedir("oi");
  pedido.pedir("oi, tudo bem");
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[0].sinal.aborted, true);
  assert.equal(pedidos[1].sinal.aborted, false);
});

test("cancelar aborta o pedido em curso e permite pedir o mesmo texto de novo", () => {
  const { enviar, pedidos } = enviarFalso();
  const pedido = criarPedidoDeRascunho(enviar);
  pedido.pedir("oi");
  pedido.cancelar();
  assert.equal(pedidos[0].sinal.aborted, true);
  pedido.pedir("oi");
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[1].sinal.aborted, false);
});

test("erro do enviar (assíncrono ou síncrono) não vaza", async () => {
  const pedido = criarPedidoDeRascunho(() => Promise.reject(new Error("rede caiu")));
  pedido.pedir("oi");
  await new Promise((r) => setTimeout(r, 0));
  const sincrono = criarPedidoDeRascunho(() => { throw new Error("falhou já"); });
  assert.doesNotThrow(() => sincrono.pedir("oi"));
});
