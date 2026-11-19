import { expect, test, type Page } from "@playwright/test";
import { integridadeDoQuadro } from "../lib/integridade/montar";
import type { EventoEntrada } from "../lib/agente/armazenamento/repositorio";

type Controle = {
  reter: boolean; tocando: boolean; ouvindo: boolean; falas: string[]; fila: string[];
  terminar: () => void; emitir: (texto: string) => void;
};
type JanelaTeste = Window & { fechamentoTeste: Controle };
const DESPEDIDA = "Então a gente encerra por aqui. Obrigado pelo seu tempo e pela conversa. O retorno vem de quem está cuidando do processo.";

function bytesDaImagem(formulario: Buffer | null): Buffer | null {
  if (!formulario) return null;
  const inicio = formulario.indexOf(Buffer.from("\r\n\r\n"));
  if (inicio < 0) return null;
  const png = formulario.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), inicio + 4);
  if (png < 0) return null;
  const fim = formulario.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]), png);
  return fim < 0 ? null : formulario.subarray(png, fim + 8);
}

async function desenharPeca(page: Page, indice: number) {
  const x = 300 + (indice % 8) * 115;
  const y = 140 + Math.floor(indice / 8) * 65;
  await page.getByRole("radio", { name: "Retângulo", exact: true }).locator("..").click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y + 35, { steps: 2 });
  await page.mouse.up();
}

async function preparar(page: Page, opcoes: { falharFotoFinal?: boolean; enunciado?: string } = {}) {
  const eventosDaSessao: EventoEntrada[] = [];
  const pedidos: { finalizar: number; falas: string[]; fotosFinais: number; fotosIntermediarias: number; analises: number; eventos: string[]; grafos: string[]; corpoFinal?: string; imagemFinal: Buffer | null; imagemIntermediaria: Buffer | null } = { finalizar: 0, falas: [], fotosFinais: 0, fotosIntermediarias: 0, analises: 0, eventos: [], grafos: [], imagemFinal: null, imagemIntermediaria: null };
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  await page.addInitScript(() => {
    let audio: AudioFalso | null = null;
    let fala: FalaFalsa | null = null;
    let reconhecimento: ReconhecimentoFalso | null = null;
    const controle: Controle = {
      reter: false, tocando: false, ouvindo: false, falas: [], fila: [],
      terminar: () => {
        const atual = audio; audio = null;
        const atualFala = fala; fala = null;
        controle.tocando = false;
        atual?.onended?.();
        atualFala?.onend?.();
      },
      emitir: (texto) => reconhecimento?.emitir(texto),
    };
    class FalaFalsa {
      lang = ""; rate = 1; voice: SpeechSynthesisVoice | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onboundary: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    class AudioFalso {
      src = ""; preload = ""; currentTime = 0; readyState = 4;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src = "") { this.src = src; }
      async play() {
        if (this.src.startsWith("data:")) return;
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- O controle externo termina a instância do player falso.
        audio = this; controle.tocando = true;
        controle.falas.push(controle.fila.shift() ?? "");
        if (!controle.reter) setTimeout(() => { if (audio === this) controle.terminar(); }, 20);
      }
      pause() { if (audio === this) { audio = null; controle.tocando = false; } }
      removeAttribute(nome: string) { if (nome === "src") this.src = ""; }
    }
    class ReconhecimentoFalso {
      onstart: (() => void) | null = null; onend: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null; onerror: (() => void) | null = null;
      resultados: unknown[] = [];
      start() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- O teste injeta a transcrição nesta instância ativa.
        reconhecimento = this; controle.ouvindo = true; this.onstart?.();
      }
      abort() { controle.ouvindo = false; this.onend?.(); }
      stop() { this.abort(); }
      emitir(texto: string) {
        if (!controle.ouvindo) return;
        const i = this.resultados.length;
        this.resultados.push({ isFinal: true, 0: { transcript: texto } });
        this.onresult?.({ resultIndex: i, results: this.resultados });
      }
    }
    Object.defineProperty(window, "Audio", { configurable: true, value: AudioFalso });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FalaFalsa });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => [],
      cancel: () => { fala = null; controle.tocando = false; },
      speak: (utterance: FalaFalsa) => {
        fala = utterance;
        controle.tocando = true;
        controle.falas.push(utterance.text);
        if (!controle.reter) setTimeout(() => { if (fala === utterance) controle.terminar(); }, 20);
      },
    } });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: ReconhecimentoFalso });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: ReconhecimentoFalso });
    (window as unknown as JanelaTeste).fechamentoTeste = controle;
  });
  await page.route("**/api/sessoes", (r) => r.fulfill({ json: {
    sessao_id: "teste-fechamento", area: "system design", apresentacao: "Vamos começar.",
    problema: { titulo: "API", enunciado: opcoes.enunciado ?? "Desenhe uma API.", fala_do_desafio: "Desenhe uma API." },
    tempos: { REQUISITOS: 600, ALTO_NIVEL: 600, APROFUNDAMENTO: 600, FECHAMENTO: 180 },
  } }));
  await page.route("**/api/sessoes/*/eventos", (r) => {
    const corpo = r.request().postDataJSON() as { eventos: (EventoEntrada & { dados: { quem?: string; texto?: string; grafo?: string } })[] };
    eventosDaSessao.push(...corpo.eventos);
    pedidos.eventos.push(...corpo.eventos.map((e) => e.tipo));
    for (const e of corpo.eventos) if (e.tipo === "fala" && e.dados.quem === "agente" && e.dados.texto) pedidos.falas.push(e.dados.texto);
    for (const e of corpo.eventos) if (e.tipo === "desenho" && e.dados.grafo) pedidos.grafos.push(e.dados.grafo);
    return r.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/sessoes/*/finalizar", (r) => { pedidos.finalizar++; return r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/sessoes/*/analisar", (r) => { pedidos.analises++; return r.fulfill({ json: { status: "ok", observacoes: [] } }); });
  await page.route("**/api/sessoes/*/empecilho", (r) => r.fulfill({ json: { empecilho: null, motivo: "problema sem mudança prevista" } }));
  await page.route("**/api/sessoes/*/imagens", async (r) => {
    const corpo = r.request().postData() ?? "";
    if (corpo.includes('name="final"\r\n\r\n1')) {
      pedidos.fotosFinais++;
      pedidos.corpoFinal = corpo;
      pedidos.imagemFinal = bytesDaImagem(r.request().postDataBuffer());
      if (opcoes.falharFotoFinal) return r.fulfill({ status: 500, json: { erro: "falha de teste" } });
    } else {
      pedidos.fotosIntermediarias++;
      pedidos.imagemIntermediaria = bytesDaImagem(r.request().postDataBuffer());
      // Simula o repositório da sessão: 60 fotos intermediárias e sempre aceita/substitui a final.
      if (pedidos.fotosIntermediarias > 60) return r.fulfill({ status: 429, json: { erro: "limite de imagens da sessão" } });
    }
    return r.fulfill({ json: { url: "/prova-do-quadro.png" } });
  });
  await page.route("**/api/stt-token?**", (r) => r.fulfill({ status: 501, json: { erro: "sem transcrição paga no teste" } }));
  await page.route("**/api/falar", async (r) => {
    const { texto } = r.request().postDataJSON() as { texto: string };
    await page.evaluate((t) => (window as unknown as JanelaTeste).fechamentoTeste.fila.push(t), texto);
    const chars = [...texto];
    return r.fulfill({ json: { audio_base64: Buffer.from(texto).toString("base64"), alinhamento: {
      characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.01), character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.01),
    } } });
  });
  await page.goto("/entrevista/system-design");
  await expect(page.getByRole("button", { name: "Começar", exact: true })).toBeEnabled();
  // No modo demonstração a apresentação usa speechSynthesis; controlar o fim evita depender da voz do navegador.
  await page.evaluate(() => { (window as unknown as JanelaTeste).fechamentoTeste.reter = true; });
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  for (let fala = 1; fala <= 2; fala++) {
    await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).fechamentoTeste.falas.length)).toBe(fala);
    await page.evaluate(() => (window as unknown as JanelaTeste).fechamentoTeste.terminar());
  }
  await expect(page.locator('[data-janela-chamada][data-fase="REQUISITOS"]')).toBeVisible({ timeout: 40000 });
  await page.evaluate(() => { (window as unknown as JanelaTeste).fechamentoTeste.reter = false; });
  return { pedidos, erros, eventosDaSessao };
}

async function botaoEncerrar(page: Page) {
  await page.getByRole("button", { name: "Encerrar entrevista" }).click();
  await page.getByRole("button", { name: "Encerrar", exact: true }).click();
}

test("integridade: canário só na cópia selecionada do enunciado, fora da cena e das falas", async ({ page }) => {
  const texto = "Desenhe uma API de encurtamento de URLs para milhões de leituras diárias e explique suas decisões.";
  const { pedidos, erros } = await preparar(page, { enunciado: texto });
  const painel = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Enunciado$/ }) });
  await painel.locator("summary").click();
  const copia = await painel.locator("p").evaluate((p) => {
    const range = document.createRange();
    range.selectNodeContents(p);
    const selecao = window.getSelection()!;
    selecao.removeAllRanges();
    selecao.addRange(range);
    const clipboardData = new DataTransfer();
    p.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData }));
    return clipboardData.getData("text/plain");
  });
  expect(copia).toContain(texto);
  expect(copia).toMatch(/aux_qv\w+/);
  await expect(page.locator("body")).not.toContainText(/aux_qv\w+/);
  const cena = await page.evaluate(() => {
    const q = (window as unknown as { quadro: { api: { getSceneElements(): unknown[] } } }).quadro;
    return JSON.stringify(q.api.getSceneElements());
  });
  expect(cena).not.toMatch(/aux_qv\w+/);
  expect(pedidos.falas.join(" ")).not.toMatch(/aux_qv\w+/);
  expect(pedidos.grafos.join(" ")).not.toMatch(/aux_qv\w+/);
  await page.screenshot({ path: "test-results/integridade-enunciado-quadro.png" });
  expect(erros).toEqual([]);
});

test("botão: quadro visível e bloqueado até áudio terminar, finalizar uma vez e depois obrigado", async ({ page }) => {
  const { pedidos, erros, eventosDaSessao } = await preparar(page);
  await page.getByRole("radio", { name: "Retângulo", exact: true }).locator("..").click();
  await expect(page.getByRole("radio", { name: "Retângulo", exact: true })).toBeChecked();
  await page.mouse.move(650, 340); await page.mouse.down();
  await page.mouse.move(850, 440, { steps: 5 }); await page.mouse.up();
  const contarPecas = () => page.evaluate(() => {
    const q = (window as unknown as { quadro: { api: { getSceneElements(): { isDeleted?: boolean; customData?: { autor?: string } }[] } } }).quadro;
    return q.api.getSceneElements().filter((e) => !e.isDeleted && e.customData?.autor !== "agente").length;
  });
  await expect.poll(contarPecas).toBeGreaterThan(0);
  const pecas = await contarPecas();
  await page.evaluate(() => { (window as unknown as JanelaTeste).fechamentoTeste.reter = true; });
  await botaoEncerrar(page);
  const sala = page.locator("main[data-despedindo=true]");
  await expect(sala).toBeVisible();
  await expect(sala.getByRole("status")).toContainText("Obrigado pelo seu tempo");
  await expect(sala.locator(".excalidraw")).toBeVisible();
  await page.keyboard.press("Delete");
  expect(await contarPecas()).toBe(pecas);
  await expect(page.getByRole("heading", { name: "Entrevista encerrada" })).toHaveCount(0);
  await expect.poll(() => pedidos.finalizar).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).fechamentoTeste.tocando)).toBe(true);
  await page.waitForTimeout(4200);
  expect(page.url()).toContain("/entrevista/system-design");
  expect(await page.evaluate(() => (window as unknown as JanelaTeste).fechamentoTeste.ouvindo)).toBe(false);
  await page.screenshot({ path: "test-results/despedida-quadro.png" });
  await page.evaluate(() => (window as unknown as JanelaTeste).fechamentoTeste.terminar());
  await expect(page).toHaveURL(/\/obrigado$/);
  await expect(page.getByRole("heading", { name: "Obrigado pela conversa." })).toBeVisible();
  expect(pedidos.finalizar).toBe(1);
  expect(pedidos.falas.filter((f) => f === DESPEDIDA)).toHaveLength(1);
  // Os eventos de uma sessão honesta, do início ao encerramento, não produzem destaque no relatório.
  const criadaEm = Date.parse(eventosDaSessao[0].horario);
  const bloco = integridadeDoQuadro("teste-fechamento", eventosDaSessao, criadaEm);
  expect(bloco?.destaques ?? []).toEqual([]);
  expect(erros).toEqual([]);
});

test("pré-checagem informa regras e registros antes de começar nas duas salas", async ({ page }) => {
  await page.goto("/?config=integridade-e2e");
  await expect(page.getByText(/Pode consultar documentação de sintaxe/)).toBeVisible();
  await expect(page.getByText(/Não gravamos câmera, tela nem teclas/)).toBeVisible();
  await page.route("**/api/sessoes", (r) => r.fulfill({ json: {
    sessao_id: "teste-regras", area: "system design", apresentacao: "Vamos começar.",
    problema: { titulo: "API", enunciado: "Desenhe uma API.", fala_do_desafio: "Desenhe uma API." },
    tempos: { REQUISITOS: 600, ALTO_NIVEL: 600, APROFUNDAMENTO: 600, FECHAMENTO: 180 },
  } }));
  await page.goto("/entrevista/system-design");
  await expect(page.getByRole("button", { name: "Começar", exact: true })).toBeEnabled();
  await expect(page.getByText(/Pode consultar documentação de sintaxe/)).toBeVisible();
  await expect(page.getByText(/Não gravamos câmera, tela nem teclas/)).toBeVisible();
});

test("voz: despedida devolvida pelo fechamento é falada e só então navega", async ({ page }) => {
  await page.route("**/api/sessoes/*/perguntar", (r) => r.fulfill({ json: { responder: true, texto: DESPEDIDA, requisito: null, encerrar: true, fechamento: "encerrada" } }));
  const { pedidos, erros } = await preparar(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).fechamentoTeste.ouvindo)).toBe(true);
  await page.evaluate(() => (window as unknown as JanelaTeste).fechamentoTeste.emitir("Pode encerrar a entrevista."));
  await expect(page.locator("main[data-despedindo=true]")).toBeVisible();
  await expect(page).toHaveURL(/\/obrigado$/, { timeout: 20000 });
  expect(pedidos.finalizar).toBe(1);
  expect(pedidos.falas.filter((f) => f === DESPEDIDA)).toHaveLength(1);
  expect(erros).toEqual([]);
});

test("sem voz: texto aparece antes da página final e não sintetiza despedida", async ({ page }) => {
  const { pedidos, erros } = await preparar(page);
  await page.getByRole("button", { name: "Silenciar respostas por voz" }).click();
  await botaoEncerrar(page);
  await expect(page.locator("main[data-despedindo=true]").getByRole("status")).toContainText("Obrigado");
  await expect(page).toHaveURL(/\/obrigado$/);
  expect(pedidos.finalizar).toBe(1);
  expect(erros).toEqual([]);
});

test("foto final preserva o quadro analisado quando nada muda antes de encerrar", async ({ page }) => {
  const { pedidos, erros } = await preparar(page);
  await page.getByRole("button", { name: "Silenciar respostas por voz" }).click();
  await page.clock.install();
  await page.getByRole("radio", { name: "Retângulo", exact: true }).locator("..").click();
  await desenharPeca(page, 0);
  await page.clock.runFor(4000);
  await expect.poll(() => pedidos.analises).toBeGreaterThan(0);
  await expect.poll(() => pedidos.fotosIntermediarias).toBeGreaterThan(0);
  await botaoEncerrar(page);
  await expect(page).toHaveURL(/\/obrigado$/);
  await expect.poll(() => pedidos.fotosFinais).toBeGreaterThan(0);
  expect(pedidos.imagemFinal).not.toBeNull();
  expect(pedidos.imagemFinal?.equals(pedidos.imagemIntermediaria ?? Buffer.alloc(0))).toBe(true);
  expect(erros).toEqual([]);
});

test("foto e desenho final incluem a peça nova depois de mais de 60 análises", async ({ page }) => {
  test.setTimeout(360_000);
  const { pedidos, erros } = await preparar(page);
  await page.getByRole("button", { name: "Silenciar respostas por voz" }).click();
  await page.clock.install();
  await page.getByRole("radio", { name: "Retângulo", exact: true }).locator("..").click();
  for (let i = 0; i < 61; i++) {
    await desenharPeca(page, i);
    await page.clock.runFor(4000);
  }
  await expect.poll(() => pedidos.analises).toBeGreaterThan(60);
  await expect.poll(() => pedidos.fotosIntermediarias).toBeGreaterThan(60);
  const grafoAntesDaPecaFinal = pedidos.grafos.at(-1);
  // Esta peça é desenhada depois que o teto já foi atingido.
  await desenharPeca(page, 62);
  await botaoEncerrar(page);
  await expect(page).toHaveURL(/\/obrigado$/);
  await expect.poll(() => pedidos.fotosFinais).toBeGreaterThan(0);
  expect(pedidos.imagemFinal).not.toBeNull();
  expect(pedidos.imagemFinal?.equals(pedidos.imagemIntermediaria ?? Buffer.alloc(0))).toBe(false);
  expect(pedidos.eventos).toContain("imagem_recusada");
  expect(pedidos.grafos.length).toBeGreaterThan(0);
  expect(pedidos.grafos.at(-1)).toContain("COMPONENTES");
  expect(pedidos.grafos.at(-1)).not.toBe(grafoAntesDaPecaFinal);
  expect(erros).toEqual([]);
});

test("duas falhas na foto final deixam evento na linha do tempo", async ({ page }) => {
  const { pedidos, erros } = await preparar(page, { falharFotoFinal: true });
  await page.getByRole("button", { name: "Silenciar respostas por voz" }).click();
  await desenharPeca(page, 0);
  await botaoEncerrar(page);
  await expect(page).toHaveURL(/\/obrigado$/);
  await expect.poll(() => pedidos.fotosFinais).toBe(2);
  await expect.poll(() => pedidos.eventos.filter((tipo) => tipo === "foto_final_falhou").length).toBeGreaterThan(0);
  expect(erros).toEqual([]);
});

test("tempo total: encerra com despedida mesmo sem nova fala do candidato", async ({ page }) => {
  await page.clock.install();
  const { pedidos, erros } = await preparar(page);
  await page.clock.fastForward(34 * 60_000);
  await expect(page.locator("main[data-despedindo=true]")).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page).toHaveURL(/\/obrigado$/);
  expect(pedidos.finalizar).toBe(1);
  expect(erros).toEqual([]);
});

type LoteDeEventos = { eventos: { tipo: string; dados?: { texto?: string } | null }[] };
const temDespedida = (lote: LoteDeEventos) => lote.eventos.some((e) => e.tipo === "fala" && e.dados?.texto === DESPEDIDA);

test("envio lento: o relatório só é pedido depois que a despedida chegou à linha do tempo", async ({ page }) => {
  const { erros } = await preparar(page);
  let despedidaEntregue = false;
  let entregueAoFinalizar: boolean | null = null;
  await page.route("**/api/sessoes/*/eventos", async (r) => {
    const comDespedida = temDespedida(r.request().postDataJSON() as LoteDeEventos);
    // Mais que o prazo curto usado entre análises (1,5 s) e menos que os quatro segundos do texto da despedida.
    if (comDespedida) await new Promise((resolver) => setTimeout(resolver, 2500));
    await r.fulfill({ json: { ok: true } });
    if (comDespedida) despedidaEntregue = true;
  });
  await page.route("**/api/sessoes/*/finalizar", (r) => { entregueAoFinalizar ??= despedidaEntregue; return r.fulfill({ json: { ok: true } }); });
  await page.getByRole("button", { name: "Silenciar respostas por voz" }).click();
  await botaoEncerrar(page);
  await expect(page).toHaveURL(/\/obrigado$/);
  await expect.poll(() => entregueAoFinalizar).toBe(true);
  expect(erros).toEqual([]);
});

test("janela fechada na página final com o envio ainda pendente: o relatório é pedido uma vez", async ({ page }) => {
  const { pedidos, erros } = await preparar(page);
  let liberar!: () => void;
  const retido = new Promise<void>((resolver) => { liberar = resolver; });
  await page.route("**/api/sessoes/*/eventos", async (r) => {
    if (temDespedida(r.request().postDataJSON() as LoteDeEventos)) await retido;
    await r.fulfill({ json: { ok: true } });
  });
  await page.getByRole("button", { name: "Silenciar respostas por voz" }).click();
  await botaoEncerrar(page);
  // A despedida em texto acaba antes do envio: a página final abre com o pedido do relatório ainda por sair.
  await expect(page).toHaveURL(/\/obrigado$/);
  expect(pedidos.finalizar).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => pedidos.finalizar).toBe(1);
  liberar();
  await page.waitForTimeout(1000);
  expect(pedidos.finalizar).toBe(1);
  expect(erros).toEqual([]);
});
