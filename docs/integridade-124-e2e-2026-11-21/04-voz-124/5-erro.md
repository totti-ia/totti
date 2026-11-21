# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: voz.spec.ts >> quadro pergunta na pausa, responde no loop rápido e aguarda a continuação da fala
- Location: e2e\voz.spec.ts:221:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/Quando terminar uma etapa ou quiser um comentário/)
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText(/Quando terminar uma etapa ou quiser um comentário/) with timeout 15000ms
  - waiting for getByText(/Quando terminar uma etapa ou quiser um comentário/)

```

```yaml
- main:
  - button
  - region "Formas":
    - text: Para mover a tela, segure a roda do mouse ou a barra de espaço enquanto arrasta ou use a ferramenta de mão
    - heading "Formas" [level=2]
    - checkbox "Manter ativa a ferramenta selecionada após desenhar"
    - radio "Mão (ferramenta de rolagem) — H"
    - radio "Seleção" [checked]
    - text: "1"
    - radio "Retângulo"
    - text: "2"
    - radio "Losango"
    - text: "3"
    - radio "Elipse"
    - text: "4"
    - radio "Flecha"
    - text: "5"
    - radio "Linha"
    - text: "6"
    - radio "Desenhar"
    - text: "7"
    - radio "Texto"
    - text: "8"
    - radio "Inserir imagem"
    - text: "9"
    - radio "Borracha"
    - text: "0"
    - button "Mais ferramentas"
  - checkbox "Biblioteca"
  - text: Biblioteca
  - contentinfo:
    - region "Ações da tela":
      - heading "Ações da tela" [level=2]
      - button "Diminuir zoom"
      - button "Redefinir zoom": 100%
      - button "Aumentar zoom"
      - button "Desfazer" [disabled]
      - button "Refazer" [disabled]
    - button "Ajudar"
  - img
  - text: Tela de desenho
  - paragraph: Entrevista de system design
  - heading "Pronto para começar?" [level=1]
  - paragraph: A entrevista passa por entender o problema, desenhar uma visão geral e aprofundar alguns pontos. Você pode perguntar, dizer que não sabe ou pular uma parte. O entrevistador acompanha seu desenho e também pode fazer perguntas.
  - paragraph: "Vamos pedir acesso à câmera e ao microfone. A câmera aparece só para você: não é gravada nem analisada."
  - paragraph: Pode consultar documentação de sintaxe. Resolva o desafio sem assistência de IA. Registramos colagens, saídas da janela, o código, o desenho e a fala. Não gravamos câmera, tela nem teclas. Esses registros são evidências para revisão humana e não alteram a nota.
  - button "Começar"
- alert
```

# Test source

```ts
  136 |   await preparar(page);
  137 |   const blip = { id: "licenca-e2e", preview: "Sobre o seu loop", priority: 1, createdAt: 0 };
  138 |   let liberar = false;
  139 |   const eventos: string[] = [];
  140 |   const pedidosDoBalao: number[] = [];
  141 |   await page.route("**/api/events", async (rota) => {
  142 |     eventos.push(rota.request().postDataJSON().type);
  143 |     await rota.fulfill({ json: {} });
  144 |   });
  145 |   await page.route("**/api/blip/pending?**", (rota) => rota.fulfill({ json: liberar && !eventos.includes("blip_snoozed") ? { blip } : {} }));
  146 |   await page.route("**/api/chat", async (rota) => {
  147 |     const pedido = rota.request().postDataJSON() as { blipId?: string };
  148 |     if (pedido.blipId) pedidosDoBalao.push(1);
  149 |     return rota.fulfill({ json: { reply: "", commands: [], end: false, listening: true } });
  150 |   });
  151 |   await page.goto("/entrevista");
  152 |   await expect.poll(async () => (await falas(page)).some((f) => f.includes("pensa em voz alta"))).toBe(true);
  153 |   // Ele está no meio do código: digita de tempos em tempos e a pergunta chega numa pausa curta.
  154 |   await page.locator(".monaco-editor .view-lines").first().click();
  155 |   await page.keyboard.press("End");
  156 |   await page.keyboard.type("x");
  157 |   await expect.poll(() => eventos, { timeout: 8000 }).toContain("snapshot");
  158 |   liberar = true;
  159 |   const pediuLicenca = async () => (await falas(page)).some((f) => /posso (te )?(perguntar|interromper)/i.test(f));
  160 |   for (let i = 0; i < 12 && !(await pediuLicenca()); i++) {
  161 |     await page.keyboard.type("x");
  162 |     await page.waitForTimeout(3000);
  163 |   }
  164 |   await expect.poll(pediuLicenca, { timeout: 10_000 }).toBe(true);
  165 |   expect(pedidosDoBalao.length).toBe(0);
  166 |   await expect.poll(() => ouvindo(page)).toBe(true);
  167 |   await emitir(page, "espera um pouquinho");
  168 |   await expect.poll(() => eventos, { timeout: 8000 }).toContain("blip_snoozed");
  169 |   await expect.poll(() => falas(page)).toContain("Beleza, eu volto daqui a pouco.");
  170 |   expect(pedidosDoBalao.length).toBe(0);
  171 |   expect(eventos).not.toContain("blip_opened");
  172 | });
  173 | 
  174 | test("IDE: Finalizar abre a última conversa por voz, e o Totti se despede antes de encerrar", async ({ page }) => {
  175 |   await preparar(page);
  176 |   const encerramento = { id: "fim-e2e", preview: "Antes de encerrar, uns pontos rápidos", priority: 1, createdAt: 0 };
  177 |   const pergunta = "Antes de você encerrar: qual o custo da sua solução?";
  178 |   const eventos: string[] = [];
  179 |   await page.route("**/api/events", async (rota) => {
  180 |     eventos.push(rota.request().postDataJSON().type);
  181 |     await rota.fulfill({ json: {} });
  182 |   });
  183 |   await page.route("**/api/blip/pending?**", (rota) => rota.fulfill({ json: {} }));
  184 |   await page.route("**/api/encerramento", (rota) => rota.fulfill({ json: { blip: encerramento } }));
  185 |   await page.route("**/api/chat", async (rota) => {
  186 |     const pedido = rota.request().postDataJSON() as { blipId?: string; messages: { role: string }[] };
  187 |     if (pedido.blipId && !pedido.messages.some((m) => m.role === "candidate")) return rota.fulfill({ json: { reply: pergunta, commands: [], end: false } });
  188 |     if (pedido.blipId) return rota.fulfill({ json: { reply: "Valeu, era isso.", commands: [], end: true } });
  189 |     return rota.fulfill({ json: { reply: "", commands: [], end: false, listening: true } });
  190 |   });
  191 |   await page.goto("/entrevista");
  192 |   await expect.poll(async () => (await falas(page)).some((f) => f.includes("pensa em voz alta"))).toBe(true);
  193 |   await page.getByRole("button", { name: "Finalizar" }).click();
  194 |   await page.getByRole("alertdialog").getByRole("button", { name: "Encerrar", exact: true }).click();
  195 |   await expect.poll(() => falas(page), { timeout: 8000 }).toContain(pergunta);
  196 |   expect(eventos).not.toContain("session_ended");
  197 |   await expect.poll(() => ouvindo(page)).toBe(true);
  198 |   await emitir(page, "Fica linear, porque cada caractere entra e sai da pilha uma vez.");
  199 |   await expect.poll(() => falas(page), { timeout: 8000 }).toContain("Valeu, era isso.");
  200 |   await expect.poll(async () => (await falas(page)).some((f) => f.startsWith("Combinado, vamos encerrar por aqui")), { timeout: 8000 }).toBe(true);
  201 |   await expect.poll(() => eventos, { timeout: 8000 }).toContain("session_ended");
  202 | });
  203 | 
  204 | test("quadro encaminha transcrição para a conversa da sessão", async ({ page }) => {
  205 |   await preparar(page);
  206 |   await page.goto("/entrevista/system-design");
  207 |   await page.getByRole("button", { name: "Começar", exact: true }).click();
  208 |   await expect(page.locator('[data-janela-chamada][data-fase="REQUISITOS"]')).toBeVisible({ timeout: 45000 });
  209 |   await expect.poll(() => ouvindo(page)).toBe(true);
  210 |   const pedido = page.waitForRequest((req) => req.method() === "POST" && req.url().includes("/perguntar"));
  211 |   await emitir(page, "O sistema precisa receber mil acessos por minuto.");
  212 |   const req = await pedido;
  213 |   expect(req.postDataJSON().texto).toBe("O sistema precisa receber mil acessos por minuto.");
  214 |   await page.getByRole("button", { name: "Encerrar entrevista", exact: true }).click();
  215 |   await page.getByRole("button", { name: "Encerrar", exact: true }).click();
  216 |   await expect(page.getByRole("heading", { name: "Entrevista encerrada" })).toBeVisible();
  217 |   await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.midias
  218 |     .flatMap((stream) => stream.getTracks()).every((trilha) => trilha.readyState === "ended"))).toBe(true);
  219 | });
  220 | 
  221 | test("quadro pergunta na pausa, responde no loop rápido e aguarda a continuação da fala", async ({ page }) => {
  222 |   await preparar(page);
  223 |   const pergunta = "Como o componente que você desenhou recebe uma solicitação?";
  224 |   await page.route("**/analisar", (rota) => rota.fulfill({ json: {
  225 |     status: "duvida", pergunta, nota: "Entrada de solicitações", elementos: [], degrau: null, observacoes: [],
  226 |   } }));
  227 |   let liberar: (() => void) | undefined;
  228 |   const aguardar = new Promise<void>((resolver) => { liberar = resolver; });
  229 |   const pedidos: { texto: string; grafo: string; pergunta_ativa?: string }[] = [];
  230 |   await page.route("**/perguntar", async (rota) => {
  231 |     pedidos.push(rota.request().postDataJSON());
  232 |     if (pedidos.length === 1) await aguardar;
  233 |     await rota.fulfill({ json: { responder: pedidos.length === 1, texto: pedidos.length === 1 ? "Você descreveu o caminho de entrada da solicitação." : "", requisito: null, concluiu: false } });
  234 |   });
  235 |   await page.goto("/entrevista/system-design");
> 236 |   await expect(page.getByText(/Quando terminar uma etapa ou quiser um comentário/)).toBeVisible();
      |                                                                                     ^ Error: expect(locator).toBeVisible() failed
  237 |   await page.getByRole("button", { name: "Começar", exact: true }).click();
  238 |   await expect(page.locator('[data-janela-chamada][data-fase="REQUISITOS"]')).toBeVisible({ timeout: 45000 });
  239 |   expect((await falas(page)).some((f) => f.includes("é só me avisar"))).toBe(true);
  240 |   await expect.poll(() => ouvindo(page)).toBe(true);
  241 |   await page.keyboard.press("r");
  242 |   await page.mouse.move(650, 450);
  243 |   await page.mouse.down();
  244 |   await page.mouse.move(850, 560, { steps: 8 });
  245 |   await page.mouse.up();
  246 |   // Nenhum clique no plin: a pergunta deve ser falada automaticamente.
  247 |   await expect.poll(() => falas(page), { timeout: 20000 }).toContain(pergunta);
  248 |   await expect.poll(() => ouvindo(page)).toBe(true);
  249 |   await emitir(page, "A solicitação entra neste componente pela API.");
  250 |   await expect.poll(() => pedidos.length).toBe(1);
  251 |   expect(pedidos[0].pergunta_ativa).toBe(pergunta);
  252 |   expect(pedidos[0].grafo).toContain("COMPONENTES");
  253 |   await expect(page.getByText("O agente está preparando a resposta…")).toBeVisible();
  254 |   await page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.emitirParcial("E também vou explicar"));
  255 |   const quantidadeAntes = (await falas(page)).length;
  256 |   liberar!();
  257 |   await expect(page.getByText("O agente está preparando a resposta…")).toBeHidden();
  258 |   await page.waitForTimeout(1300);
  259 |   expect((await falas(page)).length).toBe(quantidadeAntes);
  260 |   await emitir(page, "E também vou explicar como autentico essa solicitação.");
  261 |   await expect.poll(() => falas(page)).toContain("Você descreveu o caminho de entrada da solicitação.");
  262 |   await expect.poll(() => pedidos.length).toBe(2);
  263 |   await expect.poll(() => ouvindo(page)).toBe(true);
  264 | });
  265 | 
  266 | test("mão compõe gestos e traços livres, pode só falar e preserva o desenho do candidato", async ({ page }) => {
  267 |   await preparar(page);
  268 |   await page.route("**/analisar", (rota) => rota.fulfill({ json: { status: "ok" } }));
  269 |   const planos = [
  270 |     [{ tipo: "colchetes", alvo: "r1" }, { tipo: "anotar", alvo: "r1", texto: "Como chega a solicitação?" }],
  271 |     [{ tipo: "traco", alvo: "r1", pontos: [[0, 0.8], [0.4, 1], [1, 0.2]] }], [],
  272 |   ];
  273 |   let rodada = 0;
  274 |   await page.route("**/perguntar", (rota) => rota.fulfill({ json: {
  275 |     responder: true, texto: "Estou acompanhando a sua explicação.", requisito: null, concluiu: false, visual: planos[rodada++],
  276 |   } }));
  277 |   await page.goto("/entrevista/system-design");
  278 |   await page.getByRole("button", { name: "Começar", exact: true }).click();
  279 |   await expect(page.locator('[data-janela-chamada][data-fase="REQUISITOS"]')).toBeVisible({ timeout: 45000 });
  280 |   await expect.poll(() => ouvindo(page)).toBe(true);
  281 |   await page.getByRole("radio", { name: "Retângulo", exact: true }).check({ force: true });
  282 |   await page.mouse.move(650, 450); await page.mouse.down();
  283 |   await page.mouse.move(850, 560, { steps: 8 }); await page.mouse.up();
  284 |   await expect.poll(async () => (await cenaVisual(page)).filter((e) => e.autor !== "agente").length).toBe(1);
  285 |   const candidatoAntes = (await cenaVisual(page)).filter((e) => e.autor !== "agente");
  286 |   const gestos = async () => (await cenaVisual(page)).filter((e) => e.grupo?.startsWith("conversa:"));
  287 |   await expect.poll(() => ouvindo(page)).toBe(true);
  288 |   await emitir(page, "Pode destacar o componente?");
  289 |   await expect.poll(async () => (await gestos()).length).toBe(3);
  290 |   await expect.poll(async () => (await gestos()).some((e) => e.texto === "Como chega a solicitação?")).toBe(true);
  291 |   await page.screenshot({ path: "test-results/gestos-no-quadro.png" });
  292 |   await expect.poll(() => ouvindo(page)).toBe(true);
  293 |   await emitir(page, "Agora acompanhe este outro ponto.");
  294 |   await expect.poll(async () => (await gestos()).length).toBe(1);
  295 |   await expect.poll(async () => (await gestos())[0]?.pontos?.length).toBe(3);
  296 |   await expect.poll(() => ouvindo(page)).toBe(true);
  297 |   await emitir(page, "Agora vamos só conversar.");
  298 |   await expect.poll(() => rodada).toBe(3);
  299 |   await expect.poll(async () => (await gestos()).length).toBe(0);
  300 |   expect((await cenaVisual(page)).filter((e) => e.autor !== "agente")).toEqual(candidatoAntes);
  301 | });
  302 | 
  303 | test("abrir o microfone enquanto o Totti prepara a voz cancela a fala, que não toca depois do ditado", async ({ page }) => {
  304 |   await preparar(page);
  305 |   let estado = estadoInicialDemo(VAGAS[0]);
  306 |   await page.route("**/api/pre-entrevista/sessoes**", async (rota) => {
  307 |     if (rota.request().method() === "POST" && rota.request().url().endsWith("/mensagem")) {
  308 |       estado = responderDemo(estado, rota.request().postDataJSON().text);
  309 |     }
  310 |     await rota.fulfill({ json: estado });
  311 |   });
  312 |   // A síntese da primeira resposta fica presa até o teste soltar: o Totti fica "preparando" a voz.
  313 |   let soltarSintese!: () => void;
  314 |   const sintese = new Promise<void>((r) => { soltarSintese = r; });
  315 |   let sinteses = 0;
  316 |   await page.route("**/api/falar", async (rota) => {
  317 |     sinteses++;
  318 |     await sintese;
  319 |     await rota.fallback();
  320 |   });
  321 |   await page.goto("/pre-entrevista/nova");
  322 |   // Os exemplos de vaga viraram cartões (um por nível e área): qualquer um preenche a vaga.
  323 |   await page.getByRole("button", { name: "Júnior Frontend" }).click();
  324 |   await page.getByRole("button", { name: "Começar com o Totti" }).click();
  325 |   await expect.poll(() => sinteses, { timeout: 25000 }).toBeGreaterThan(0);
  326 |   await expect(page.getByRole("button", { name: "Interromper resposta falada" })).toBeVisible();
  327 | 
  328 |   // O candidato fala por cima: o microfone assume o áudio e a fala em preparo é descartada.
  329 |   await page.getByRole("button", { name: "Ditar por voz" }).click();
  330 |   await expect.poll(() => ouvindo(page)).toBe(true);
  331 |   await expect(page.getByRole("button", { name: "Interromper resposta falada" })).toBeHidden();
  332 |   soltarSintese();
  333 |   await page.waitForTimeout(2500);
  334 |   expect(await falas(page)).toEqual([]);
  335 | 
  336 |   // Terminou o ditado: a resposta velha não pode tocar agora.
```