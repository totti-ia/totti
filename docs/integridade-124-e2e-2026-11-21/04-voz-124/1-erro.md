# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: voz.spec.ts >> IDE: conversa só por voz, sem barra lateral; a pergunta sai na pausa e o grifo some quando o assunto fecha
- Location: e2e\voz.spec.ts:49:5

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected value: "O que você está montando nesse loop?"
Received array: ["Oi, eu sou o Totti e vou conduzir sua entrevista de programação, que dura uns 30 minutos. O problema está à esquerda; pensa em voz alta e me chama quando quiser."]

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - code [ref=e9]:
          - generic [ref=e10]:
            - textbox "Editor content" [ref=e11]
            - textbox [aria-hidden] [ref=e12]
            - generic [aria-hidden] [ref=e15]:
              - generic [ref=e16]:
                - generic [ref=e18] [cursor=pointer]: 
                - generic [ref=e19]: "1"
              - generic [ref=e20]: "2"
              - generic [ref=e22]: "3"
              - generic [ref=e24]: "4"
            - generic [aria-hidden] [ref=e33]:
              - generic [ref=e34]: "def two_sum(nums, target):"
              - generic [ref=e36]: "# escreva sua solução aqui"
              - generic [ref=e38]: pass
        - region "Testes e resultados" [ref=e41]:
          - generic [ref=e42]:
            - heading "Testes" [level=2] [ref=e43]
            - button "Recolher resultados" [expanded] [ref=e44]
          - paragraph [ref=e48]: Rode o código para ver os testes aqui.
      - generic [ref=e49]:
        - region "Problema" [ref=e51]:
          - generic [ref=e52]:
            - generic [ref=e53]:
              - heading "Two Sum" [level=1] [ref=e54]
              - generic [ref=e55]: 00:22 / 30:00
              - generic [ref=e57]: Fácil · Hash map
            - button "Recolher painel do problema" [ref=e58]
          - generic [ref=e61]:
            - paragraph [ref=e62]:
              - text: Dado um array de inteiros
              - code [ref=e63]: nums
              - text: e um inteiro
              - code [ref=e64]: target
              - text: ", retorne os índices de dois números que somam"
              - code [ref=e65]: target
              - text: . Existe exatamente uma solução e você não pode usar o mesmo elemento duas vezes. A resposta pode vir em qualquer ordem.
            - generic [ref=e66]:
              - heading "Exemplos" [level=2] [ref=e67]
              - generic [ref=e68]:
                - generic [ref=e69]: "Entrada: nums = [2,7,11,15], target = 9"
                - generic [ref=e70]: "Saída: [0,1]"
                - generic [ref=e71]: 2 + 7 = 9
              - generic [ref=e72]:
                - generic [ref=e73]: "Entrada: nums = [3,2,4], target = 6"
                - generic [ref=e74]: "Saída: [1,2]"
              - generic [ref=e75]:
                - generic [ref=e76]: "Entrada: nums = [3,3], target = 6"
                - generic [ref=e77]: "Saída: [0,1]"
            - generic [ref=e78]:
              - heading "Restrições" [level=2] [ref=e79]
              - list [ref=e80]:
                - listitem [ref=e81]: 2 <= len(nums) <= 10⁴
                - listitem [ref=e82]: "-10⁹ <= nums[i] <= 10⁹"
                - listitem [ref=e83]: Existe exatamente uma resposta válida
        - generic [ref=e84]:
          - combobox "Linguagem" [ref=e85]:
            - option "Python" [selected]
          - button "Finalizar" [ref=e86]
          - button "Rodar" [ref=e89]
      - generic [aria-hidden]:
        - generic: Totti
      - status "Chamada com o entrevistador" [ref=e93]:
        - generic [ref=e95]: 00:22
        - button "Desligar microfone" [ref=e96]
  - button "Open Next.js Dev Tools" [ref=e105] [cursor=pointer]
  - alert [ref=e109]
  - generic [ref=e110]:
    - alert
    - alert
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import { estadoInicialDemo, responderDemo } from "../lib/pre-entrevista/tela/demo";
  3   | import { VAGAS } from "../fixtures/pre-entrevista/vagas";
  4   | 
  5   | import { preparar, ouvindo, falas, emitir, type JanelaTeste } from "./helpers/voz-falsa";
  6   | 
  7   | async function cenaVisual(page: Page) {
  8   |   return page.evaluate(() => {
  9   |     type Elemento = { id: string; type: string; text?: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; points?: [number, number][]; customData?: { autor?: string; grupo?: string } };
  10  |     return (window as unknown as { quadro: { api: { getSceneElements(): Elemento[] } } }).quadro.api.getSceneElements()
  11  |       .filter((e) => !e.isDeleted).map((e) => ({ id: e.id, tipo: e.type, texto: e.text, x: e.x, y: e.y, largura: e.width, altura: e.height, pontos: e.points, autor: e.customData?.autor, grupo: e.customData?.grupo }));
  12  |   });
  13  | }
  14  | 
  15  | test("recrutadora dita a vaga e conversa com Totti sem repetir voz no polling", async ({ page }) => {
  16  |   await preparar(page);
  17  |   let estado = estadoInicialDemo(VAGAS[0]);
  18  |   await page.route("**/api/pre-entrevista/sessoes**", async (rota) => {
  19  |     if (rota.request().method() === "POST" && rota.request().url().endsWith("/mensagem")) {
  20  |       estado = responderDemo(estado, rota.request().postDataJSON().text);
  21  |     }
  22  |     await rota.fulfill({ json: estado });
  23  |   });
  24  |   await page.goto("/pre-entrevista/nova");
  25  |   // Os exemplos de vaga viraram cartões (um por nível e área): qualquer um preenche a vaga.
  26  |   await page.getByRole("button", { name: "Júnior Frontend" }).click();
  27  |   await page.getByRole("button", { name: "Ditar por voz" }).first().click();
  28  |   await expect.poll(() => ouvindo(page)).toBe(true);
  29  |   await emitir(page, "Precisamos de experiência com Python.");
  30  |   await expect(page.getByPlaceholder("Responsabilidades, requisitos, ferramentas do dia a dia…")).toHaveValue(/Precisamos de experiência com Python\./);
  31  |   await page.getByRole("button", { name: "Parar ditado" }).click();
  32  |   await page.getByRole("button", { name: "Começar com o Totti" }).click();
  33  |   await expect(page.getByRole("button", { name: "Silenciar respostas por voz" })).toBeVisible({ timeout: 25000 });
  34  |   await expect.poll(async () => (await falas(page)).length).toBe(1);
  35  |   await page.getByRole("button", { name: "Ditar por voz" }).click();
  36  |   await expect.poll(() => ouvindo(page)).toBe(true);
  37  |   await emitir(page, "Prefiro perguntas sobre autonomia e Python.");
  38  |   await page.getByRole("button", { name: "Parar ditado" }).click();
  39  |   await expect(page.getByRole("textbox", { name: "Mensagem para o Totti" })).toHaveValue("Prefiro perguntas sobre autonomia e Python.");
  40  |   await page.getByRole("button", { name: "Enviar", exact: true }).click();
  41  |   await expect.poll(async () => (await falas(page)).length).toBe(2);
  42  |   const quantidade = (await falas(page)).length;
  43  |   await page.waitForTimeout(1800);
  44  |   expect((await falas(page)).length).toBe(quantidade);
  45  | });
  46  | 
  47  | const grifos = (page: Page) => page.locator(".agent-highlight").count();
  48  | 
  49  | test("IDE: conversa só por voz, sem barra lateral; a pergunta sai na pausa e o grifo some quando o assunto fecha", async ({ page }) => {
  50  |   await preparar(page);
  51  |   const pergunta = "O que você está montando nesse loop?";
  52  |   const parafrase = "Então você procura o complemento a cada número.";
  53  |   const blip = { id: "pausa-e2e", preview: "Sobre o seu loop", priority: 1, createdAt: 0 };
  54  |   let liberar = false;
  55  |   let abriu = false;
  56  |   const pedidos: { blipId?: string; messages: { role: string; text: string }[] }[] = [];
  57  |   await page.route("**/api/events", async (rota) => {
  58  |     if (rota.request().postDataJSON().type === "blip_opened") abriu = true;
  59  |     await rota.fulfill({ json: {} });
  60  |   });
  61  |   await page.route("**/api/blip/pending?**", (rota) => rota.fulfill({ json: liberar && !abriu ? { blip } : {} }));
  62  |   await page.route("**/api/chat", async (rota) => {
  63  |     const pedido = rota.request().postDataJSON() as (typeof pedidos)[number];
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
> 91  |   await expect.poll(() => falas(page), { timeout: 15_000 }).toContain(pergunta);
      |                                                             ^ Error: expect(received).toContain(expected) // indexOf
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
```