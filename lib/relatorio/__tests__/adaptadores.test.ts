import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RelatorioVisto } from "@/lib/agente/relatorio";
import { RELATORIO_EXEMPLO, RELATORIO_EXEMPLO_NAO_AVANCAR } from "@/lib/agente/relatorio-exemplo";
import { GRAVACAO_EXEMPLO, relatorioExemplo } from "@/lib/session/relatorio-exemplo";
import { relatorioDaIde } from "../da-ide";
import { relatorioDoQuadro } from "../do-quadro";
import { duracaoCurta, momentoParaMs } from "../formato";

describe("formato", () => {
  it("converte mm:ss em milissegundos e recusa o que não é minuto", () => {
    assert.equal(momentoParaMs("01:12"), 72_000);
    assert.equal(momentoParaMs("00:00"), 0);
    assert.equal(momentoParaMs(null), null);
    assert.equal(momentoParaMs("abc"), null);
  });
  it("duração curta", () => {
    assert.equal(duracaoCurta(50_000), "50 s");
    assert.equal(duracaoCurta(120_000), "2 min");
    assert.equal(duracaoCurta(110_000), "1 min 50 s");
  });
});

describe("relatorioDoQuadro", () => {
  it("leva o relatório do quadro para o tipo comum", () => {
    const r = relatorioDoQuadro(RELATORIO_EXEMPLO);
    assert.equal(r.formato, "system_design");
    assert.equal(r.titulo, RELATORIO_EXEMPLO.problema);
    assert.equal(r.recomendacao, RELATORIO_EXEMPLO.recomendacao);
    assert.equal(r.notaGeral, RELATORIO_EXEMPLO.notaGeral);
    assert.equal(r.criterios.length, RELATORIO_EXEMPLO.criterios.length);
    assert.deepEqual(r.eliminatorios, []);
  });

  it("a prova de fala vira prova com o minuto em milissegundos", () => {
    const r = relatorioDoQuadro(RELATORIO_EXEMPLO);
    const prova = r.criterios[0].provas[0];
    assert.equal(prova.tipo, "fala");
    assert.equal(prova.t, 72_000); // "01:12"
    assert.ok(prova.texto.length > 0);
  });

  it("a prova de desenho guarda peças e foto, e o texto cai nas peças quando não há observação", () => {
    const base = RELATORIO_EXEMPLO;
    const visto: RelatorioVisto = {
      ...base,
      criterios: [
        {
          ...base.criterios[0],
          provas: [
            { tipo: "desenho", momento: "06:30", elementos: ["API", "Cache"], imagem: "/img/1", observacao: null },
            { tipo: "desenho", momento: null, elementos: [], imagem: null, observacao: "banco único sem cache" },
          ],
        },
      ],
    };
    const [a, b] = relatorioDoQuadro(visto).criterios[0].provas;
    assert.equal(a.texto, "No desenho: API, Cache");
    assert.deepEqual(a.elementos, ["API", "Cache"]);
    assert.equal(a.imagem, "/img/1");
    assert.equal(a.t, 390_000);
    assert.equal(b.t, null);
    assert.equal(b.texto, "banco único sem cache");
  });

  it("lê eliminatórios e origem das regras quando a outra frente os acrescentar", () => {
    const base = RELATORIO_EXEMPLO;
    const visto = {
      ...base,
      criterios: [{ ...base.criterios[0], aprendidoComOTime: [{ texto: "Valoriza quem pergunta a escala", efeito: "valoriza", origem: "empresa" }] }],
      eliminatorios: [
        {
          regra: "Cobrar duas vezes",
          status: "violada",
          justificativa: "Aceitou o pagamento sem checar a chave de idempotência.",
          provas: [{ tipo: "fala", momento: "10:05", texto: "Pode cobrar de novo." }],
        },
      ],
    } as unknown as RelatorioVisto;
    const r = relatorioDoQuadro(visto);
    assert.equal(r.eliminatorios.length, 1);
    assert.equal(r.eliminatorios[0].regra, "Cobrar duas vezes");
    assert.equal(r.eliminatorios[0].status, "violada");
    assert.equal(r.eliminatorios[0].provas[0].t, 605_000);
    assert.equal(r.criterios[0].regras[0].origem, "empresa");
  });

  it("sem origem na regra, o campo fica ausente", () => {
    const base = RELATORIO_EXEMPLO;
    const visto: RelatorioVisto = {
      ...base,
      criterios: [{ ...base.criterios[0], aprendidoComOTime: [{ texto: "x", efeito: "penaliza" }] }],
    };
    const regra = relatorioDoQuadro(visto).criterios[0].regras[0];
    assert.equal(regra.origem, undefined);
    assert.equal(regra.efeito, "penaliza");
  });

  it("critério sem nota continua sem nota e traz a justificativa", () => {
    const r = relatorioDoQuadro(RELATORIO_EXEMPLO_NAO_AVANCAR);
    for (const c of r.criterios) assert.equal(c.nota === null, RELATORIO_EXEMPLO_NAO_AVANCAR.criterios.find((x) => x.id === c.id)!.nota === null);
  });

  it("a mudança vira acontecimento na linha do tempo", () => {
    const r = relatorioDoQuadro(RELATORIO_EXEMPLO);
    if (RELATORIO_EXEMPLO.adaptacao?.momento) {
      assert.equal(r.acontecimentos[0].tipo, "mudanca");
      assert.equal(r.acontecimentos[0].t, momentoParaMs(RELATORIO_EXEMPLO.adaptacao.momento));
    } else {
      assert.equal(r.acontecimentos.length, 0);
    }
  });
});

describe("relatorioDaIde", () => {
  const report = relatorioExemplo();

  it("leva o Report para o tipo comum", () => {
    const r = relatorioDaIde(report, GRAVACAO_EXEMPLO);
    assert.equal(r.formato, "live_coding");
    assert.equal(r.titulo, report.roleTitle);
    assert.equal(r.recomendacao, report.recommendation);
    assert.equal(r.notaGeral, report.overallScore);
    assert.equal(r.criterios.length, report.criteria.length);
    assert.equal(r.proximosPassos.length, report.nextSteps.length);
    assert.equal(r.resumo, report.summary);
  });

  it("as provas mantêm o tempo em milissegundos", () => {
    const r = relatorioDaIde(report, GRAVACAO_EXEMPLO);
    const evidencia = report.criteria[0].evidence[0];
    assert.equal(r.criterios[0].provas[0].t, evidencia.t);
    assert.equal(r.criterios[0].provas[0].texto, evidencia.text);
  });

  it("critério sem nota não tem prova e usa a evidência como explicação", () => {
    const r = relatorioDaIde(
      { ...report, criteria: [{ id: "x", name: "X", score: null, evidence: [{ t: 1000, text: "Não chegou a ser tratado." }] }] },
      null,
    );
    assert.equal(r.criterios[0].nota, null);
    assert.deepEqual(r.criterios[0].provas, []);
    assert.equal(r.criterios[0].justificativa, "Não chegou a ser tratado.");
  });

  it("os fatos trazem os testes escondidos e a duração", () => {
    const r = relatorioDaIde(report, GRAVACAO_EXEMPLO);
    const testes = r.fatos.find((f) => f.nome === "Testes escondidos");
    assert.equal(testes?.valor, `${report.signals.testsPassed} de ${report.signals.testsTotal}`);
    assert.ok(r.fatos.some((f) => f.nome === "Duração"));
  });

  it("a mudança vira adaptação e acontecimentos (mudança e adaptou)", () => {
    const r = relatorioDaIde(report, GRAVACAO_EXEMPLO);
    if (!report.adaptation) return;
    assert.ok(r.adaptacao);
    assert.equal(r.adaptacao.anunciadaEm, report.adaptation.announcedAt);
    assert.ok(r.acontecimentos.some((a) => a.tipo === "mudanca"));
  });

  it("os acontecimentos incluem as colagens da gravação", () => {
    const grav = { ...GRAVACAO_EXEMPLO, marcos: [...GRAVACAO_EXEMPLO.marcos, { t: 5000, text: "Colou 12 linhas de código", tipo: "colagem" as const }] };
    const r = relatorioDaIde(report, grav);
    assert.ok(r.acontecimentos.some((a) => a.tipo === "colagem" && a.t === 5000));
  });

  it("o aprendizado vira momentos em ordem de tempo", () => {
    if (!report.learning) return;
    const r = relatorioDaIde(report, GRAVACAO_EXEMPLO);
    assert.ok(r.aprendizado);
    const ts = r.aprendizado.momentos.map((m) => m.t);
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  });
});
