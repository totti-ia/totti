# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: voz.spec.ts >> IDE: no meio do código o Totti pede licença; 'espera um pouquinho' adia a pergunta
- Location: e2e\voz.spec.ts:135:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - main [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - code [ref=e9]:
          - generic [ref=e10]:
            - textbox "Editor content" [active] [ref=e11]
            - textbox [aria-hidden] [ref=e12]
            - generic [aria-hidden] [ref=e15]:
              - generic [ref=e16]:
                - generic [ref=e17] [cursor=pointer]: 
                - generic [ref=e18]: "1"
              - generic [ref=e19]: "2"
              - generic [ref=e21]: "3"
              - generic [ref=e23]: "4"
            - generic [aria-hidden] [ref=e33]:
              - generic [ref=e34]: "def two_sum(nums, target):"
              - generic [ref=e36]: "# escreva sua solução aqui"
              - generic [ref=e38]: pass
              - generic [ref=e40]: xxxxxxxxxxxxx
        - region "Testes e resultados" [ref=e43]:
          - generic [ref=e44]:
            - heading "Testes" [level=2] [ref=e45]
            - button "Recolher resultados" [expanded] [ref=e46]
          - paragraph [ref=e50]: Rode o código para ver os testes aqui.
      - generic [ref=e51]:
        - region "Problema" [ref=e53]:
          - generic [ref=e54]:
            - generic [ref=e55]:
              - heading "Two Sum" [level=1] [ref=e56]
              - generic [ref=e57]: 00:54 / 30:00
              - generic [ref=e59]: Fácil · Hash map
            - button "Recolher painel do problema" [ref=e60]
          - generic [ref=e63]:
            - paragraph [ref=e64]:
              - text: Dado um array de inteiros
              - code [ref=e65]: nums
              - text: e um inteiro
              - code [ref=e66]: target
              - text: ", retorne os índices de dois números que somam"
              - code [ref=e67]: target
              - text: . Existe exatamente uma solução e você não pode usar o mesmo elemento duas vezes. A resposta pode vir em qualquer ordem.
            - generic [ref=e68]:
              - heading "Exemplos" [level=2] [ref=e69]
              - generic [ref=e70]:
                - generic [ref=e71]: "Entrada: nums = [2,7,11,15], target = 9"
                - generic [ref=e72]: "Saída: [0,1]"
                - generic [ref=e73]: 2 + 7 = 9
              - generic [ref=e74]:
                - generic [ref=e75]: "Entrada: nums = [3,2,4], target = 6"
                - generic [ref=e76]: "Saída: [1,2]"
              - generic [ref=e77]:
                - generic [ref=e78]: "Entrada: nums = [3,3], target = 6"
                - generic [ref=e79]: "Saída: [0,1]"
            - generic [ref=e80]:
              - heading "Restrições" [level=2] [ref=e81]
              - list [ref=e82]:
                - listitem [ref=e83]: 2 <= len(nums) <= 10⁴
                - listitem [ref=e84]: "-10⁹ <= nums[i] <= 10⁹"
                - listitem [ref=e85]: Existe exatamente uma resposta válida
        - generic [ref=e86]:
          - combobox "Linguagem" [ref=e87]:
            - option "Python" [selected]
          - button "Finalizar" [ref=e88]
          - button "Rodar" [ref=e91]
      - generic [aria-hidden]:
        - generic: Totti
      - status "Chamada com o entrevistador" [ref=e95]:
        - generic [ref=e97]: 00:54
        - button "Desligar microfone" [ref=e98]
  - button "Open Next.js Dev Tools" [ref=e107] [cursor=pointer]
  - alert [ref=e111]
  - generic [ref=e112]:
    - alert
    - alert
```

# Test source

```ts
  64  |     pedidos.push(pedido);
  65  |     const ultima = pedido.messages.findLast((m) => m.role === "candidate")?.text ?? "";
  66  |     const ouvindo = { reply: "", commands: [], end: false, listening: true };
  67  |     if (pedido.blipId) {
  68  |       if (!ultima) return rota.fulfill({ json: { reply: pergunta, commands: [{ type: "highlight_range", startLine: 1, endLine: 2 }], end: false } });
  69  |       if (/deixa eu pensar/i.test(ultima)) return rota.fulfill({ json: ouvindo });
  70  |       return rota.fulfill({ json: { reply: parafrase, commands: [], end: true } });
  71  |     }
  72  |     return rota.fulfill({ json: ouvindo });
  73  |   });
  74  | 
  75  |   await page.goto("/entrevista");
  76  |   // A apresentação: quem é, quanto tempo e como funciona, tudo por voz.
  77  |   await expect.poll(async () => (await falas(page)).some((f) => f.includes("pensa em voz alta"))).toBe(true);
  78  |   await expect(page.getByRole("button", { name: "Chamar o Totti" })).toHaveCount(0);
  79  |   await expect.poll(() => ouvindo(page)).toBe(true);
  80  | 
  81  |   // Fala em andamento (transcrição parcial) segura a vez: a pergunta pendente não sai por cima.
  82  |   await page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.emitirParcial("Estou pensando em"));
  83  |   liberar = true;
  84  |   await page.waitForTimeout(4000);
  85  |   expect(await falas(page)).not.toContain(pergunta);
  86  | 
  87  |   // Quem pensa em voz alta é só ouvido; na pausa, a pergunta sai por voz, com o grifo, sem abrir nenhuma barra.
  88  |   await emitir(page, "Estou pensando em usar um dicionário aqui.");
  89  |   await expect.poll(() => pedidos.filter((p) => !p.blipId).length, { timeout: 8000 }).toBe(1);
  90  |   expect(pedidos[0].messages.some((m) => m.role === "agent" && m.text.includes("pensa em voz alta"))).toBe(true);
  91  |   await expect.poll(() => falas(page), { timeout: 15_000 }).toContain(pergunta);
  92  |   await expect(page.getByRole("complementary")).toHaveCount(0);
  93  |   await expect.poll(() => grifos(page)).toBeGreaterThan(0);
  94  |   await expect.poll(() => ouvindo(page)).toBe(true);
  95  | 
  96  |   // Pensando em voz alta dentro da pergunta: só o "uhum" de quem ouviu, e o assunto continua aberto (o grifo fica).
  97  |   const antes = (await falas(page)).length;
  98  |   await emitir(page, "Hum, deixa eu pensar um pouco.");
  99  |   await expect.poll(() => pedidos.filter((p) => p.blipId).length, { timeout: 8000 }).toBe(2);
  100 |   await page.waitForTimeout(1200);
  101 |   expect((await falas(page)).slice(antes).every((f) => ["Uhum, entendi.", "Legal, hmm.", "Hum, certo.", "Uhum, saquei.", "Tá, entendi."].includes(f))).toBe(true);
  102 |   expect(await grifos(page)).toBeGreaterThan(0);
  103 | 
  104 |   // Respondeu: a paráfrase sai por voz, o assunto fecha e o grifo some.
  105 |   await emitir(page, "Eu guardo cada número num dicionário e procuro o complemento.");
  106 |   await expect.poll(() => falas(page), { timeout: 8000 }).toContain(parafrase);
  107 |   const resposta = pedidos.filter((p) => p.blipId).at(-1)!;
  108 |   expect(resposta.messages.map((m) => m.role)).toEqual(["agent", "candidate", "candidate"]);
  109 |   await expect.poll(() => grifos(page), { timeout: 6000 }).toBe(0);
  110 | });
  111 | 
  112 | test("IDE: fala livre com pedido de feedback é respondida por voz e o grifo sai depois", async ({ page }) => {
  113 |   await preparar(page);
  114 |   const feedback = "Você guarda cada número num dicionário antes de procurar o par.";
  115 |   await page.route("**/api/events", (rota) => rota.fulfill({ json: {} }));
  116 |   await page.route("**/api/blip/pending?**", (rota) => rota.fulfill({ json: {} }));
  117 |   await page.route("**/api/chat", async (rota) => {
  118 |     const pedido = rota.request().postDataJSON() as { messages: { role: string; text: string }[] };
  119 |     const ultima = pedido.messages.findLast((m) => m.role === "candidate")?.text ?? "";
  120 |     if (/feedback/i.test(ultima)) {
  121 |       return rota.fulfill({ json: { reply: feedback, commands: [{ type: "highlight_range", startLine: 1, endLine: 2 }], end: true, concluded: true } });
  122 |     }
  123 |     return rota.fulfill({ json: { reply: "", commands: [], end: false, listening: true } });
  124 |   });
  125 |   await page.goto("/entrevista");
  126 |   await expect.poll(async () => (await falas(page)).some((f) => f.includes("pensa em voz alta"))).toBe(true);
  127 |   await expect.poll(() => ouvindo(page)).toBe(true);
  128 |   await emitir(page, "Terminei a primeira versão, pode me dar um feedback?");
  129 |   await expect.poll(() => falas(page), { timeout: 8000 }).toContain(feedback);
  130 |   await expect(page.getByRole("complementary")).toHaveCount(0);
  131 |   // A fala fechou o assunto: o grifo dela sai quando ela termina.
  132 |   await expect.poll(() => grifos(page), { timeout: 6000 }).toBe(0);
  133 | });
  134 | 
  135 | test("IDE: no meio do código o Totti pede licença; 'espera um pouquinho' adia a pergunta", async ({ page }) => {
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
> 164 |   await expect.poll(pediuLicenca, { timeout: 10_000 }).toBe(true);
      |                                                        ^ Error: expect(received).toBe(expected) // Object.is equality
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
```