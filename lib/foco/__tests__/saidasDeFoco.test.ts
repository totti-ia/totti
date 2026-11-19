import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { ignorarFocoDurante, RegistroDeFoco } from "../saidasDeFoco";
import { eventoDeFoco } from "../eventoDoQuadro";

afterEach(() => {
  mock.timers.reset();
});

describe("RegistroDeFoco", () => {
  it("registra a saída com início, duração e motivo", () => {
    const r = new RegistroDeFoco();
    r.saiu("janela", 1_000);
    r.voltou(31_000);
    assert.deepEqual(r.esvaziar(), [{ inicioEm: 1_000, duracaoMs: 30_000, motivo: "janela" }]);
    assert.deepEqual(r.esvaziar(), []);
  });

  it("trocar de aba (blur e depois hidden) é uma saída só, com motivo aba", () => {
    const r = new RegistroDeFoco();
    r.saiu("janela", 0);
    r.saiu("aba", 5);
    r.voltou(2_000);
    assert.deepEqual(r.esvaziar(), [{ inicioEm: 0, duracaoMs: 2_000, motivo: "aba" }]);
  });

  it("guarda saídas muito curtas, mas não as de duração zero", () => {
    const r = new RegistroDeFoco();
    r.saiu("janela", 100);
    r.voltou(100);
    r.saiu("janela", 200);
    r.voltou(350);
    assert.deepEqual(r.esvaziar(), [{ inicioEm: 200, duracaoMs: 150, motivo: "janela" }]);
  });

  it("voltar sem ter saído não registra nada", () => {
    const r = new RegistroDeFoco();
    r.voltou(500);
    assert.deepEqual(r.esvaziar(), []);
  });

  it("a saída aberta só vai no envio seguinte, e o encerrar fecha ela", () => {
    const r = new RegistroDeFoco();
    r.saiu("aba", 0);
    assert.deepEqual(r.esvaziar(), []);
    assert.deepEqual(r.encerrar(4_000), [{ inicioEm: 0, duracaoMs: 4_000, motivo: "aba" }]);
  });

  it("devolver põe as saídas de um envio que falhou na frente das novas", () => {
    const r = new RegistroDeFoco();
    r.saiu("aba", 0);
    r.voltou(10);
    const lote = r.esvaziar();
    r.saiu("janela", 20);
    r.voltou(30);
    r.devolver(lote);
    assert.deepEqual(r.esvaziar().map((s) => s.inicioEm), [0, 20]);
  });

  it("o diálogo do microfone não conta como saída", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const r = new RegistroDeFoco();
    await ignorarFocoDurante(async () => {
      r.saiu("janela", 0);
      r.voltou(3_000);
    });
    mock.timers.tick(600);
    r.saiu("janela", 5_000);
    r.voltou(6_000);
    assert.deepEqual(r.esvaziar(), [{ inicioEm: 5_000, duracaoMs: 1_000, motivo: "janela" }]);
  });
});

describe("eventoDeFoco", () => {
  it("monta o item do lote do quadro com o início em ISO", () => {
    const ev = eventoDeFoco([{ inicioEm: Date.UTC(2026, 10, 14, 12, 0, 0), duracaoMs: 30_000, motivo: "aba" }]);
    assert.equal(ev.tipo, "foco");
    assert.deepEqual(ev.dados, { saidas: [{ inicio: "2026-11-14T12:00:00.000Z", duracaoMs: 30_000, motivo: "aba" }] });
  });
});
