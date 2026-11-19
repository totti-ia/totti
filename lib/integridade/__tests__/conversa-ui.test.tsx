import assert from "node:assert/strict";
import { it } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import Relatorio from "../../../components/relatorio/Relatorio";
import { relatorioExemplo } from "../../session/relatorio-exemplo";
import { relatorioDaIde } from "../../relatorio/da-ide";
import { sinaisDaConversa } from "../conversa";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

it("o relatório mostra a distribuição mesmo sem sinal e mantém nota e recomendação", () => {
  const report = relatorioExemplo();
  const r = relatorioDaIde(report);
  const { sinais, temposDeResposta } = sinaisDaConversa([
    { t: 0, role: "agent", text: "Podemos seguir?" }, { t: 1000, role: "candidate", text: "Sim", latenciaMs: 300 },
    { t: 10_000, role: "agent", text: "Como funciona a busca nesse algoritmo?" }, { t: 20_000, role: "candidate", text: "Uso uma tabela", latenciaMs: 8000 },
  ]);
  r.integridade = { sinais, destaques: [], temposDeResposta };
  const router = { back() {}, push() {}, replace() {}, forward() {}, refresh() {}, prefetch() {} };
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, createElement(Relatorio, { r, comDecisao: false })));
  for (const texto of ["Conversa e confirmação", "Técnicas", "0.3 s", "8.0 s", "Nenhum sinal registrado nesta entrevista"]) assert.ok(html.includes(texto), texto);
  assert.equal(r.notaGeral, report.overallScore);
  assert.equal(r.recomendacao, report.recommendation);
});
