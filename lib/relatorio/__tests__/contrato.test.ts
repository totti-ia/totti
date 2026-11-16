import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMs } from "@/lib/format";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import Relatorio from "@/components/relatorio/Relatorio";
import HistoriaDaEntrevista, { instanteDoAcontecimento, instanteDoPontoDoQuadro } from "@/components/report/HistoriaDaEntrevista";
import { RELATORIO_EXEMPLO_QUADRO } from "@/lib/agente/relatorio-exemplo";
import { GRAVACAO_EXEMPLO, relatorioExemplo } from "@/lib/session/relatorio-exemplo";
import { relatorioDaIde } from "../da-ide";
import { estimativaTempoDesenhandoFalando, MOSTRAR_TEMPO_DESENHANDO_FALANDO, relatorioDoQuadro } from "../do-quadro";
import { gravacaoDoQuadro } from "../gravacao-do-quadro";
import { SECOES_CONDICIONAIS_DO_RELATORIO, SECOES_DO_RELATORIO } from "../tipos";

describe("contrato comum do relatório", () => {
  it("renderiza todas as seções dos dois formatos na ordem declarada", () => {
    // tsx preserva a transformação JSX deste repositório como clássica; disponibiliza React para SSR de componentes client.
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const relatorios = [
      relatorioDaIde(relatorioExemplo(), GRAVACAO_EXEMPLO),
      relatorioDoQuadro(RELATORIO_EXEMPLO_QUADRO),
    ];
    for (const r of relatorios) {
      const router = { back() {}, push() {}, replace() {}, forward() {}, refresh() {}, prefetch() {}, canGoBack: false };
      const tree = createElement(AppRouterContext.Provider, { value: router as never }, createElement(Relatorio, { r, comDecisao: false }));
      const html = renderToStaticMarkup(tree);
      const secao = [...html.matchAll(/data-secao="([^"]+)"/g)].map(m => m[1]);
      for (const nome of SECOES_DO_RELATORIO) assert.ok(secao.includes(nome), `${r.formato}: seção ausente: ${nome}`);
      if (r.adaptacao) assert.ok(secao.includes("adaptação"), `${r.formato}: seção de adaptação ausente`);
      else for (const nome of SECOES_CONDICIONAIS_DO_RELATORIO) assert.ok(!secao.includes(nome), `${r.formato}: seção condicional inesperada: ${nome}`);
      assert.deepEqual(secao.filter(nome => (SECOES_DO_RELATORIO as readonly string[]).includes(nome)), [...SECOES_DO_RELATORIO], `${r.formato}: ordem das seções`);
      assert.ok(r.duracaoMs !== null && r.duracaoMs > 0);
      const nomesEsperados = r.formato === "live_coding" ? ["Candidato", "Totti", "Código"] : ["Candidato", "Totti", "Desenho"];
      for (const nome of nomesEsperados) assert.ok(r.faixas?.some(f => f.nome === nome && f.marcas.length > 0), `${r.formato}: faixa ${nome} sem marcas`);
      assert.ok(r.serie, `história ausente em ${r.formato}`);
      if (r.formato === "system_design") {
        assert.ok((r.fases ?? []).length >= 2, "quadro: fases ausentes");
        assert.ok(r.acontecimentos.some(a => a.tipo === "pergunta"), "quadro: acontecimentos sem perguntas");
        const perguntasRegistradas = r.gravacaoQuadro?.acontecimentos.filter(a => a.tipo === "pergunta").length;
        assert.equal(perguntasRegistradas, r.perguntasEsperadas, "quadro: perguntas da gravação divergem do total independente da sessão");
      }
    }
  });

  it("mantém os pontos e marcas do gráfico de live coding iguais à gravação", () => {
    const r = relatorioDaIde(relatorioExemplo(), GRAVACAO_EXEMPLO);
    assert.deepEqual(r.serie?.pontos, GRAVACAO_EXEMPLO.execucoes.map(e => ({ t: e.t, valor: e.total ? e.passed / e.total : 0 })));
    assert.deepEqual(r.faixas, [
      { nome: "Candidato", marcas: GRAVACAO_EXEMPLO.falas.filter(f => f.role === "candidate").map(f => f.t) },
      { nome: "Totti", marcas: GRAVACAO_EXEMPLO.falas.filter(f => f.role === "agent").map(f => f.t) },
      { nome: "Código", marcas: GRAVACAO_EXEMPLO.codigo.map(c => c.t) },
    ]);
  });

  it("torna cada ponto e acontecimento do quadro abrível no próprio instante", () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const r = relatorioDoQuadro(RELATORIO_EXEMPLO_QUADRO);
    const html = renderToStaticMarkup(createElement(HistoriaDaEntrevista, {
      duracao: r.duracaoMs ?? 0,
      gravacao: null,
      acontecimentos: r.acontecimentos.map(a => ({ ...a, momento: a.t })),
      serie: r.serie,
      faixasNeutras: r.faixas,
      fases: r.fases,
      falasNeutras: r.gravacaoQuadro?.falas,
      onAbrir: () => {},
    }));
    assert.deepEqual(r.serie?.pontos.map(p => p.t), r.gravacaoQuadro?.desenho.map(d => d.t));
    for (const ponto of r.serie?.pontos ?? []) assert.equal(instanteDoPontoDoQuadro(ponto.t), ponto.t);
    for (const acontecimento of r.acontecimentos) {
      assert.ok(html.includes(`aria-label="${formatMs(acontecimento.t)}: ${acontecimento.titulo}. Abrir`));
      assert.equal(instanteDoAcontecimento({ ...acontecimento, momento: acontecimento.t }), acontecimento.t);
    }
  });

  it("mantém a renderização SSR de live coding igual à saída de gio/main", () => {
    // Regenerar ambas as fixtures com: TMPDIR=/tmp node --import tsx lib/relatorio/__tests__/fixtures/gerar-historia-gio-main.ts
    // O gerador extrai o componente com `git show gio/main:...` e renderiza os dois casos com os dados do repositório.
    const r = relatorioDaIde(relatorioExemplo(), GRAVACAO_EXEMPLO);
    const acontecimentos = r.acontecimentos.map((a, i) => ({ ...a, momento: i }));
    const html = renderToStaticMarkup(createElement(HistoriaDaEntrevista, {
      duracao: GRAVACAO_EXEMPLO.durationMs,
      gravacao: GRAVACAO_EXEMPLO,
      acontecimentos,
      serie: r.serie,
      faixasNeutras: r.faixas,
      fases: r.fases,
    }));
    assert.equal(html, readFileSync("lib/relatorio/__tests__/fixtures/historia-live-gio-main.html", "utf8"));
  });

  it("preserva a mensagem de live coding sem gravação da baseline gio/main", () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const r = relatorioDaIde(relatorioExemplo(), null);
    const html = renderToStaticMarkup(createElement(HistoriaDaEntrevista, {
      duracao: r.duracaoMs ?? 0,
      gravacao: null,
      acontecimentos: r.acontecimentos,
    }));
    assert.equal(html, readFileSync("lib/relatorio/__tests__/fixtures/historia-live-sem-gravacao-gio-main.html", "utf8"));
    assert.match(html, /Ele não rodou o código nesta entrevista/);
  });

  it("detecta pergunta perdida comparando a gravação com o total independente da sessão", () => {
    // Formatos registrados em useEntrevista: pergunta com numero/pergunta/nota/elementos/status/escopo,
    // fala e resposta com quem/texto, desenho com grafo/mudancas/imagem_url e fase com fase.
    const inicio = Date.parse("2026-11-15T12:00:00.000Z");
    const eventos = [
      { horario: new Date(inicio).toISOString(), recebidoEm: inicio, tipo: "fase", dados: { fase: "REQUISITOS" } },
      { horario: new Date(inicio + 2_000).toISOString(), recebidoEm: inicio + 2_000, tipo: "pergunta", dados: { numero: 1, pergunta: "Qual escala?", nota: "escala", elementos: ["API"], status: "feita", escopo: false } },
      { horario: new Date(inicio + 3_000).toISOString(), recebidoEm: inicio + 3_000, tipo: "fase", dados: { fase: "ALTO_NIVEL" } },
      { horario: new Date(inicio + 4_000).toISOString(), recebidoEm: inicio + 4_000, tipo: "pergunta", dados: { numero: 2, pergunta: "Quais peças?", nota: "fluxo", elementos: ["API"], status: "feita", escopo: false } },
      { horario: new Date(inicio + 5_000).toISOString(), recebidoEm: inicio + 5_000, tipo: "resposta", dados: { numero: 1, quem: "candidato", texto: "Mil por segundo." } },
      { horario: new Date(inicio + 6_000).toISOString(), recebidoEm: inicio + 6_000, tipo: "fala", dados: { quem: "candidato", texto: "Mil por segundo." } },
      { horario: new Date(inicio + 8_000).toISOString(), recebidoEm: inicio + 8_000, tipo: "desenho", dados: { grafo: "COMPONENTES:\n- [r1] API (retângulo)\n- [e1] Postgres (elipse)\nCONEXÕES:\n- [s1] API → Postgres", mudancas: "" } },
      { horario: new Date(inicio + 10_000).toISOString(), recebidoEm: inicio + 10_000, tipo: "fase", dados: { fase: "FECHAMENTO" } },
      { horario: new Date(inicio + 11_000).toISOString(), recebidoEm: inicio + 11_000, tipo: "pergunta", dados: { numero: 3, pergunta: "E cache?", nota: "cache", elementos: ["Postgres"], status: "feita", escopo: false } },
    ];
    const eventosCarregados = eventos.filter(e => !(e.tipo === "pergunta" && (e.dados as { numero?: number }).numero === 1));
    const g = gravacaoDoQuadro(eventosCarregados, [], inicio, "teste");
    assert.equal(g.acontecimentos.filter(a => a.tipo === "pergunta").length, eventosCarregados.filter(e => e.tipo === "pergunta").length);
    assert.deepEqual(g.desenho.map(d => [d.pecas, d.conexoes]), [[2, 1]]);
    assert.equal(g.falas.filter(f => f.role === "candidate").length, 1);
    // O estado persistido da sessão registra três perguntas, mas uma se perdeu dos eventos carregados.
    const perguntasFeitasNaSessao = 3;
    const quadro = relatorioDoQuadro({ ...RELATORIO_EXEMPLO_QUADRO, perguntas: perguntasFeitasNaSessao, gravacao: g });
    const perguntasRegistradas = quadro.acontecimentos.filter(a => a.tipo === "pergunta").length;
    assert.notEqual(perguntasRegistradas, quadro.perguntasEsperadas, "o contrato deve detectar a gravação incompleta");
    const router = { back() {}, push() {}, replace() {}, forward() {}, refresh() {}, prefetch() {}, canGoBack: false };
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, createElement(Relatorio, { r: quadro, comDecisao: false })));
    assert.match(html, /Há uma divergência entre as perguntas registradas na linha do tempo e o total do relatório\./);
    assert.deepEqual(quadro.faixas?.map(f => f.nome), ["Candidato", "Totti", "Desenho"]);
    assert.deepEqual(quadro.fases?.map(f => f.nome), ["Requisitos", "Alto nível", "Fechamento"]);
    assert.equal(quadro.fatos.find(f => f.nome === "Perguntas durante o desenho")?.valor, "1");
    assert.equal(quadro.fatos.find(f => f.nome === "Perguntas no fechamento")?.valor, "1");
  });

  it("exibe a estimativa aproximada quando há dados e omite sem dados suficientes", () => {
    const estimativa = estimativaTempoDesenhandoFalando(RELATORIO_EXEMPLO_QUADRO);
    assert.ok(estimativa);
    assert.equal(estimativa.nome, "tempo desenhando × falando");
    assert.equal(MOSTRAR_TEMPO_DESENHANDO_FALANDO, true);
    const r = relatorioDoQuadro(RELATORIO_EXEMPLO_QUADRO);
    const fato = r.fatos.find(f => f.nome === "tempo desenhando × falando");
    assert.ok(fato);
    assert.match(fato.valor, /^aprox\./);

    const semDados = relatorioDoQuadro({
      ...RELATORIO_EXEMPLO_QUADRO,
      gravacao: { ...RELATORIO_EXEMPLO_QUADRO.gravacao!, desenho: [], falas: [] },
    });
    assert.ok(!semDados.fatos.some(f => f.nome === "tempo desenhando × falando"));
  });
});
