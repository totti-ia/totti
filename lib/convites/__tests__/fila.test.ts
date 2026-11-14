import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { criarKvEmMemoria, definirKvParaTestes } from "@/lib/storage/kv";
import {
  enfileirar,
  lerLote,
  processarLote,
  progressoDe,
  reenviarFalhas,
  TAMANHO_DO_BLOCO,
  type Enviador,
  type NovoItem,
} from "@/lib/convites/fila";
import { resumoDoEnvio } from "@/lib/convites/resumo";

const env = process.env as Record<string, string | undefined>;
const dados = { vagaId: "v1", cargo: "Backend", configId: "c1", mode: "system_design" as const, durationMin: 45, languages: ["python"], base: "https://x.test" };
const candidatos = (n: number): NovoItem[] => Array.from({ length: n }, (_, i) => ({ nome: `P${i}`, email: `p${i}@x.test`, real: false }));

/** Envio stubado: conta chamadas e falha para os e-mails em `falham`. Nunca toca em provedor de e-mail. */
function stub(falham: Set<string> = new Set()) {
  const enviados: string[] = [];
  const enviar: Enviador = async (_l, item) => {
    if (falham.has(item.email)) throw new Error("provedor fora do ar");
    enviados.push(item.email);
    return { status: "enviado" };
  };
  return { enviados, enviar };
}

describe("fila de convites", () => {
  beforeEach(() => {
    definirKvParaTestes(criarKvEmMemoria());
    delete env.CONVITES_POR_MINUTO;
  });

  it("enfileirar devolve { lote, total } e não envia nada", async () => {
    const r = await enfileirar(dados, candidatos(5));
    assert.equal(r.total, 5);
    const l = await lerLote(r.lote);
    assert.equal(l?.itens.every((i) => i.status === "pendente"), true);
    assert.deepEqual(progressoDe(l!), { lote: r.lote, total: 5, enviados: 0, simulados: 0, falharam: 0, pendentes: 5, concluido: false, falhas: [] });
  });

  it("processa um bloco por vez e termina o lote", async () => {
    const { lote } = await enfileirar(dados, candidatos(TAMANHO_DO_BLOCO + 5));
    const { enviados, enviar } = stub();
    const p1 = await processarLote(lote, enviar);
    assert.equal(p1?.enviados, TAMANHO_DO_BLOCO);
    assert.equal(p1?.concluido, false);
    const p2 = await processarLote(lote, enviar);
    assert.equal(p2?.enviados, TAMANHO_DO_BLOCO + 5);
    assert.equal(p2?.concluido, true);
    assert.equal(new Set(enviados).size, TAMANHO_DO_BLOCO + 5);
  });

  it("respeita o limite por minuto e retoma na janela seguinte", async () => {
    env.CONVITES_POR_MINUTO = "10";
    const { lote } = await enfileirar(dados, candidatos(30), 0);
    const { enviar } = stub();
    assert.equal((await processarLote(lote, enviar, { agora: () => 1_000 }))?.enviados, 10);
    // Mesma janela: nada novo sai.
    assert.equal((await processarLote(lote, enviar, { agora: () => 30_000 }))?.enviados, 10);
    // Passou um minuto da janela: mais 10.
    assert.equal((await processarLote(lote, enviar, { agora: () => 61_000 }))?.enviados, 20);
  });

  it("falhas ficam registradas e o reenvio manda só elas", async () => {
    const { lote } = await enfileirar(dados, candidatos(4));
    const ruim = stub(new Set(["p1@x.test", "p3@x.test"]));
    const p = await processarLote(lote, ruim.enviar);
    assert.equal(p?.enviados, 2);
    assert.equal(p?.falharam, 2);
    assert.deepEqual(p?.falhas, ["p1@x.test", "p3@x.test"]);
    assert.equal(resumoDoEnvio(p!), "2 de 4 enviados · 2 falharam");

    const r = await reenviarFalhas(lote);
    assert.equal(r?.reenfileirados, 2);
    const bom = stub();
    const depois = await processarLote(lote, bom.enviar);
    assert.deepEqual(bom.enviados, ["p1@x.test", "p3@x.test"]);
    assert.equal(depois?.enviados, 4);
    assert.equal(depois?.falharam, 0);
    assert.equal(depois?.concluido, true);
  });

  it("o link do convite não muda no reenvio", async () => {
    const { lote } = await enfileirar(dados, candidatos(1));
    await processarLote(lote, stub(new Set(["p0@x.test"])).enviar);
    const antes = (await lerLote(lote))!.itens[0];
    await reenviarFalhas(lote);
    await processarLote(lote, stub().enviar);
    const depois = (await lerLote(lote))!.itens[0];
    assert.equal(depois.link, antes.link);
    assert.equal(depois.tentativas, 2);
  });

  it("duas passadas ao mesmo tempo não enviam duas vezes", async () => {
    const { lote } = await enfileirar(dados, candidatos(3));
    let solta!: () => void;
    const segura = new Promise<void>((r) => (solta = r));
    let chamadas = 0;
    const lenta: Enviador = async () => {
      chamadas += 1;
      await segura;
      return { status: "enviado" };
    };
    const primeira = processarLote(lote, lenta);
    await new Promise((r) => setTimeout(r, 10));
    const segunda = await processarLote(lote, lenta);
    assert.equal(segunda?.enviados, 0);
    solta();
    await primeira;
    assert.equal(chamadas, 3);
  });

  it("soEstes manda só o testador, sem gastar a cota", async () => {
    const itens = [...candidatos(3), { nome: "Eu", email: "eu@x.test", real: true, testador: true }];
    const { lote } = await enfileirar(dados, itens);
    const { enviados, enviar } = stub();
    const p = await processarLote(lote, enviar, { soEstes: (i) => i.testador === true });
    assert.deepEqual(enviados, ["eu@x.test"]);
    assert.equal(p?.pendentes, 3);
    assert.equal((await lerLote(lote))!.janela.usados, 0);
  });

  it("lote inexistente ou id malformado: null", async () => {
    assert.equal(await processarLote("a".repeat(24), stub().enviar), null);
    assert.equal(await lerLote("../x"), null);
    assert.equal(await reenviarFalhas("a".repeat(24)), null);
  });
});
