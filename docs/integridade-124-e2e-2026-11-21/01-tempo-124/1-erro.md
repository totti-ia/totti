# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tempo-de-resposta.spec.ts >> quadro: fim natural mede a primeira fala sem criar um envio de medida
- Location: e2e\tempo-de-resposta.spec.ts:106:7

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('header[data-secao="cabeçalho"]')
Timeout: 15000ms
- Expected  - 9
+ Received  + 1

- Desenvolvedor(a) Backend Pleno · relatório da entrevista de Live Coding
-
- 32 min
-
- O Totti recomenda
- Avançar
- Nota geral3,3/46 de 6 critérios com prova
-
- Entendeu o problema antes de codar e chegou na solução O(n) com o dicionário, explicando o custo. Adaptou-se à mudança em menos de 3 minutos, com uma dica. Ponto de atenção: cita casos de borda, mas não os transforma em teste sem ser provocada.
+ Desenvolvedor(a) Backend Pleno · relatório da entrevista de Live Coding32 minO Totti recomendaAvançarNota geral3,3/46 de 6 critérios com provaEntendeu o problema antes de codar e chegou na solução O(n) com o dicionário, explicando o custo. Adaptou-se à mudança em menos de 3 minutos, com uma dica. Ponto de atenção: cita casos de borda, mas não os transforma em teste sem ser provocada.

Call log:
  - Expect "toHaveText" locator('header[data-secao="cabeçalho"]') with timeout 15000ms
  - waiting for locator('header[data-secao="cabeçalho"]')
    33 × locator resolved to <header data-secao="cabeçalho" class="flex flex-col gap-4">…</header>
       - unexpected value "Desenvolvedor(a) Backend Pleno · relatório da entrevista de Live Coding32 minO Totti recomendaAvançarNota geral3,3/46 de 6 critérios com provaEntendeu o problema antes de codar e chegou na solução O(n) com o dicionário, explicando o custo. Adaptou-se à mudança em menos de 3 minutos, com uma dica. Ponto de atenção: cita casos de borda, mas não os transforma em teste sem ser provocada."

```

```yaml
- paragraph: Desenvolvedor(a) Backend Pleno · relatório da entrevista de Live Coding
- paragraph: 32 min
- text: O Totti recomenda
- heading "Avançar" [level=1]
- text: Nota geral3,3/46 de 6 critérios com prova
- paragraph: "Entendeu o problema antes de codar e chegou na solução O(n) com o dicionário, explicando o custo. Adaptou-se à mudança em menos de 3 minutos, com uma dica. Ponto de atenção: cita casos de borda, mas não os transforma em teste sem ser provocada."
```

# Test source

```ts
  110 |       const fim = await page.evaluate(() => {
  111 |         (window as unknown as JanelaTeste).vozTeste.terminar();
  112 |         return Date.now();
  113 |       });
  114 |       await expect.poll(() => ouvindo(page)).toBe(true);
  115 |       await page.waitForTimeout(1500);
  116 |       const comeco = await page.evaluate((texto) => {
  117 |         const em = Date.now();
  118 |         (window as unknown as JanelaTeste).vozTeste.emitir(texto);
  119 |         return em;
  120 |       }, RESPOSTA);
  121 |       await expect.poll(dados.resposta).toBeDefined();
  122 |       const fala = dados.resposta()!;
  123 |       if (base) expect(fala).not.toHaveProperty("latenciaMs");
  124 |       else {
  125 |         expect(fala.latenciaMs).toBeGreaterThanOrEqual(1000);
  126 |         expect(Math.abs(fala.latenciaMs! - (comeco - fim))).toBeLessThan(700);
  127 |       }
  128 |       // Janela fixa após o mesmo gesto nas duas versões; inclui flush de eventos e rascunhos.
  129 |       await page.waitForTimeout(1200);
  130 |       if (sala === "quadro") {
  131 |         const gravacao = gravacaoDoQuadro(dados.eventosQuadro.map((e) => ({ ...e, recebidoEm: Date.parse(e.horario) })), [], dados.inicio);
  132 |         const gravada = gravacao.falas.find((f) => f.role === "candidate" && f.text === RESPOSTA);
  133 |         expect(gravada).toBeDefined();
  134 |         expect(gravada?.latenciaMs).toBe(fala.latenciaMs);
  135 |       }
  136 |       // Não supõe igualdade entre turnos interrompidos e normais. O anexo permite comparar
  137 |       // este MESMO cenário com a main, inclusive rotas adicionais desconhecidas deste teste.
  138 |     } finally { await anexar(testInfo, dados); }
  139 |     // Fora da janela de contagem dos POSTs, idêntica à execução na main.
  140 |     if (sala === "quadro" && !base) await conferirRelatorio(page, dados);
  141 |   });
  142 | 
  143 |   test(`${sala}: corte manual não envia latência`, async ({ page }, testInfo) => {
  144 |     const dados = await prepararSala(page, sala);
  145 |     try {
  146 |       await abrir(page, sala);
  147 |       // Dá tempo para o handler de Escape acompanhar o estado do player.
  148 |       await expect(page.getByRole("button", { name: /Interromper/ }).first()).toBeVisible();
  149 |       await page.keyboard.press("Escape");
  150 |       await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.falando)).toBe(false);
  151 |       await expect.poll(() => ouvindo(page)).toBe(true);
  152 |       await emitir(page, RESPOSTA);
  153 |       await expect.poll(dados.resposta).toBeDefined();
  154 |       expect(dados.resposta()).not.toHaveProperty("latenciaMs");
  155 |       if (sala === "ide") expect(dados.eventosIde.some((e) => e.type === "speech_interrupted" && e.by === "manual")).toBe(true);
  156 |       await page.waitForTimeout(1200);
  157 |     } finally { await anexar(testInfo, dados); }
  158 |   });
  159 | 
  160 |   test(`${sala}: voz sobreposta dispara o detector e não envia latência`, async ({ page }, testInfo) => {
  161 |     const dados = await prepararSala(page, sala);
  162 |     const scribe = await prepararScribeFalso(page);
  163 |     try {
  164 |       // Primeiro conecta em silêncio; depois segura a pergunta do Totti.
  165 |       await abrir(page, sala, scribe);
  166 |       await expect.poll(scribe.conectado).toBe(true);
  167 |       await expect(page.getByRole("button", { name: /Interromper/ }).first()).toBeVisible();
  168 |       await page.waitForTimeout(300);
  169 |       await scribe.blocos(0, 2500); // Ignorado inicial e linha de base em silêncio.
  170 |       await scribe.blocos(0.4, 700); // Acima do piso: interrompe pela vigília real.
  171 |       await expect.poll(() => page.evaluate(() => (window as unknown as JanelaTeste).vozTeste.falando)).toBe(false);
  172 |       await page.waitForTimeout(400); // Sala reativa o portão e reaproveita o trecho anterior.
  173 |       await scribe.blocos(0.4, 3000);
  174 |       scribe.emitir(RESPOSTA);
  175 |       await expect.poll(dados.resposta).toBeDefined();
  176 |       expect(dados.resposta()).not.toHaveProperty("latenciaMs");
  177 |       if (sala === "ide") expect(dados.eventosIde.some((e) => e.type === "speech_interrupted" && e.by === "voz")).toBe(true);
  178 |       await page.waitForTimeout(1200);
  179 |     } finally { await anexar(testInfo, dados); }
  180 |   });
  181 | }
  182 | 
  183 | /** Render complementar com os eventos capturados acima; não gera relatório por LLM. */
  184 | async function conferirRelatorio(page: Page, dados: Awaited<ReturnType<typeof prepararSala>>) {
  185 |   const report = relatorioExemplo();
  186 |   const semMedida = dados.eventosQuadro.map((e) => {
  187 |     if (!e.dados || typeof e.dados !== "object") return e;
  188 |     const d = { ...e.dados } as Record<string, unknown>;
  189 |     delete d.latenciaMs;
  190 |     return { ...e, dados: d };
  191 |   });
  192 |   const r = relatorioDaIde(report);
  193 |   const rSemMedida = relatorioDaIde(report);
  194 |   r.integridade = integridadeDoQuadro("tempo-e2e", dados.eventosQuadro, dados.inicio);
  195 |   rSemMedida.integridade = integridadeDoQuadro("tempo-e2e", semMedida, dados.inicio);
  196 |   expect(r.integridade?.temposDeResposta?.length).toBeGreaterThan(0);
  197 |   expect(r.notaGeral).toBe(rSemMedida.notaGeral);
  198 |   expect(r.recomendacao).toBe(rSemMedida.recomendacao);
  199 |   expect(r.criterios).toEqual(rSemMedida.criterios);
  200 |   (globalThis as typeof globalThis & { React: typeof React }).React = React;
  201 |   const router = { back() {}, push() {}, replace() {}, forward() {}, refresh() {}, prefetch() {} };
  202 |   const render = (valor: typeof r) => renderToStaticMarkup(createElement(AppRouterContext.Provider,
  203 |     { value: router as never }, createElement(Relatorio, { r: valor, comDecisao: false })));
  204 |   // O HTML estático usa o componente de produção; não afirma testar carregamento ou hidratação da rota.
  205 |   await page.setContent(render(rSemMedida));
  206 |   const integridade = page.getByRole("region", { name: "Integridade", exact: true });
  207 |   await expect(integridade.getByRole("table")).toHaveCount(0);
  208 |   const cabecalhoSemMedida = await page.locator('header[data-secao="cabeçalho"]').innerText();
  209 |   await page.setContent(render(r));
> 210 |   await expect(page.locator('header[data-secao="cabeçalho"]')).toHaveText(cabecalhoSemMedida);
      |                                                                ^ Error: expect(locator).toHaveText(expected) failed
  211 |   await expect(integridade.getByRole("table")).toBeVisible();
  212 |   const linha = integridade.getByRole("row", { name: /Técnicas/ });
  213 |   await expect(linha).toBeVisible();
  214 |   const tecnica = r.integridade!.temposDeResposta!.find((d) => d.tipo === "tecnica")!;
  215 |   await expect(linha.getByRole("cell").nth(1)).toHaveText(`${(tecnica.medianaMs / 1000).toFixed(1)} s`);
  216 | }
  217 | 
```