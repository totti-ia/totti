import { expect, test, type Page } from "@playwright/test";
import { estadoInicialDemo, responderDemo } from "../lib/pre-entrevista/tela/demo";
import { VAGAS } from "../fixtures/pre-entrevista/vagas";

import { preparar, ouvindo, falas, emitir, type JanelaTeste } from "./helpers/voz-falsa";

async function cenaVisual(page: Page) {
  return page.evaluate(() => {
    type Elemento = { id: string; type: string; text?: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; points?: [number, number][]; customData?: { autor?: string; grupo?: string } };
    return (window as unknown as { quadro: { api: { getSceneElements(): Elemento[] } } }).quadro.api.getSceneElements()
      .filter((e) => !e.isDeleted).map((e) => ({ id: e.id, tipo: e.type, texto: e.text, x: e.x, y: e.y, largura: e.width, altura: e.height, pontos: e.points, autor: e.customData?.autor, grupo: e.customData?.grupo }));
  });
}

test("recrutadora dita a vaga e conversa com Totti sem repetir voz no polling", async ({ page }) => {
  await preparar(page);
  let estado = estadoInicialDemo(VAGAS[0]);
  await page.route("**/api/pre-entrevista/sessoes**", async (rota) => {
    if (rota.request().method() === "POST" && rota.request().url().endsWith("/mensagem")) {
      estado = responderDemo(estado, rota.request().postDataJSON().text);
    }
    await rota.fulfill({ json: estado });
  });
  await page.goto("/pre-entrevista/nova");
  // Os exemplos de vaga viraram cartões (um por nível e área): qualquer um preenche a vaga.
  await page.getByRole("button", { name: "Júnior Frontend" }).click();
  await page.getByRole("button", { name: "Ditar por voz" }).first().click();
  await expect.poll(() => ouvindo(page)).toBe(true);
  await emitir(page, "Precisamos de experiência com Python.");
  await expect(page.getByPlaceholder("Responsabilidades, requisitos, ferramentas do dia a dia…")).toHaveValue(/Precisamos de experiência com Python\./);
  await page.getByRole("button", { name: "Parar ditado" }).click();
  await page.getByRole("button", { name: "Começar com o Totti" }).click();
  await expect(page.getByRole("button", { name: "Silenciar respostas por voz" })).toBeVisible({ timeout: 25000 });
  await expect.poll(async () => (await falas(page)).length).toBe(1);
  await page.getByRole("button", { name: "Ditar por voz" }).click();
  await expect.poll(() => ouvindo(page)).toBe(true);
  await emitir(page, "Prefiro perguntas sobre autonomia e Python.");
  await page.getByRole("button", { name: "Parar ditado" }).click();
  await expect(page.getByRole("textbox", { name: "Mensagem para o Totti" })).toHaveValue("Prefiro perguntas sobre autonomia e Python.");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect.poll(async () => (await falas(page)).length).toBe(2);
  const quantidade = (await falas(page)).length;
  await page.waitForTimeout(1800);
  expect((await falas(page)).length).toBe(quantidade);
});

const grifos = (page: Page) => page.locator(".agent-highlight").count();

test("IDE: conversa só por voz, sem barra lateral; a pergunta sai na pausa e o grifo some quando o assunto fecha", async ({ page }) => {
  await preparar(page);
  const pergunta = "O que você está montando nesse loop?";
  const parafrase = "Então você procura o complemento a cada número.";
  const blip = { id: "pausa-e2e", preview: "Sobre o seu loop", priority: 1, createdAt: 0 };
  let liberar = false;
  let abriu = false;
  const pedidos: { blipId?: string; messages: { role: string; text: string }[] }[] = [];
  await page.route("**/api/events", async (rota) => {
    if (rota.request().postDataJSON().type === "blip_opened") abriu = true;
    await rota.fulfill({ json: {} });
  });
  await page.route("**/api/blip/pending?**", (rota) => rota.fulfill({ json: liberar && !abriu ? { blip } : {} }));
  await page.route("**/api/chat", async (rota) => {
    const pedido = rota.request().postDataJSON() as (typeof pedidos)[number];
    pedidos.push(pedido);
    const ultima = pedido.messages.findLast((m) => m.role === "candidate")?.text ?? "";
    const ouvindo = { reply: "", commands: [], end: false, listening: true };
    if (pedido.blipId) {
      if (!ultima) return rota.fulfill({ json: { reply: pergunta, commands: [{ type: "highlight_range", startLine: 1, endLine: 2 }], end: false } });
      if (/deixa eu pensar/i.test(ultima)) return rota.fulfill({ json: ouvindo });
      return rota.fulfill({ json: { reply: parafrase, commands: [], end: true } });
    }
    return rota.fulfill({ json: ouvindo });
  });

  await page.goto("/entrevista");
  // A apresentação: quem é, quanto tempo e como funciona, tudo por voz.
  await expect.poll(async () => (await falas(page)).some((f) => f.includes("pensa em voz alta"))).toBe(true);
  await expect(page.getByRole("button", { name: "Chamar o Totti" })).toHaveCount(0);
  await expect.poll(() => ouvindo(page)).toBe(true);

  // Fala em andamento (transcrição parcial) segura a vez: a pergunta pendente não sai por cima.
  await page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.emitirParcial("Estou pensando em"));
  liberar = true;
  await page.waitForTimeout(4000);
  expect(await falas(page)).not.toContain(pergunta);

  // Quem pensa em voz alta é só ouvido; na pausa, a pergunta sai por voz, com o grifo, sem abrir nenhuma barra.
  await emitir(page, "Estou pensando em usar um dicionário aqui.");
  await expect.poll(() => pedidos.filter((p) => !p.blipId).length, { timeout: 8000 }).toBe(1);
  expect(pedidos[0].messages.some((m) => m.role === "agent" && m.text.includes("pensa em voz alta"))).toBe(true);
  await expect.poll(() => falas(page), { timeout: 15_000 }).toContain(pergunta);
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect.poll(() => grifos(page)).toBeGreaterThan(0);
  await expect.poll(() => ouvindo(page)).toBe(true);

  // Pensando em voz alta dentro da pergunta: só o "uhum" de quem ouviu, e o assunto continua aberto (o grifo fica).
  const antes = (await falas(page)).length;
  await emitir(page, "Hum, deixa eu pensar um pouco.");
  await expect.poll(() => pedidos.filter((p) => p.blipId).length, { timeout: 8000 }).toBe(2);
  await page.waitForTimeout(1200);
  expect((await falas(page)).slice(antes).every((f) => ["Uhum, entendi.", "Legal, hmm.", "Hum, certo.", "Uhum, saquei.", "Tá, entendi."].includes(f))).toBe(true);
  expect(await grifos(page)).toBeGreaterThan(0);

  // Respondeu: a paráfrase sai por voz, o assunto fecha e o grifo some.
  await emitir(page, "Eu guardo cada número num dicionário e procuro o complemento.");
  await expect.poll(() => falas(page), { timeout: 8000 }).toContain(parafrase);
  const resposta = pedidos.filter((p) => p.blipId).at(-1)!;
  expect(resposta.messages.map((m) => m.role)).toEqual(["agent", "candidate", "candidate"]);
  await expect.poll(() => grifos(page), { timeout: 6000 }).toBe(0);
});

test("IDE: fala livre com pedido de feedback é respondida por voz e o grifo sai depois", async ({ page }) => {
  await preparar(page);
  const feedback = "Você guarda cada número num dicionário antes de procurar o par.";
  await page.route("**/api/events", (rota) => rota.fulfill({ json: {} }));
  await page.route("**/api/blip/pending?**", (rota) => rota.fulfill({ json: {} }));
  await page.route("**/api/chat", async (rota) => {
    const pedido = rota.request().postDataJSON() as { messages: { role: string; text: string }[] };
    const ultima = pedido.messages.findLast((m) => m.role === "candidate")?.text ?? "";
    if (/feedback/i.test(ultima)) {
      return rota.fulfill({ json: { reply: feedback, commands: [{ type: "highlight_range", startLine: 1, endLine: 2 }], end: true, concluded: true } });
    }
    return rota.fulfill({ json: { reply: "", commands: [], end: false, listening: true } });
  });
  await page.goto("/entrevista");
  await expect.poll(async () => (await falas(page)).some((f) => f.includes("pensa em voz alta"))).toBe(true);
  await expect.poll(() => ouvindo(page)).toBe(true);
  await emitir(page, "Terminei a primeira versão, pode me dar um feedback?");
  await expect.poll(() => falas(page), { timeout: 8000 }).toContain(feedback);
  await expect(page.getByRole("complementary")).toHaveCount(0);
  // A fala fechou o assunto: o grifo dela sai quando ela termina.
  await expect.poll(() => grifos(page), { timeout: 6000 }).toBe(0);
});

test("IDE: no meio do código o Totti pede licença; 'espera um pouquinho' adia a pergunta", async ({ page }) => {
  await preparar(page);
  const blip = { id: "licenca-e2e", preview: "Sobre o seu loop", priority: 1, createdAt: 0 };
  let liberar = false;
  const eventos: string[] = [];
  const pedidosDoBalao: number[] = [];
  await page.route("**/api/events", async (rota) => {
    eventos.push(rota.request().postDataJSON().type);
    await rota.fulfill({ json: {} });
  });
  await page.route("**/api/blip/pending?**", (rota) => rota.fulfill({ json: liberar && !eventos.includes("blip_snoozed") ? { blip } : {} }));
  await page.route("**/api/chat", async (rota) => {
    const pedido = rota.request().postDataJSON() as { blipId?: string };
    if (pedido.blipId) pedidosDoBalao.push(1);
    return rota.fulfill({ json: { reply: "", commands: [], end: false, listening: true } });
  });
  await page.goto("/entrevista");
  await expect.poll(async () => (await falas(page)).some((f) => f.includes("pensa em voz alta"))).toBe(true);
  // Ele está no meio do código: digita de tempos em tempos e a pergunta chega numa pausa curta.
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await expect.poll(() => eventos, { timeout: 8000 }).toContain("snapshot");
  liberar = true;
  const pediuLicenca = async () => (await falas(page)).some((f) => /posso (te )?(perguntar|interromper)/i.test(f));
  for (let i = 0; i < 12 && !(await pediuLicenca()); i++) {
    await page.keyboard.type("x");
    await page.waitForTimeout(3000);
  }
  await expect.poll(pediuLicenca, { timeout: 10_000 }).toBe(true);
  expect(pedidosDoBalao.length).toBe(0);
  await expect.poll(() => ouvindo(page)).toBe(true);
  await emitir(page, "espera um pouquinho");
  await expect.poll(() => eventos, { timeout: 8000 }).toContain("blip_snoozed");
  await expect.poll(() => falas(page)).toContain("Beleza, eu volto daqui a pouco.");
  expect(pedidosDoBalao.length).toBe(0);
  expect(eventos).not.toContain("blip_opened");
});

test("IDE: Finalizar abre a última conversa por voz, e o Totti se despede antes de encerrar", async ({ page }) => {
  await preparar(page);
  const encerramento = { id: "fim-e2e", preview: "Antes de encerrar, uns pontos rápidos", priority: 1, createdAt: 0 };
  const pergunta = "Antes de você encerrar: qual o custo da sua solução?";
  const eventos: string[] = [];
  await page.route("**/api/events", async (rota) => {
    eventos.push(rota.request().postDataJSON().type);
    await rota.fulfill({ json: {} });
  });
  await page.route("**/api/blip/pending?**", (rota) => rota.fulfill({ json: {} }));
  await page.route("**/api/encerramento", (rota) => rota.fulfill({ json: { blip: encerramento } }));
  await page.route("**/api/chat", async (rota) => {
    const pedido = rota.request().postDataJSON() as { blipId?: string; messages: { role: string }[] };
    if (pedido.blipId && !pedido.messages.some((m) => m.role === "candidate")) return rota.fulfill({ json: { reply: pergunta, commands: [], end: false } });
    if (pedido.blipId) return rota.fulfill({ json: { reply: "Valeu, era isso.", commands: [], end: true } });
    return rota.fulfill({ json: { reply: "", commands: [], end: false, listening: true } });
  });
  await page.goto("/entrevista");
  await expect.poll(async () => (await falas(page)).some((f) => f.includes("pensa em voz alta"))).toBe(true);
  await page.getByRole("button", { name: "Finalizar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Encerrar", exact: true }).click();
  await expect.poll(() => falas(page), { timeout: 8000 }).toContain(pergunta);
  expect(eventos).not.toContain("session_ended");
  await expect.poll(() => ouvindo(page)).toBe(true);
  await emitir(page, "Fica linear, porque cada caractere entra e sai da pilha uma vez.");
  await expect.poll(() => falas(page), { timeout: 8000 }).toContain("Valeu, era isso.");
  await expect.poll(async () => (await falas(page)).some((f) => f.startsWith("Combinado, vamos encerrar por aqui")), { timeout: 8000 }).toBe(true);
  await expect.poll(() => eventos, { timeout: 8000 }).toContain("session_ended");
});

test("quadro encaminha transcrição para a conversa da sessão", async ({ page }) => {
  await preparar(page);
  await page.goto("/entrevista/system-design");
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await expect(page.locator('[data-janela-chamada][data-fase="REQUISITOS"]')).toBeVisible({ timeout: 45000 });
  await expect.poll(() => ouvindo(page)).toBe(true);
  const pedido = page.waitForRequest((req) => req.method() === "POST" && req.url().includes("/perguntar"));
  await emitir(page, "O sistema precisa receber mil acessos por minuto.");
  const req = await pedido;
  expect(req.postDataJSON().texto).toBe("O sistema precisa receber mil acessos por minuto.");
  await page.getByRole("button", { name: "Encerrar entrevista", exact: true }).click();
  await page.getByRole("button", { name: "Encerrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Entrevista encerrada" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.midias
    .flatMap((stream) => stream.getTracks()).every((trilha) => trilha.readyState === "ended"))).toBe(true);
});

test("quadro pergunta na pausa, responde no loop rápido e aguarda a continuação da fala", async ({ page }) => {
  await preparar(page);
  const pergunta = "Como o componente que você desenhou recebe uma solicitação?";
  await page.route("**/analisar", (rota) => rota.fulfill({ json: {
    status: "duvida", pergunta, nota: "Entrada de solicitações", elementos: [], degrau: null, observacoes: [],
  } }));
  let liberar: (() => void) | undefined;
  const aguardar = new Promise<void>((resolver) => { liberar = resolver; });
  const pedidos: { texto: string; grafo: string; pergunta_ativa?: string }[] = [];
  await page.route("**/perguntar", async (rota) => {
    pedidos.push(rota.request().postDataJSON());
    if (pedidos.length === 1) await aguardar;
    await rota.fulfill({ json: { responder: pedidos.length === 1, texto: pedidos.length === 1 ? "Você descreveu o caminho de entrada da solicitação." : "", requisito: null, concluiu: false } });
  });
  await page.goto("/entrevista/system-design");
  await expect(page.getByText(/Quando terminar uma etapa ou quiser um comentário/)).toBeVisible();
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await expect(page.locator('[data-janela-chamada][data-fase="REQUISITOS"]')).toBeVisible({ timeout: 45000 });
  expect((await falas(page)).some((f) => f.includes("é só me avisar"))).toBe(true);
  await expect.poll(() => ouvindo(page)).toBe(true);
  await page.keyboard.press("r");
  await page.mouse.move(650, 450);
  await page.mouse.down();
  await page.mouse.move(850, 560, { steps: 8 });
  await page.mouse.up();
  // Nenhum clique no plin: a pergunta deve ser falada automaticamente.
  await expect.poll(() => falas(page), { timeout: 20000 }).toContain(pergunta);
  await expect.poll(() => ouvindo(page)).toBe(true);
  await emitir(page, "A solicitação entra neste componente pela API.");
  await expect.poll(() => pedidos.length).toBe(1);
  expect(pedidos[0].pergunta_ativa).toBe(pergunta);
  expect(pedidos[0].grafo).toContain("COMPONENTES");
  await expect(page.getByText("O agente está preparando a resposta…")).toBeVisible();
  await page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.emitirParcial("E também vou explicar"));
  const quantidadeAntes = (await falas(page)).length;
  liberar!();
  await expect(page.getByText("O agente está preparando a resposta…")).toBeHidden();
  await page.waitForTimeout(1300);
  expect((await falas(page)).length).toBe(quantidadeAntes);
  await emitir(page, "E também vou explicar como autentico essa solicitação.");
  await expect.poll(() => falas(page)).toContain("Você descreveu o caminho de entrada da solicitação.");
  await expect.poll(() => pedidos.length).toBe(2);
  await expect.poll(() => ouvindo(page)).toBe(true);
});

test("mão compõe gestos e traços livres, pode só falar e preserva o desenho do candidato", async ({ page }) => {
  await preparar(page);
  await page.route("**/analisar", (rota) => rota.fulfill({ json: { status: "ok" } }));
  const planos = [
    [{ tipo: "colchetes", alvo: "r1" }, { tipo: "anotar", alvo: "r1", texto: "Como chega a solicitação?" }],
    [{ tipo: "traco", alvo: "r1", pontos: [[0, 0.8], [0.4, 1], [1, 0.2]] }], [],
  ];
  let rodada = 0;
  await page.route("**/perguntar", (rota) => rota.fulfill({ json: {
    responder: true, texto: "Estou acompanhando a sua explicação.", requisito: null, concluiu: false, visual: planos[rodada++],
  } }));
  await page.goto("/entrevista/system-design");
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await expect(page.locator('[data-janela-chamada][data-fase="REQUISITOS"]')).toBeVisible({ timeout: 45000 });
  await expect.poll(() => ouvindo(page)).toBe(true);
  await page.getByRole("radio", { name: "Retângulo", exact: true }).check({ force: true });
  await page.mouse.move(650, 450); await page.mouse.down();
  await page.mouse.move(850, 560, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await cenaVisual(page)).filter((e) => e.autor !== "agente").length).toBe(1);
  const candidatoAntes = (await cenaVisual(page)).filter((e) => e.autor !== "agente");
  const gestos = async () => (await cenaVisual(page)).filter((e) => e.grupo?.startsWith("conversa:"));
  await expect.poll(() => ouvindo(page)).toBe(true);
  await emitir(page, "Pode destacar o componente?");
  await expect.poll(async () => (await gestos()).length).toBe(3);
  await expect.poll(async () => (await gestos()).some((e) => e.texto === "Como chega a solicitação?")).toBe(true);
  await page.screenshot({ path: "test-results/gestos-no-quadro.png" });
  await expect.poll(() => ouvindo(page)).toBe(true);
  await emitir(page, "Agora acompanhe este outro ponto.");
  await expect.poll(async () => (await gestos()).length).toBe(1);
  await expect.poll(async () => (await gestos())[0]?.pontos?.length).toBe(3);
  await expect.poll(() => ouvindo(page)).toBe(true);
  await emitir(page, "Agora vamos só conversar.");
  await expect.poll(() => rodada).toBe(3);
  await expect.poll(async () => (await gestos()).length).toBe(0);
  expect((await cenaVisual(page)).filter((e) => e.autor !== "agente")).toEqual(candidatoAntes);
});

test("abrir o microfone enquanto o Totti prepara a voz cancela a fala, que não toca depois do ditado", async ({ page }) => {
  await preparar(page);
  let estado = estadoInicialDemo(VAGAS[0]);
  await page.route("**/api/pre-entrevista/sessoes**", async (rota) => {
    if (rota.request().method() === "POST" && rota.request().url().endsWith("/mensagem")) {
      estado = responderDemo(estado, rota.request().postDataJSON().text);
    }
    await rota.fulfill({ json: estado });
  });
  // A síntese da primeira resposta fica presa até o teste soltar: o Totti fica "preparando" a voz.
  let soltarSintese!: () => void;
  const sintese = new Promise<void>((r) => { soltarSintese = r; });
  let sinteses = 0;
  await page.route("**/api/falar", async (rota) => {
    sinteses++;
    await sintese;
    await rota.fallback();
  });
  await page.goto("/pre-entrevista/nova");
  // Os exemplos de vaga viraram cartões (um por nível e área): qualquer um preenche a vaga.
  await page.getByRole("button", { name: "Júnior Frontend" }).click();
  await page.getByRole("button", { name: "Começar com o Totti" }).click();
  await expect.poll(() => sinteses, { timeout: 25000 }).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Interromper resposta falada" })).toBeVisible();

  // O candidato fala por cima: o microfone assume o áudio e a fala em preparo é descartada.
  await page.getByRole("button", { name: "Ditar por voz" }).click();
  await expect.poll(() => ouvindo(page)).toBe(true);
  await expect(page.getByRole("button", { name: "Interromper resposta falada" })).toBeHidden();
  soltarSintese();
  await page.waitForTimeout(2500);
  expect(await falas(page)).toEqual([]);

  // Terminou o ditado: a resposta velha não pode tocar agora.
  await page.getByRole("button", { name: "Parar ditado" }).click();
  await expect.poll(() => ouvindo(page)).toBe(false);
  await page.waitForTimeout(2500);
  expect(await falas(page)).toEqual([]);
});
