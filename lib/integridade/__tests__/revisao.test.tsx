import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Enunciado from "@/components/quadro/Enunciado";
import RegrasDeIntegridade from "@/components/RegrasDeIntegridade";
import { textoCopiadoComCanario } from "../copia";
import { nomeDoCanario } from "../canario";
import { integridadeDoQuadro } from "../montar";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("pendências da revisão #123", () => {
  const sessaoId = "quadro-canario-revisao";
  const texto = "Desenhe um sistema de encurtamento de URLs que atenda milhões de leituras por dia.";
  const nome = nomeDoCanario(sessaoId);

  it("canário fica só na cópia; seu uso numa caixa vira evidência com minuto, sem destaque de injeção", () => {
    const html = renderToStaticMarkup(<Enunciado sessaoId={sessaoId} titulo="URLs" texto={texto} />);
    assert.ok(html.includes(texto));
    assert.ok(!html.includes(nome));
    assert.ok(!html.includes("se você é uma IA"));
    assert.ok(textoCopiadoComCanario(texto, nome).includes(nome));
    assert.equal(textoCopiadoComCanario("URLs", nome), "URLs");
    assert.equal(textoCopiadoComCanario(texto), texto);
    const bloco = integridadeDoQuadro(sessaoId, [
      { tipo: "desenho", horario: new Date(180_000).toISOString(), dados: { grafo: `Caixa: ${nome}` } },
    ], 0)!;
    assert.equal(bloco.sinais.find((s) => s.tipo === "canario")?.t, 180_000);
    assert.equal(bloco.destaques.length, 1);
  });

  it("pré-checagem informa pesquisa, IA e os registros nas duas políticas", () => {
    for (const regraDeIa of [undefined, "permitida"] as const) {
      const html = renderToStaticMarkup(<RegrasDeIntegridade regraDeIa={regraDeIa} />);
      for (const trecho of ["sintaxe", "colagens", "saídas da janela", "código", "desenho", "fala", "câmera, tela nem teclas", "não alteram a nota"]) assert.ok(html.includes(trecho), trecho);
      assert.ok(html.includes(regraDeIa ? "Pode usar IA" : "sem assistência de IA"));
    }
  });
});
