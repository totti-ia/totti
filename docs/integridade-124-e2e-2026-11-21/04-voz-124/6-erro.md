# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: voz.spec.ts >> mão compõe gestos e traços livres, pode só falar e preserva o desenho do candidato
- Location: e2e\voz.spec.ts:266:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 3
Received: 1

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - main [ref=e4]:
    - generic [active] [ref=e6]:
      - generic:
        - generic:
          - generic:
            - generic [ref=e7]:
              - button [ref=e9] [cursor=pointer]
              - region "Ações das formas selecionadas":
                - heading "Ações das formas selecionadas" [level=2] [ref=e13]
                - generic [ref=e15]:
                  - generic [ref=e16]:
                    - heading [level=3] [aria-hidden] [ref=e17]: Contorno
                    - dialog [ref=e19]:
                      - generic [ref=e20]:
                        - button "#1e1e1e" [ref=e21] [cursor=pointer]
                        - button "#e03131" [ref=e23] [cursor=pointer]
                        - button "#2f9e44" [ref=e24] [cursor=pointer]
                        - button "#1971c2" [ref=e25] [cursor=pointer]
                        - button "#f08c00" [ref=e26] [cursor=pointer]
                      - button "Contorno" [ref=e28] [cursor=pointer]
                  - generic [ref=e29]:
                    - heading [level=3] [aria-hidden] [ref=e30]: Fundo
                    - dialog [ref=e32]:
                      - generic [ref=e33]:
                        - button "transparent" [ref=e34] [cursor=pointer]
                        - button "#ffc9c9" [ref=e36] [cursor=pointer]
                        - button "#b2f2bb" [ref=e37] [cursor=pointer]
                        - button "#a5d8ff" [ref=e38] [cursor=pointer]
                        - button "#ffec99" [ref=e39] [cursor=pointer]
                      - button "Fundo" [ref=e41] [cursor=pointer]
                  - group "Espessura do traço" [ref=e42]:
                    - generic [ref=e44]:
                      - generic "Fino" [ref=e45] [cursor=pointer]:
                        - radio
                      - generic "Espesso" [ref=e47] [cursor=pointer]:
                        - radio [checked]
                      - generic "Muito espesso" [ref=e49] [cursor=pointer]:
                        - radio
                  - group "Estilo de traço" [ref=e51]:
                    - generic [ref=e53]:
                      - generic "Sólido" [ref=e54] [cursor=pointer]:
                        - radio [checked]
                      - generic "Tracejado" [ref=e56] [cursor=pointer]:
                        - radio
                      - generic "Pontilhado" [ref=e60] [cursor=pointer]:
                        - radio
                  - group "Precisão do traço" [ref=e64]:
                    - generic [ref=e66]:
                      - generic "Arquiteto" [ref=e67] [cursor=pointer]:
                        - radio
                      - generic "Artista" [ref=e70] [cursor=pointer]:
                        - radio [checked]
                      - generic "Cartunista" [ref=e73] [cursor=pointer]:
                        - radio
                  - group "Arestas" [ref=e76]:
                    - generic [ref=e78]:
                      - generic "Pontudo" [ref=e79] [cursor=pointer]:
                        - radio
                      - generic "Arredondado" [ref=e83] [cursor=pointer]:
                        - radio [checked]
                  - generic [ref=e88]:
                    - text: Opacidade
                    - generic [ref=e89]:
                      - slider "Opacidade 100 0" [ref=e90]: "100"
                      - generic [ref=e91]: "100"
                      - generic [ref=e92]: "0"
                  - group "Camadas" [ref=e93]:
                    - generic [ref=e95]:
                      - button "Enviar para o fundo — Ctrl+Shift+[" [ref=e96] [cursor=pointer]
                      - button "Enviar para trás — Ctrl+[" [ref=e102] [cursor=pointer]
                      - button "Trazer para a frente — Ctrl+]" [ref=e108] [cursor=pointer]
                      - button "Trazer para o primeiro plano — Ctrl+Shift+]" [ref=e114] [cursor=pointer]
                  - group "Ações" [ref=e120]:
                    - generic [ref=e122]:
                      - button "Duplicar" [ref=e123] [cursor=pointer]
                      - button "Apagar" [ref=e129] [cursor=pointer]
                      - button "Criar link" [ref=e133] [cursor=pointer]
            - region "Formas":
              - generic [ref=e142]:
                - generic: Pressione Enter para adicionar o texto. Hold Ctrl and Arrow key to create a flowchart
                - heading "Formas" [level=2] [ref=e143]
                - generic [ref=e144]:
                  - generic "Manter ativa a ferramenta selecionada após desenhar — Q" [ref=e145] [cursor=pointer]:
                    - checkbox "Manter ativa a ferramenta selecionada após desenhar"
                  - generic "Mão (ferramenta de rolagem) — H" [ref=e154] [cursor=pointer]:
                    - radio "Mão (ferramenta de rolagem) — H"
                  - generic "Seleção — V ou 1" [ref=e163] [cursor=pointer]:
                    - radio "Seleção" [checked]
                    - generic [ref=e164]: "1"
                  - generic "Retângulo — R ou 2" [ref=e171] [cursor=pointer]:
                    - radio "Retângulo"
                    - generic [ref=e172]: "2"
                  - generic "Losango — D ou 3" [ref=e178] [cursor=pointer]:
                    - radio "Losango"
                    - generic [ref=e179]: "3"
                  - generic "Elipse — O ou 4" [ref=e185] [cursor=pointer]:
                    - radio "Elipse"
                    - generic [ref=e186]: "4"
                  - generic "Flecha — A ou 5" [ref=e192] [cursor=pointer]:
                    - radio "Flecha"
                    - generic [ref=e193]: "5"
                  - generic "Linha — L ou 6" [ref=e200] [cursor=pointer]:
                    - radio "Linha"
                    - generic [ref=e201]: "6"
                  - generic "Desenhar — P ou 7" [ref=e204] [cursor=pointer]:
                    - radio "Desenhar"
                    - generic [ref=e205]: "7"
                  - generic "Texto — T ou 8" [ref=e211] [cursor=pointer]:
                    - radio "Texto"
                    - generic [ref=e212]: "8"
                  - generic "Inserir imagem — 9" [ref=e219] [cursor=pointer]:
                    - radio "Inserir imagem"
                    - generic [ref=e220]: "9"
                  - generic "Borracha — E ou 0" [ref=e227] [cursor=pointer]:
                    - radio "Borracha"
                    - generic [ref=e228]: "0"
                  - button "Mais ferramentas" [ref=e236] [cursor=pointer]
            - generic "Biblioteca" [ref=e243]:
              - checkbox "Biblioteca"
        - contentinfo:
          - region [ref=e252]:
            - heading "Ações da tela" [level=2] [ref=e253]
            - generic [ref=e255]:
              - button "Diminuir zoom" [ref=e256] [cursor=pointer]
              - button "Redefinir zoom" [ref=e260] [cursor=pointer]: 100%
              - button "Aumentar zoom" [ref=e261] [cursor=pointer]
            - generic [ref=e265]:
              - button "Desfazer" [ref=e268] [cursor=pointer]
              - button "Refazer" [disabled] [ref=e274]
          - button "Ajudar" [ref=e279] [cursor=pointer]
      - generic [ref=e285]: Tela de desenho
    - group [ref=e286]:
      - generic "Enunciado" [ref=e287] [cursor=pointer]
    - generic [ref=e290]:
      - button "Abrir a janela da chamada" [ref=e291] [cursor=pointer]:
        - generic [ref=e293]: 00:31
      - button "Desligar microfone" [ref=e294]
      - button "Encerrar entrevista" [ref=e298]
    - button "Silenciar respostas por voz" [pressed] [ref=e304]: Silenciar voz
    - generic [aria-hidden]:
      - generic: Totti
  - button "Open Next.js Dev Tools" [ref=e310] [cursor=pointer]
  - alert [ref=e314]
```

# Test source

```ts
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
  236 |   await expect(page.getByText(/Quando terminar uma etapa ou quiser um comentário/)).toBeVisible();
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
> 289 |   await expect.poll(async () => (await gestos()).length).toBe(3);
      |                                                          ^ Error: expect(received).toBe(expected) // Object.is equality
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
  337 |   await page.getByRole("button", { name: "Parar ditado" }).click();
  338 |   await expect.poll(() => ouvindo(page)).toBe(false);
  339 |   await page.waitForTimeout(2500);
  340 |   expect(await falas(page)).toEqual([]);
  341 | });
  342 | 
```