import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GRAVACAO_EXEMPLO, relatorioExemplo } from "@/lib/session/relatorio-exemplo";
import { relatorioDaIde } from "../../da-ide";

const fixtureDir = fileURLToPath(new URL(".", import.meta.url));
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const baselinePath = `${fixtureDir}/HistoriaDaEntrevista.gio-main.tmp.tsx`;
const source = execFileSync("git", ["show", "gio/main:components/report/HistoriaDaEntrevista.tsx"], { encoding: "utf8" });
writeFileSync(baselinePath, source);

(async () => {
try {
  const { default: HistoriaDaEntrevista } = await import(pathToFileURL(baselinePath).href);
  const r = relatorioDaIde(relatorioExemplo(), GRAVACAO_EXEMPLO);
  const gravada = renderToStaticMarkup(createElement(HistoriaDaEntrevista, {
    duracao: GRAVACAO_EXEMPLO.durationMs,
    gravacao: GRAVACAO_EXEMPLO,
    acontecimentos: r.acontecimentos.map((a, i) => ({ ...a, momento: i })),
  }));
  const semGravacao = renderToStaticMarkup(createElement(HistoriaDaEntrevista, {
    duracao: r.duracaoMs ?? 0,
    gravacao: null,
    acontecimentos: r.acontecimentos,
  }));
  writeFileSync(`${fixtureDir}/historia-live-gio-main.html`, gravada);
  writeFileSync(`${fixtureDir}/historia-live-sem-gravacao-gio-main.html`, semGravacao);
  console.log("Fixtures de HistoriaDaEntrevista geradas a partir de gio/main.");
} finally {
  unlinkSync(baselinePath);
}
})().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
