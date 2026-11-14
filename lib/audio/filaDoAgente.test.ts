import assert from "node:assert/strict";
import { test } from "node:test";
import { FilaDoAgente, IDADE_MAXIMA_NA_FILA_MS, ReacaoRetida, motivoDeDescarte, type ContextoDeTocar, type PedidoDeFala } from "./filaDoAgente";

const ctx = (extra: Partial<ContextoDeTocar> = {}): ContextoDeTocar =>
  ({ agora: 1000, fase: "ALTO_NIVEL", ultimaAtividadeDoCandidatoEm: 0, numeroPerguntaAtiva: null, ...extra });
const pedido = (carga: string, extra: Partial<PedidoDeFala<string>> = {}): PedidoDeFala<string> =>
  ({ origem: "resposta", carga, fase: "ALTO_NIVEL", ...extra });

test("sem fala tocando, a nova toca na hora e nada entra na fila", () => {
  const fila = new FilaDoAgente<string>();
  assert.deepEqual(fila.admitir(pedido("a"), false, 0), { resultado: "tocar" });
  assert.equal(fila.tamanho, 0);
});

test("com fala tocando, a nova espera (não corta) e várias saem em ordem", () => {
  const fila = new FilaDoAgente<string>();
  for (const t of ["b", "c", "d"]) assert.equal(fila.admitir(pedido(t), true, 100).resultado, "esperar");
  assert.equal(fila.tamanho, 3);
  const saida: string[] = [];
  for (let r = fila.proximo(ctx()); r.item; r = fila.proximo(ctx())) saida.push(r.item.carga);
  assert.deepEqual(saida, ["b", "c", "d"]);
});

test("iniciativa do Totti com ele falando é descartada, não entra na fila", () => {
  const fila = new FilaDoAgente<string>();
  assert.deepEqual(fila.admitir(pedido("x", { origem: "iniciativa" }), true, 0), { resultado: "descartar", motivo: "agente_ocupado" });
  assert.equal(fila.tamanho, 0);
});

test("iniciativa que esperou some se o candidato agiu depois de ela entrar; vale se ele só agiu antes", () => {
  const item = { id: 1, origem: "iniciativa" as const, carga: "x", fase: "ALTO_NIVEL", entrouEm: 500 };
  assert.equal(motivoDeDescarte(item, ctx({ ultimaAtividadeDoCandidatoEm: 600 })), "candidato_agiu");
  assert.equal(motivoDeDescarte(item, ctx({ ultimaAtividadeDoCandidatoEm: 400 })), null);
});

test("resposta: vale na mesma fase; outra fase descarta", () => {
  const item = { id: 1, origem: "resposta" as const, carga: "x", fase: "ALTO_NIVEL", entrouEm: 500 };
  assert.equal(motivoDeDescarte(item, ctx()), null);
  assert.equal(motivoDeDescarte(item, ctx({ fase: "APROFUNDAMENTO" })), "fase_mudou");
  // O candidato ter falado depois não descarta a resposta por aqui: quem retira é a substituição (remover).
  assert.equal(motivoDeDescarte(item, ctx({ ultimaAtividadeDoCandidatoEm: 900 })), null);
});

test("pergunta do Analista: cancelada, expirada ou trocada por outra não toca", () => {
  const item = { id: 1, origem: "pergunta" as const, carga: "x", fase: "ALTO_NIVEL", numeroPergunta: 3, entrouEm: 500 };
  assert.equal(motivoDeDescarte(item, ctx({ numeroPerguntaAtiva: 3 })), null);
  assert.equal(motivoDeDescarte(item, ctx({ numeroPerguntaAtiva: null })), "pergunta_obsoleta");
  assert.equal(motivoDeDescarte(item, ctx({ numeroPerguntaAtiva: 4 })), "pergunta_obsoleta");
  assert.equal(motivoDeDescarte({ ...item, numeroPergunta: null }, ctx({ numeroPerguntaAtiva: 3 })), "pergunta_obsoleta");
});

test("limite de idade: passou, descarta (menos a despedida, que sempre toca)", () => {
  const velho = ctx({ agora: 500 + IDADE_MAXIMA_NA_FILA_MS + 1 });
  const base = { id: 1, carga: "x", fase: "ALTO_NIVEL", numeroPergunta: 1, entrouEm: 500 };
  for (const origem of ["resposta", "pergunta", "iniciativa"] as const) {
    assert.equal(motivoDeDescarte({ ...base, origem }, { ...velho, numeroPerguntaAtiva: 1 }), "expirou");
  }
  assert.equal(motivoDeDescarte({ ...base, origem: "sempre" }, { ...velho, fase: "ENCERRADA" }), null);
  assert.equal(motivoDeDescarte({ ...base, origem: "resposta" }, ctx({ agora: 500 + IDADE_MAXIMA_NA_FILA_MS })), null);
});

test("proximo pula os que não valem, devolve os descartes com motivo e segue a ordem", () => {
  const fila = new FilaDoAgente<string>();
  fila.admitir(pedido("velha"), true, 0);
  fila.admitir(pedido("boa"), true, 900 + IDADE_MAXIMA_NA_FILA_MS);
  fila.admitir(pedido("despedida", { origem: "sempre", fase: "ENCERRADA" }), true, 950 + IDADE_MAXIMA_NA_FILA_MS);
  const r = fila.proximo(ctx({ agora: IDADE_MAXIMA_NA_FILA_MS + 1000 }));
  assert.equal(r.item?.carga, "boa");
  assert.deepEqual(r.descartados.map((d) => [d.item.carga, d.motivo]), [["velha", "expirou"]]);
  assert.equal(fila.proximo(ctx({ agora: IDADE_MAXIMA_NA_FILA_MS + 1000, fase: "ENCERRADA" })).item?.carga, "despedida");
  assert.equal(fila.proximo(ctx()).item, null);
});

test("tudo continua valendo: o caso feliz entrega tudo, sem descartes", () => {
  const fila = new FilaDoAgente<string>();
  fila.admitir(pedido("p", { origem: "pergunta", numeroPergunta: 2 }), true, 800);
  fila.admitir(pedido("r"), true, 850);
  const c = ctx({ numeroPerguntaAtiva: 2, ultimaAtividadeDoCandidatoEm: 100 });
  const a = fila.proximo(c);
  const b = fila.proximo(c);
  assert.deepEqual([a.item?.carga, b.item?.carga], ["p", "r"]);
  assert.equal(a.descartados.length + b.descartados.length, 0);
});

test("remover tira só os que passam no filtro (resposta substituída) e mantém os outros", () => {
  const fila = new FilaDoAgente<string>();
  fila.admitir(pedido("p", { origem: "pergunta", numeroPergunta: 1 }), true, 0);
  fila.admitir(pedido("r"), true, 0);
  const saiu = fila.remover((i) => i.origem === "resposta", "substituida");
  assert.deepEqual(saiu.map((d) => [d.item.carga, d.motivo]), [["r", "substituida"]]);
  assert.equal(fila.proximo(ctx({ numeroPerguntaAtiva: 1 })).item?.carga, "p");
});

test("limpar (barge-in, silenciar, encerrar) esvazia a fila e informa o que saiu", () => {
  const fila = new FilaDoAgente<string>();
  fila.admitir(pedido("a"), true, 0);
  fila.admitir(pedido("b", { origem: "sempre" }), true, 0);
  const saiu = fila.limpar();
  assert.deepEqual(saiu.map((d) => d.motivo), ["silenciado", "silenciado"]);
  assert.equal(fila.tamanho, 0);
  assert.equal(fila.proximo(ctx()).item, null);
});

test("o item entregue sai da fila: a fala em curso não é tocada de novo", () => {
  const fila = new FilaDoAgente<string>();
  fila.admitir(pedido("a"), true, 0);
  assert.equal(fila.proximo(ctx()).item?.carga, "a");
  assert.equal(fila.tamanho, 0);
});

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("reação retida: a fala seguinte a tira para sair junta; sem ela, vence depois do prazo", async () => {
  const vencidas: string[] = [];
  const retencao = new ReacaoRetida<string>((texto) => { vencidas.push(texto); }, 30);
  assert.equal(retencao.reter("Hm", "carga"), true);
  assert.equal(retencao.reter("Uhum.", "outra"), false, "só uma reação retida por vez");
  assert.deepEqual(retencao.consumir(), { texto: "Hm", carga: "carga" });
  assert.equal(retencao.consumir(), null);
  await dormir(60);
  assert.deepEqual(vencidas, [], "consumida, a reação não vence");

  retencao.reter("Uhum.", "y");
  await dormir(60);
  assert.deepEqual(vencidas, ["Uhum."]);
});

test("fala que não é reação não é retida e não vence", async () => {
  const retencao = new ReacaoRetida<string>(() => assert.fail("não devia vencer"), 30);
  assert.equal(retencao.reter("Como você escalaria?", "x"), false);
  assert.equal(retencao.consumir(), null);
  await dormir(60);
});

test("limpar tira a reação retida sem tocá-la", async () => {
  const vencidas: string[] = [];
  const retencao = new ReacaoRetida<string>((texto) => { vencidas.push(texto); }, 30);
  retencao.reter("Certo.", "x");
  assert.deepEqual(retencao.limpar(), { texto: "Certo.", carga: "x" });
  await dormir(60);
  assert.deepEqual(vencidas, []);
});
