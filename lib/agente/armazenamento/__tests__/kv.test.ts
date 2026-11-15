import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarArquivosEmMemoria } from "@/lib/storage/arquivos";
import { criarKvEmMemoria } from "@/lib/storage/kv";
import { estadoInicial } from "../../sessao/estado";
import { criarRepositorioKv } from "../kv";
import { ErroLimite, type RepositorioSessoes } from "../repositorio";

const novoRepositorio = (): RepositorioSessoes => criarRepositorioKv(criarKvEmMemoria(), criarArquivosEmMemoria());
const nova = (r: RepositorioSessoes) => r.criar({ avaliacaoId: "demo", candidatoId: "c", estado: estadoInicial() });
const ev = (n: number, horario = "2026-11-07T15:00:00Z") => ({ horario, tipo: "fala", dados: { n } });

describe("repositório de sessões em cima do kv", () => {
  it("cria, obtém (cópia) e salva estado", async () => {
    const r = novoRepositorio();
    const s = await nova(r);
    assert.match(s.id, /^[0-9a-f-]{36}$/);
    assert.equal(s.analises, 0);
    const lido = await r.obter(s.id);
    assert.ok(lido);
    lido.estado.fase = "ENCERRADA"; // mexer na cópia não afeta o repositório
    assert.equal((await r.obter(s.id))!.estado.fase, "AGUARDANDO");
    await r.salvarEstado(s.id, { ...s.estado, fase: "REQUISITOS" });
    assert.equal((await r.obter(s.id))!.estado.fase, "REQUISITOS");
    assert.equal(await r.obter("nada"), null);
    assert.equal(await r.obter("../quebra"), null, "id fora do formato nem vai ao armazenamento");
  });

  it("salvar o estado não perde o contador de análises", async () => {
    const r = novoRepositorio();
    const s = await nova(r);
    assert.equal(await r.contarAnalise(s.id), 1);
    assert.equal(await r.contarAnalise(s.id), 2);
    await r.salvarEstado(s.id, { ...s.estado, fase: "REQUISITOS" });
    assert.equal((await r.obter(s.id))!.analises, 2);
    assert.equal(await r.contarAnalise("nada"), 0);
  });

  it("eventos: idempotentes, só os novos voltam, na ordem recebida", async () => {
    const r = novoRepositorio();
    const s = await nova(r);
    assert.equal((await r.anexarEventos(s.id, [ev(1), ev(1), ev(2), ev(3)])).length, 3);
    assert.deepEqual((await r.anexarEventos(s.id, [ev(3), ev(4)])).map((e) => (e.dados as { n: number }).n), [4]);
    assert.deepEqual((await r.listarEventos(s.id)).map((e) => (e.dados as { n: number }).n), [1, 2, 3, 4]);
    assert.deepEqual(await r.anexarEventos("nada", [ev(1)]), []);
    assert.deepEqual(await r.listarEventos("nada"), []);
  });

  it("imagens: numera, devolve os bytes, lista e limita", async () => {
    const r = novoRepositorio();
    const s = await nova(r);
    const img = (b: number) => ({ bytes: new Uint8Array([b, b + 1]), horario: `h${b}` });
    assert.equal(await r.salvarImagem(s.id, img(1)), 1);
    assert.equal(await r.salvarImagem(s.id, img(5)), 2);
    assert.deepEqual((await r.obterImagem(s.id, 2))!.bytes, new Uint8Array([5, 6]));
    assert.equal((await r.obterImagem(s.id, 2))!.horario, "h5");
    assert.equal(await r.obterImagem(s.id, 3), null);
    assert.deepEqual(await r.listarImagens(s.id), [{ numero: 1, horario: "h1" }, { numero: 2, horario: "h5" }]);
    for (let i = 3; i <= 60; i++) await r.salvarImagem(s.id, img(i));
    await assert.rejects(r.salvarImagem(s.id, img(99)), ErroLimite);
    const final = { bytes: new Uint8Array([8]), horario: "final" };
    await r.salvarImagem(s.id, final, { final: true });
    await r.salvarImagem(s.id, { ...final, horario: "final-2" }, { final: true });
    assert.equal((await r.listarImagens(s.id)).at(-1)?.horario, "final-2");
    await Promise.all([
      r.salvarImagem(s.id, { ...final, horario: "corrida-a" }, { final: true }),
      r.salvarImagem(s.id, { ...final, horario: "corrida-b" }, { final: true }),
    ]);
    const imagens = await r.listarImagens(s.id);
    assert.equal(imagens.filter((i) => i.horario.startsWith("corrida-")).length, 1);
    assert.equal((await r.obterImagem(s.id, imagens.at(-1)!.numero))?.horario, imagens.at(-1)!.horario);
    assert.equal((await r.obterImagem(s.id, imagens.at(-1)!.numero))?.final, true);
    await assert.rejects(r.salvarImagem("nada", img(1)), ErroLimite);
  });

  it("scorecard: um por sessão, e só para sessão que existe", async () => {
    const r = novoRepositorio();
    const s = await nova(r);
    assert.equal(await r.obterScorecard(s.id), null);
    const sc = { nota_geral: 3.2 } as never;
    await r.salvarScorecard(s.id, sc);
    assert.deepEqual(await r.obterScorecard(s.id), sc);
    await r.salvarScorecard("nada", sc);
    assert.equal(await r.obterScorecard("nada"), null);
  });
});
