import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estadoInicial } from "../../sessao/estado";
import { criarRepositorioEmMemoria, ErroLimite, repositorioPadrao } from "../index";

const nova = (r: ReturnType<typeof criarRepositorioEmMemoria>) =>
  r.criar({ avaliacaoId: "demo", candidatoId: "c", estado: estadoInicial() });

describe("repositório em memória", () => {
  it("cria, obtém (cópia) e salva estado", async () => {
    const r = criarRepositorioEmMemoria();
    const s = await nova(r);
    const lido = await r.obter(s.id);
    assert.ok(lido);
    lido.estado.fase = "ENCERRADA"; // mexer na cópia não afeta o repositório
    assert.equal((await r.obter(s.id))!.estado.fase, "AGUARDANDO");
    await r.salvarEstado(s.id, { ...s.estado, fase: "REQUISITOS" });
    assert.equal((await r.obter(s.id))!.estado.fase, "REQUISITOS");
    assert.equal(await r.obter("nada"), null);
  });
  it("expulsa a sessão menos usada acima do limite (LRU)", async () => {
    const r = criarRepositorioEmMemoria({ maxSessoes: 3 });
    const a = await nova(r);
    const b = await nova(r);
    const c = await nova(r);
    await r.obter(a.id); // a vira a mais recente
    await nova(r);
    assert.equal(await r.obter(b.id), null);
    assert.ok(await r.obter(a.id));
    assert.ok(await r.obter(c.id));
  });
  it("limita eventos por sessão e deduplica", async () => {
    const r = criarRepositorioEmMemoria({ maxEventosPorSessao: 3 });
    const s = await nova(r);
    const ev = (n: number) => ({ horario: "2026-11-07T15:00:00Z", tipo: "fala", dados: { n } });
    assert.equal((await r.anexarEventos(s.id, [ev(1), ev(1), ev(2), ev(3), ev(4)])).length, 4);
    assert.deepEqual((await r.listarEventos(s.id)).map((e) => (e.dados as { n: number }).n), [2, 3, 4]);
  });
  it("limita imagens por sessão", async () => {
    const r = criarRepositorioEmMemoria({ maxImagensPorSessao: 60 });
    const s = await nova(r);
    const img = { bytes: new Uint8Array([1]), horario: "h" };
    for (let i = 0; i < 60; i++) await r.salvarImagem(s.id, img);
    await assert.rejects(r.salvarImagem(s.id, img), ErroLimite);
    await r.salvarImagem(s.id, { ...img, horario: "final" }, { final: true });
    await r.salvarImagem(s.id, { ...img, horario: "final-2" }, { final: true });
    await Promise.all([
      r.salvarImagem(s.id, { ...img, horario: "corrida-a" }, { final: true }),
      r.salvarImagem(s.id, { ...img, horario: "corrida-b" }, { final: true }),
    ]);
    const lista = await r.listarImagens(s.id);
    assert.equal(lista.length, 61);
    assert.equal(lista.filter((i) => i.horario.startsWith("corrida-")).length, 1);
    assert.match(lista.at(-1)?.horario ?? "", /^corrida-/);
    assert.equal((await r.obterImagem(s.id, lista.at(-1)!.numero))!.horario, lista.at(-1)!.horario);
    assert.equal((await r.obterImagem(s.id, lista.at(-1)!.numero))!.final, true);
  });
  it("o singleton sobrevive (globalThis)", () => {
    assert.equal(repositorioPadrao(), repositorioPadrao());
  });
});
