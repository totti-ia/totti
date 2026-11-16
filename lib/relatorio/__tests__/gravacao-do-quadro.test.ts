import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventoArmazenado } from "@/lib/agente/armazenamento/repositorio";
import { gravacaoDoQuadro } from "../gravacao-do-quadro";

const base = Date.parse("2026-11-15T12:00:00.000Z");
function evento(segundo: number, tipo: string, dados: unknown): EventoArmazenado {
  return { horario: new Date(base + segundo * 1000).toISOString(), recebidoEm: base + segundo * 1000, tipo, dados };
}

describe("gravacaoDoQuadro com eventos persistidos pelo fluxo da entrevista", () => {
  it("consolida fala e resposta repetidas e preserva uma pergunta por evento pergunta", () => {
    const eventos = [
      evento(0, "fase", { fase: "REQUISITOS" }),
      evento(3, "fala", { quem: "agente", texto: "Como escala?" }),
      evento(4, "pergunta", { numero: 1, pergunta: "Como escala?", nota: "escala", elementos: ["API"], status: "feita", escopo: false }),
      evento(8, "fala", { quem: "candidato", texto: "Mil requisições por segundo." }),
      evento(8, "resposta", { numero: 1, quem: "candidato", texto: "Mil requisições por segundo." }),
      evento(12, "desenho", { grafo: "COMPONENTES:\n- [r1] API (retângulo)\n- [e1] Postgres (elipse)\nCONEXÕES:\n- [s1] API → Postgres", mudancas: "", imagem_url: "/imagem/1" }),
      evento(90, "fase", { fase: "FECHAMENTO" }),
      evento(91, "pergunta", { numero: 2, pergunta: "O que falta?", nota: "cache", elementos: ["Postgres"], status: "feita", escopo: false }),
    ];
    const g = gravacaoDoQuadro(eventos, [], base, "sessao");
    assert.equal(g.falas.filter(f => f.role === "candidate").length, 1);
    assert.equal(g.acontecimentos.filter(a => a.tipo === "pergunta").length, eventos.filter(e => e.tipo === "pergunta").length);
    assert.deepEqual(g.desenho.map(d => [d.pecas, d.conexoes]), [[2, 1]]);
    assert.equal(g.desenho[0].imagem, "/imagem/1");
    assert.equal(g.fases.find(f => f.nome === "Fechamento")?.t, 90_000);
  });

  it("consolida os dois eventos de desenho da mesma captura e mantém a foto", () => {
    const grafo = "COMPONENTES:\n- [r1] API (retângulo)\n- [e1] Postgres (elipse)\nCONEXÕES:\n- [s1] API → Postgres";
    const eventos = [
      evento(0, "fase", { fase: "REQUISITOS" }),
      // Sequência real do fluxo: snapshot antes de fotografar e outro evento com a imagem.
      evento(12, "desenho", { grafo, mudancas: "" }),
      evento(13, "desenho", { grafo, mudancas: "", imagem_url: "/imagem/captura" }),
    ];
    const g = gravacaoDoQuadro(eventos, [], base, "sessao");
    assert.equal(g.desenho.length, 1);
    assert.equal(g.desenho[0].t, 12_000);
    assert.deepEqual([g.desenho[0].pecas, g.desenho[0].conexoes], [2, 1]);
    assert.equal(g.desenho[0].imagem, "/imagem/captura");
  });

  it("só chama de intervalo sem atividade quando o Totti não estava falando", () => {
    const eventos = [
      evento(0, "fala", { quem: "candidato", texto: "Vou começar." }),
      evento(30, "fala", { quem: "agente", texto: "Pode ir com calma, considere a escala do sistema." }),
      evento(70, "fala", { quem: "candidato", texto: "Pronto." }),
      evento(180, "desenho", { grafo: "COMPONENTES:\n- [r1] API", mudancas: "" }),
    ];
    const g = gravacaoDoQuadro(eventos, [], base);
    assert.ok(!g.acontecimentos.some(a => a.tipo === "travou" && a.t === 0));
    assert.ok(g.acontecimentos.some(a => a.tipo === "travou" && a.t === 70_000 && a.fim === 180_000));
  });

  it("usa o começo e o fim da linha do tempo como limites das pausas longas", () => {
    const eventos = [
      evento(0, "fase", { fase: "REQUISITOS" }),
      evento(90, "fala", { quem: "candidato", texto: "Começo agora." }),
      evento(180, "fase", { fase: "FECHAMENTO" }),
    ];
    const g = gravacaoDoQuadro(eventos, [], base);
    assert.ok(g.acontecimentos.some(a => a.tipo === "travou" && a.t === 0 && a.fim === 90_000 && a.titulo === "Ficou 1 min 30 s parado"));
    assert.ok(g.acontecimentos.some(a => a.tipo === "travou" && a.t === 90_000 && a.fim === 180_000 && a.titulo === "Ficou 1 min 30 s parado"));
  });

  it("não associa foto futura nem foto antiga distante à versão do desenho", () => {
    const eventos = [evento(60, "desenho", { grafo: "COMPONENTES:\n- [r1] API", mudancas: "" })];
    const imgs = [{ numero: 1, horario: new Date(base + 61_000).toISOString() }, { numero: 2, horario: new Date(base + 1_000).toISOString() }];
    assert.equal(gravacaoDoQuadro(eventos, imgs, base, "sessao").desenho[0].imagem, null);
  });
});
