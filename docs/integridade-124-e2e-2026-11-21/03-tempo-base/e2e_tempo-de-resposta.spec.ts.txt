import { expect, test, type Page, type TestInfo } from "@playwright/test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import Relatorio from "../components/relatorio/Relatorio";
import { relatorioExemplo } from "../lib/session/relatorio-exemplo";
import { relatorioDaIde } from "../lib/relatorio/da-ide";
import { gravacaoDoQuadro } from "../lib/relatorio/gravacao-do-quadro";
import { integridadeDoQuadro } from "../lib/integridade/montar";
import type { EventoEntrada } from "../lib/agente/armazenamento/repositorio";
import { preparar, ouvindo, falas, emitir, type JanelaTeste } from "./helpers/voz-falsa";
import { prepararScribeFalso } from "./helpers/scribe-falso";

// Na main, copiar também os helpers e a config e definir TEMPO_RESPOSTA_BASE=1.
// Os mesmos gestos e POSTs são exercitados; só muda a expectativa do campo que a main não tem.
const base = process.env.TEMPO_RESPOSTA_BASE === "1";
type Sala = "ide" | "quadro";
type Fala = { texto: string; latenciaMs?: number };
type EventoIde = { type: string; role?: string; text?: string; latenciaMs?: number; by?: string };
const RESPOSTA = "Eu separo a entrada da API para explicar o caminho de cada solicitação.";
const PERGUNTA = "Como funciona a busca nesse algoritmo?";

async function prepararSala(page: Page, sala: Sala) {
  const posts: { rota: string; corpo: unknown }[] = [];
  const eventosIde: EventoIde[] = [];
  const eventosQuadro: EventoEntrada[] = [];
  const inicio = Date.now();
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    const rota = new URL(req.url()).pathname.replace(/\/api\/sessoes\/[^/]+\//, "/api/sessoes/:id/");
    let corpo: unknown;
    try { corpo = req.postDataJSON(); } catch { corpo = "[multipart ou corpo não JSON]"; }
    posts.push({ rota, corpo });
  });
  await preparar(page);
  await page.route("**/api/events", (rota) => {
    eventosIde.push(rota.request().postDataJSON());
    return rota.fulfill({ json: {} });
  });
  await page.route("**/api/blip/pending?**", (rota) => rota.fulfill({ json: {} }));
  await page.route("**/api/chat", (rota) => {
    const mensagens = rota.request().postDataJSON().messages as { role: string; text: string }[];
    const ultima = mensagens.findLast((m) => m.role === "candidate")?.text;
    return rota.fulfill({ json: ultima && ultima !== RESPOSTA
      ? { reply: PERGUNTA, commands: [], end: true }
      : { reply: "", commands: [], end: false, listening: true } });
  });
  await page.route("**/api/uso", (rota) => rota.fulfill({ json: {} }));
  await page.route("**/api/sessoes", (rota) => rota.fulfill({ json: {
    sessao_id: "tempo-e2e", area: "system design", apresentacao: null,
    problema: { titulo: "API", enunciado: "Desenhe uma API.", fala_do_desafio: "Desenhe uma API." },
    tempos: { REQUISITOS: 600, ALTO_NIVEL: 600, APROFUNDAMENTO: 600, FECHAMENTO: 180 },
  } }));
  await page.route("**/api/sessoes/*/eventos", (rota) => {
    eventosQuadro.push(...rota.request().postDataJSON().eventos);
    return rota.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/sessoes/*/analisar", (rota) => rota.fulfill({ json: { status: "ok", observacoes: [] } }));
  await page.route("**/api/sessoes/*/perguntar", (rota) => {
    const responder = rota.request().postDataJSON().texto !== RESPOSTA;
    return rota.fulfill({ json: { responder, texto: responder ? PERGUNTA : "", requisito: null, concluiu: responder } });
  });
  await page.route("**/api/sessoes/*/empecilho", (rota) => rota.fulfill({ json: { empecilho: null, motivo: null } }));
  await page.route("**/api/sessoes/*/imagens", (rota) => rota.fulfill({ json: { url: "/foto-tempo-e2e.png" } }));
  const resposta = (): Fala | undefined => {
    if (sala === "ide") {
      const e = eventosIde.find((e) => e.type === "speech" && e.role === "candidate" && e.text === RESPOSTA);
      return e ? { texto: e.text!, ...(e.latenciaMs !== undefined ? { latenciaMs: e.latenciaMs } : {}) } : undefined;
    }
    return eventosQuadro.filter((e) => e.tipo === "fala").map((e) => e.dados as Fala & { quem: string })
      .find((d) => d.quem === "candidato" && d.texto === RESPOSTA);
  };
  return { inicio, posts, eventosIde, eventosQuadro, resposta };
}

async function abrir(page: Page, sala: Sala, scribe?: Awaited<ReturnType<typeof prepararScribeFalso>>) {
  await page.goto(sala === "ide" ? "/entrevista" : "/entrevista/system-design");
  if (sala === "quadro") await page.getByRole("button", { name: "Começar", exact: true }).click();
  await expect.poll(async () => (await falas(page)).length).toBeGreaterThan(0);
  if (sala === "quadro") await expect(page.locator('[data-janela-chamada][data-fase="REQUISITOS"]')).toBeVisible({ timeout: 45000 });
  else await expect.poll(async () => (await falas(page)).some((f) => f.includes("pensa em voz alta"))).toBe(true);
  if (scribe) await expect.poll(scribe.conectado).toBe(true);
  else await expect.poll(() => ouvindo(page)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.falando)).toBe(false);
  await page.waitForTimeout(300);
  await page.evaluate(() => { (window as unknown as JanelaTeste).vozTeste.autoTerminar = false; });
  const chamar = "Você pode me perguntar sobre o caminho de entrada que eu estou explicando?";
  if (scribe) {
    await scribe.blocos(0.4, 3000);
    scribe.emitir(chamar);
  } else await emitir(page, chamar);
  await expect.poll(() => falas(page)).toContain(PERGUNTA);
  await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.falando)).toBe(true);
}

async function anexar(testInfo: TestInfo, dados: Awaited<ReturnType<typeof prepararSala>>) {
  const porRota: Record<string, number> = {};
  for (const p of dados.posts) porRota[p.rota] = (porRota[p.rota] ?? 0) + 1;
  await testInfo.attach("posts-por-rota.json", { contentType: "application/json", body: JSON.stringify({
    versao: base ? "base" : "124", porRota, pedidos: dados.posts,
    eventosIde: dados.eventosIde, eventosQuadro: dados.eventosQuadro,
  }, null, 2) });
}

for (const sala of ["ide", "quadro"] as const) {
  test(`${sala}: fim natural mede a primeira fala sem criar um envio de medida`, async ({ page }, testInfo) => {
    const dados = await prepararSala(page, sala);
    try {
      await abrir(page, sala);
      const fim = await page.evaluate(() => {
        (window as unknown as JanelaTeste).vozTeste.terminar();
        return Date.now();
      });
      await expect.poll(() => ouvindo(page)).toBe(true);
      await page.waitForTimeout(1500);
      const comeco = await page.evaluate((texto) => {
        const em = Date.now();
        (window as unknown as JanelaTeste).vozTeste.emitir(texto);
        return em;
      }, RESPOSTA);
      await expect.poll(dados.resposta).toBeDefined();
      const fala = dados.resposta()!;
      if (base) expect(fala).not.toHaveProperty("latenciaMs");
      else {
        expect(fala.latenciaMs).toBeGreaterThanOrEqual(1000);
        expect(Math.abs(fala.latenciaMs! - (comeco - fim))).toBeLessThan(700);
      }
      // Janela fixa após o mesmo gesto nas duas versões; inclui flush de eventos e rascunhos.
      await page.waitForTimeout(1200);
      if (sala === "quadro") {
        const gravacao = gravacaoDoQuadro(dados.eventosQuadro.map((e) => ({ ...e, recebidoEm: Date.parse(e.horario) })), [], dados.inicio);
        const gravada = gravacao.falas.find((f) => f.role === "candidate" && f.text === RESPOSTA);
        expect(gravada).toBeDefined();
        expect(gravada?.latenciaMs).toBe(fala.latenciaMs);
      }
      // Não supõe igualdade entre turnos interrompidos e normais. O anexo permite comparar
      // este MESMO cenário com a main, inclusive rotas adicionais desconhecidas deste teste.
    } finally { await anexar(testInfo, dados); }
    // Fora da janela de contagem dos POSTs, idêntica à execução na main.
    if (sala === "quadro" && !base) await conferirRelatorio(page, dados);
  });

  test(`${sala}: corte manual não envia latência`, async ({ page }, testInfo) => {
    const dados = await prepararSala(page, sala);
    try {
      await abrir(page, sala);
      // Dá tempo para o handler de Escape acompanhar o estado do player.
      await expect(page.getByRole("button", { name: /Interromper/ }).first()).toBeVisible();
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.falando)).toBe(false);
      await expect.poll(() => ouvindo(page)).toBe(true);
      await emitir(page, RESPOSTA);
      await expect.poll(dados.resposta).toBeDefined();
      expect(dados.resposta()).not.toHaveProperty("latenciaMs");
      if (sala === "ide") expect(dados.eventosIde.some((e) => e.type === "speech_interrupted" && e.by === "manual")).toBe(true);
      await page.waitForTimeout(1200);
    } finally { await anexar(testInfo, dados); }
  });

  test(`${sala}: voz sobreposta dispara o detector e não envia latência`, async ({ page }, testInfo) => {
    const dados = await prepararSala(page, sala);
    const scribe = await prepararScribeFalso(page);
    try {
      // Primeiro conecta em silêncio; depois segura a pergunta do Totti.
      await abrir(page, sala, scribe);
      await expect.poll(scribe.conectado).toBe(true);
      await expect(page.getByRole("button", { name: /Interromper/ }).first()).toBeVisible();
      await page.waitForTimeout(300);
      await scribe.blocos(0, 2500); // Ignorado inicial e linha de base em silêncio.
      await scribe.blocos(0.4, 700); // Acima do piso: interrompe pela vigília real.
      await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.falando)).toBe(false);
      await page.waitForTimeout(400); // Sala reativa o portão e reaproveita o trecho anterior.
      await scribe.blocos(0.4, 3000);
      scribe.emitir(RESPOSTA);
      await expect.poll(dados.resposta).toBeDefined();
      expect(dados.resposta()).not.toHaveProperty("latenciaMs");
      if (sala === "ide") expect(dados.eventosIde.some((e) => e.type === "speech_interrupted" && e.by === "voz")).toBe(true);
      await page.waitForTimeout(1200);
    } finally { await anexar(testInfo, dados); }
  });
}

/** Render complementar com os eventos capturados acima; não gera relatório por LLM. */
async function conferirRelatorio(page: Page, dados: Awaited<ReturnType<typeof prepararSala>>) {
  const report = relatorioExemplo();
  const semMedida = dados.eventosQuadro.map((e) => {
    if (!e.dados || typeof e.dados !== "object") return e;
    const d = { ...e.dados } as Record<string, unknown>;
    delete d.latenciaMs;
    return { ...e, dados: d };
  });
  const r = relatorioDaIde(report);
  const rSemMedida = relatorioDaIde(report);
  r.integridade = integridadeDoQuadro("tempo-e2e", dados.eventosQuadro, dados.inicio);
  rSemMedida.integridade = integridadeDoQuadro("tempo-e2e", semMedida, dados.inicio);
  expect(r.integridade?.temposDeResposta?.length).toBeGreaterThan(0);
  expect(r.notaGeral).toBe(rSemMedida.notaGeral);
  expect(r.recomendacao).toBe(rSemMedida.recomendacao);
  expect(r.criterios).toEqual(rSemMedida.criterios);
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const router = { back() {}, push() {}, replace() {}, forward() {}, refresh() {}, prefetch() {} };
  const render = (valor: typeof r) => renderToStaticMarkup(createElement(AppRouterContext.Provider,
    { value: router as never }, createElement(Relatorio, { r: valor, comDecisao: false })));
  // O HTML estático usa o componente de produção; não afirma testar carregamento ou hidratação da rota.
  await page.setContent(render(rSemMedida));
  const integridade = page.getByRole("region", { name: "Integridade", exact: true });
  await expect(integridade.getByRole("table")).toHaveCount(0);
  const cabecalhoSemMedida = await page.locator('header[data-secao="cabeçalho"]').innerText();
  await page.setContent(render(r));
  await expect(page.locator('header[data-secao="cabeçalho"]')).toHaveText(cabecalhoSemMedida, { useInnerText: true });
  await expect(integridade.getByRole("table")).toBeVisible();
  const linha = integridade.getByRole("row", { name: /Técnicas/ });
  await expect(linha).toBeVisible();
  const tecnica = r.integridade!.temposDeResposta!.find((d) => d.tipo === "tecnica")!;
  await expect(linha.getByRole("cell").nth(1)).toHaveText(`${(tecnica.medianaMs / 1000).toFixed(1)} s`);
}
