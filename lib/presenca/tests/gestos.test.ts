import assert from "node:assert/strict";
import { test } from "node:test";
import { EsquemaVisualOpcional, INSTRUCOES_VISUAIS, atualizarRastro, criarMemoriaVisual, escolherAcoesVisuais, mapearAcoesVisuais, olharODesenho, deveCoreografarResposta, type AcaoVisual } from "../acoesVisuais";
import { comporGestos, FOLGA_DA_MARCA, formaDoElemento, lugarDaAnotacao, type CaixaComPontos, type Gesto } from "../gestos";
import { garantirMarca } from "../acoesVisuais";
import { agendarRemocaoDestaque, incluirAnotacoesComLimite, DESTAQUE_DURA_MS, DESTAQUE_TETO_MS, notaCurtaDaFala } from "../coreografia";

const area = { x: 0, y: 0, largura: 1000, altura: 700 };
const caixa = { x: 100, y: 200, largura: 160, altura: 80 };
const caixas = new Map([["r1", caixa], ["e1", { x: 500, y: 200, largura: 100, altura: 100 }]]);

test("plano inválido não quebra a fala e um traço não aceita pontos fora da região", () => {
  assert.equal(EsquemaVisualOpcional.parse([{ tipo: "traco", alvo: "r1", pontos: [[0, 0], [Infinity, 1]] }]), undefined);
  assert.equal(EsquemaVisualOpcional.parse(Array(6).fill({ tipo: "apontar", alvo: "r1" })), undefined);
  assert.deepEqual(EsquemaVisualOpcional.parse([]), []);
});
test("referência inexistente é descartada, preservando as ações válidas", () => {
  const plano: AcaoVisual[] = [{ tipo: "comparar", alvos: ["r1", "inventado"] }, { tipo: "sublinhar", alvo: "e1" }, { tipo: "anotar", texto: "Pergunta geral" }];
  assert.deepEqual(mapearAcoesVisuais(plano, (id) => caixas.has(id) ? `real-${id}` : null), [
    { tipo: "sublinhar", alvo: "real-e1" }, { tipo: "anotar", texto: "Pergunta geral" },
  ]);
});
test("memória evita repetir a marca no mesmo alvo e respeita só falar", () => {
  const memoria = criarMemoriaVisual();
  const plano: AcaoVisual[] = [{ tipo: "colchetes", alvo: "r1" }];
  assert.equal(escolherAcoesVisuais(plano, [], "", memoria).length, 1);
  assert.deepEqual(escolherAcoesVisuais(plano, [], "", memoria), []);
  assert.deepEqual(escolherAcoesVisuais([], ["r1"], "nota", memoria), []);
});
test("fallback pede a intenção (marcar), sem sortear geometria, e não fabrica desenho sem alvo", () => {
  const memoria = criarMemoriaVisual();
  assert.deepEqual(escolherAcoesVisuais(undefined, ["r1"], "", memoria), [{ tipo: "marcar", alvo: "r1" }]);
  // Acabou de marcar ali: aponta em vez de repetir a mesma marca.
  assert.deepEqual(escolherAcoesVisuais(undefined, ["r1"], "", memoria), [{ tipo: "apontar", alvo: "r1" }]);
  assert.deepEqual(escolherAcoesVisuais(undefined, [], "nota", memoria), []);
});
test("traço livre usa os pontos do modelo na região do alvo, sem alterar a caixa", () => {
  const original = structuredClone(caixa);
  const gestos = comporGestos({ tipo: "traco", alvo: "r1", pontos: [[0, 0], [0.25, 1], [1, 0.5]] }, caixas, area, 1);
  assert.deepEqual(gestos, [{ tipo: "traco", traco: { origem: { x: 100, y: 200 }, pontos: [[-10, -10], [35, 90], [170, 40]] } }]);
  assert.deepEqual(caixa, original);
});
test("percorrer acompanha o fluxo com o cursor, sem inventar conexões", () => {
  const gestos = comporGestos({ tipo: "percorrer", alvos: ["r1", "e1"] }, caixas, area, 1);
  assert.equal(gestos.length, 2);
  assert.ok(gestos.every((g) => g.tipo === "apontar"));
  assert.deepEqual(comporGestos({ tipo: "percorrer", alvos: ["r1", "sumiu"] }, caixas, area, 1), []);
});
test("anotação procura espaço visível sem cobrir os elementos", () => {
  const lugar = lugarDaAnotacao("E a leitura?", caixa, [...caixas.values()], area);
  assert.ok(lugar.x >= 0 && lugar.y >= 0 && lugar.x + lugar.largura <= area.largura && lugar.y + lugar.altura <= area.altura);
  for (const c of caixas.values()) assert.ok(lugar.x >= c.x + c.largura || lugar.x + lugar.largura <= c.x || lugar.y >= c.y + c.altura || lugar.y + lugar.altura <= c.y);
});

test("em seta diagonal longa, apontar e circular miram o meio do traço, não a caixa inteira", () => {
  // Seta de (0,0) a (600,400): a caixa cobre o quadro quase todo; o meio do traço é (300,200).
  const seta = { x: 0, y: 0, largura: 600, altura: 400, pontos: [[0, 0], [600, 400]] as const };
  const comSeta = new Map([["s1", seta]]);
  const [apontar] = comporGestos({ tipo: "apontar", alvo: "s1" }, comSeta, area, 1);
  assert.equal(apontar.tipo, "traco");
  if (apontar.tipo !== "traco") return;
  const [px, py] = apontar.traco.pontos.at(-1)!;
  const ponta = { x: apontar.traco.origem.x + px, y: apontar.traco.origem.y + py };
  assert.ok(Math.hypot(ponta.x - 300, ponta.y - 200) < 20, "a setinha para perto do meio do traço");
  const [circulo] = comporGestos({ tipo: "circular", alvo: "s1" }, comSeta, area, 1);
  assert.equal(circulo.tipo, "traco");
  if (circulo.tipo !== "traco") return;
  const xs = circulo.traco.pontos.map(([x]) => circulo.traco.origem.x + x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 200, "o círculo fica pequeno, em volta do meio da seta");
});

// Quadro de exemplo com os cinco tipos de alvo (o mesmo de app/dev/gestos).
const ELIPSE: CaixaComPontos = { x: 100, y: 100, largura: 200, altura: 100, forma: "elipse" };
const RETANGULO: CaixaComPontos = { x: 400, y: 100, largura: 180, altura: 90, forma: "retangulo" };
const LOSANGO: CaixaComPontos = { x: 100, y: 320, largura: 160, altura: 120, forma: "losango" };
const SETA: CaixaComPontos = { x: 300, y: 150, largura: 100, altura: 0, forma: "seta", pontos: [[0, 0], [100, 0]] };
const TEXTO: CaixaComPontos = { x: 400, y: 340, largura: 150, altura: 25, forma: "texto" };
const ALVOS = new Map<string, CaixaComPontos>([["e1", ELIPSE], ["r1", RETANGULO], ["d1", LOSANGO], ["s1", SETA], ["t1", TEXTO]]);

function pontosDe(g: Gesto): { x: number; y: number }[] {
  return g.tipo === "traco" ? g.traco.pontos.map(([x, y]) => ({ x: g.traco.origem.x + x, y: g.traco.origem.y + y })) : [];
}
/** O ponto fica fora da peça (por onde o texto dela passa), com folga. */
function foraDaPeca(c: CaixaComPontos, p: { x: number; y: number }, folga = FOLGA_DA_MARCA - 1): boolean {
  const cx = c.x + c.largura / 2;
  const cy = c.y + c.altura / 2;
  if (c.forma === "elipse") return ((p.x - cx) / (c.largura / 2 + folga)) ** 2 + ((p.y - cy) / (c.altura / 2 + folga)) ** 2 >= 1;
  if (c.forma === "losango") return Math.abs(p.x - cx) / (c.largura / 2 + folga) + Math.abs(p.y - cy) / (c.altura / 2 + folga) >= 1;
  if (c.forma === "seta") return Math.abs(p.y - c.y) >= folga;
  // Texto: o sublinhado encosta na linha de base, sem entrar nela.
  const f = c.forma === "texto" ? 2 : folga;
  return p.x <= c.x - f || p.x >= c.x + c.largura + f || p.y <= c.y - f || p.y >= c.y + c.altura + f;
}

test("pergunta sobre uma elipse mostra um contorno em volta dela, não uma linha embaixo", () => {
  const [g] = comporGestos({ tipo: "sublinhar", alvo: "e1" }, ALVOS, area, 3);
  assert.equal(g.tipo, "traco");
  const pts = pontosDe(g);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  assert.ok(Math.min(...ys) < ELIPSE.y && Math.max(...ys) > ELIPSE.y + ELIPSE.altura, "passa por cima e por baixo");
  assert.ok(Math.min(...xs) < ELIPSE.x && Math.max(...xs) > ELIPSE.x + ELIPSE.largura, "e pelos dois lados");
  assert.ok(pts.every((p) => foraDaPeca(ELIPSE, p)));
});

test("nenhum gesto cruza a peça nos cinco tipos de alvo", () => {
  for (const [id, c] of ALVOS) {
    for (const tipo of ["marcar", "sublinhar", "circular", "enquadrar", "colchetes", "apontar"] as const) {
      for (const g of comporGestos({ tipo, alvo: id }, ALVOS, area, 7)) {
        for (const p of pontosDe(g)) assert.ok(foraDaPeca(c, p), `${tipo} em ${c.forma} passou por (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
      }
    }
  }
});

test("a forma decide o gesto: retângulo ganha um canto, texto um sublinhado colado, seta um realce ao lado", () => {
  const [ret] = comporGestos({ tipo: "marcar", alvo: "r1" }, ALVOS, area, 1);
  const pr = pontosDe(ret);
  assert.ok(pr.length >= 3 && pr.some((p) => p.y > RETANGULO.y + RETANGULO.altura) && pr.some((p) => p.x > RETANGULO.x + RETANGULO.largura));
  assert.ok(pr.every((p) => p.x > RETANGULO.x + RETANGULO.largura * 0.5), "contorno parcial, não a caixa inteira");
  const [txt] = comporGestos({ tipo: "marcar", alvo: "t1" }, ALVOS, area, 1);
  assert.ok(pontosDe(txt).every((p) => p.y > TEXTO.y + TEXTO.altura && p.y <= TEXTO.y + TEXTO.altura + 8), "colado na linha de base");
  const [seta] = comporGestos({ tipo: "marcar", alvo: "s1" }, ALVOS, area, 1);
  const ps = pontosDe(seta);
  assert.ok(ps.every((p) => p.x > 300 && p.x < 400), "fica no trecho do meio");
  for (const g of [ret, txt, seta]) assert.equal(g.tipo === "traco" && g.destaque, true, "marca é destaque temporário");
});

test("apontar deixa uma setinha que para perto da borda, sem cobrir a peça", () => {
  for (const [id, c] of ALVOS) {
    const [g, asas] = comporGestos({ tipo: "apontar", alvo: id }, ALVOS, area, 2);
    assert.ok(g.tipo === "traco" && g.destaque && asas?.tipo === "traco" && asas.destaque, `apontar em ${c.forma} vira haste e ponta temporárias`);
    const pts = pontosDe(g);
    const ponta = pts.at(-1)!;
    const cx = c.x + c.largura / 2;
    const cy = c.y + c.altura / 2;
    assert.ok(Math.hypot(ponta.x - cx, ponta.y - cy) < Math.hypot(pts[0].x - cx, pts[0].y - cy), "vem de fora em direção à peça");
  }
});

test("anotar e as letras do comparar ficam; o contorno do comparar é destaque", () => {
  const gestos = comporGestos({ tipo: "comparar", alvos: ["e1", "r1"] }, ALVOS, area, 1);
  assert.deepEqual(gestos.map((g) => g.tipo === "traco" ? `traco:${g.destaque}` : g.tipo), ["traco:true", "texto", "traco:true", "texto"]);
  const [nota] = comporGestos({ tipo: "anotar", alvo: "e1", texto: "Leitura ou escrita?" }, ALVOS, area, 1);
  assert.equal(nota.tipo, "texto");
});

test("garantirMarca escolhe gesto por quantidade e conexões; mantém compatibilidade sem conexões", () => {
  assert.deepEqual(garantirMarca(undefined, ["e1"], 3), [{ tipo: "marcar", alvo: "e1" }]);
  assert.deepEqual(garantirMarca([{ tipo: "apontar", alvo: "e1" }], ["e1"]), [{ tipo: "apontar", alvo: "e1" }]);
  assert.deepEqual(garantirMarca([{ tipo: "anotar", texto: "?" }], ["e1"]), [{ tipo: "marcar", alvo: "e1" }, { tipo: "anotar", texto: "?" }]);
  assert.deepEqual(garantirMarca(undefined, ["r1", "e1"], 0, [["r1", "e1"]]), [{ tipo: "percorrer", alvos: ["r1", "e1"] }]);
  assert.deepEqual(garantirMarca(undefined, ["r1", "e1", "r2"], 0, [["r1", "e1"], ["e1", "r2"]]), [{ tipo: "percorrer", alvos: ["r1", "e1", "r2"] }]);
  assert.deepEqual(garantirMarca(undefined, ["r2", "r1", "e1"], 0, [["r1", "e1"], ["e1", "r2"]]), [{ tipo: "percorrer", alvos: ["r1", "e1", "r2"] }]);
  assert.deepEqual(garantirMarca(undefined, ["r1", "e1", "r2", "e2", "r3"], 0, [["r1", "e1"], ["e1", "r2"], ["r2", "e2"], ["e2", "r3"]]), [
    { tipo: "percorrer", alvos: ["r1", "e1", "r2", "e2"] }, { tipo: "percorrer", alvos: ["e2", "r3"] },
  ]);
  assert.deepEqual(garantirMarca(undefined, ["r1", "e1"], 0, []), [{ tipo: "comparar", alvos: ["r1", "e1"] }]);
  assert.deepEqual(garantirMarca(undefined, ["r1", "e1"]), [{ tipo: "marcar", alvo: "r1" }]);
  assert.deepEqual(garantirMarca([{ tipo: "enquadrar", alvo: "r4" }], ["r3"]), [{ tipo: "enquadrar", alvo: "r4" }]);
  assert.deepEqual(olharODesenho("CONEXÕES\n- [r1] → [e1]\n- [e1] → [r2]"), [{ tipo: "percorrer", alvos: ["r1", "e1", "r2"] }]);
  assert.deepEqual(olharODesenho("CONEXÕES\n- [e1] → [r2]\n- [r1] → [e1]"), [{ tipo: "percorrer", alvos: ["r1", "e1", "r2"] }]);
  const grafoReal = "COMPONENTES\n- [r1] Cliente (retângulo)\n- [r2] API (retângulo)\n- [e1] Banco (elipse)\nCONEXÕES\n- [s1] Cliente → API\n- [s2] API → Banco";
  assert.deepEqual(olharODesenho(grafoReal), [{ tipo: "percorrer", alvos: ["r1", "r2", "e1"] }]);
  assert.deepEqual(garantirMarca([{ tipo: "apontar", alvo: "r1" }], ["r1", "e1"]), [{ tipo: "apontar", alvo: "r1" }]);
  assert.deepEqual(garantirMarca([{ tipo: "marcar", alvo: "r1" }], ["r1", "e1"], 0, [["r1", "e1"]]), [
    { tipo: "percorrer", alvos: ["r1", "e1"] }, { tipo: "marcar", alvo: "r1" },
  ]);
  const longo = "CONEXÕES\n" + Array.from({ length: 6 }, (_, i) => `- [r${i + 1}] → [r${i + 2}]`).join("\n");
  assert.deepEqual(olharODesenho(longo), [
    { tipo: "percorrer", alvos: ["r1", "r2", "r3", "r4"] },
    { tipo: "percorrer", alvos: ["r4", "r5", "r6", "r7"] },
  ]);
  const ramificado = "CONEXÕES\n- [r1] → [r2]\n- [r1] → [e1]\n- [e1] → [r3]";
  assert.deepEqual(olharODesenho(ramificado), [{ tipo: "percorrer", alvos: ["r1", "e1", "r3"] }], "escolhe o ramo mais longo");
});

test("rastro de uma fala respeita cinco ações e prioriza a primeira peça", () => {
  const cinco: AcaoVisual[] = [
    { tipo: "marcar", alvo: "r1" }, { tipo: "apontar", alvo: "r2" }, { tipo: "circular", alvo: "r3" },
    { tipo: "sublinhar", alvo: "r4" }, { tipo: "comparar", alvos: ["r1", "r2"] },
  ];
  const comRastro = incluirAnotacoesComLimite(cinco, ["r1", "r2", "r3"], "Qual é o caminho?");
  assert.equal(comRastro.length, 5);
  assert.deepEqual(comRastro[4], { tipo: "anotar", alvo: "r1", texto: "Qual é o caminho?" });
  const comEspaco = incluirAnotacoesComLimite(cinco.slice(0, 3), ["r1", "r2", "r3"], "Qual é o caminho?");
  assert.equal(comEspaco.length, 5);
  assert.deepEqual(comEspaco.slice(-2).map((a) => a.tipo === "anotar" ? a.alvo : null), ["r1", "r2"]);
});

test("resposta citando peça coreografa mesmo sem visual explícito", () => {
  assert.equal(deveCoreografarResposta(false, 1, false, false), true);
  assert.equal(deveCoreografarResposta(false, 0, false, false), false);
  assert.equal(deveCoreografarResposta(true, 0, false, false), true);
});

test("instruções visuais não ultrapassam o tamanho do prompt da main", () => {
  assert.ok(INSTRUCOES_VISUAIS.length <= 1740, `comprimento atual: ${INSTRUCOES_VISUAIS.length}`);
});

test("ações novas são aceitas; numerar só segue setas existentes", () => {
  const plano = EsquemaVisualOpcional.parse([
    { tipo: "agrupar", alvos: ["r1", "e1"] },
    { tipo: "numerar", alvos: ["r1", "e1"] },
    { tipo: "interrogar", alvo: "r1" },
  ])!;
  const mapa = new Map([
    ["r1", { ...caixa, forma: "retangulo" as const }], ["e1", { x: 500, y: 200, largura: 100, altura: 100, forma: "elipse" as const }],
  ]);
  const desenhos = plano.flatMap((acao) => comporGestos(acao, mapa, area, 7, [["r1", "e1"]]));
  assert.ok(desenhos.filter((g) => g.tipo === "traco" && g.destaque).length >= 8, "agrupar desenha contorno tracejado temporário");
  assert.deepEqual(desenhos.filter((g) => g.tipo === "texto").map((g) => g.tipo === "texto" ? g.texto : ""), ["1", "2", "?"]);
  assert.deepEqual(comporGestos({ tipo: "numerar", alvos: ["r1", "e1"] }, mapa, area, 7), [], "sem aresta validada não numera como fluxo");
});

test("sublinhar encontra o rótulo ligado à peça e traça sob o texto", () => {
  const comRotulo = new Map<string, CaixaComPontos>([
    ["r1", { ...RETANGULO }], ["t1", { ...TEXTO, x: 420, y: 120, containerId: "r1" }],
  ]);
  const [g] = comporGestos({ tipo: "sublinhar", alvo: "r1" }, comRotulo, area, 1);
  assert.equal(g.tipo, "traco");
  if (g.tipo === "traco") assert.equal(g.traco.origem.x, 420);
});

test("destaque aguarda fim da fala e resposta; teto de 45 s começa no fim da fala", async () => {
  let agora = 0;
  let id = 0;
  const pendentes = new Map<number, { em: number; cb: () => void }>();
  const relogio = {
    set(cb: () => void, ms: number) { const chave = ++id; pendentes.set(chave, { em: agora + ms, cb }); return chave as unknown as ReturnType<typeof setTimeout>; },
    clear(chave?: ReturnType<typeof setTimeout>) { if (chave !== undefined) pendentes.delete(chave as unknown as number); },
  };
  const avancar = (ms: number) => {
    const fim = agora + ms;
    for (;;) {
      const proximo = [...pendentes.entries()].filter(([, p]) => p.em <= fim).sort((a, b) => a[1].em - b[1].em)[0];
      if (!proximo) break;
      agora = proximo[1].em;
      pendentes.delete(proximo[0]);
      proximo[1].cb();
    }
    agora = fim;
  };
  let apagamentos = 0;
  const controller = new AbortController();
  let encerrarFala!: () => void;
  const fimDaFala = new Promise<void>((resolve) => { encerrarFala = resolve; });
  agendarRemocaoDestaque(() => apagamentos++, controller.signal, false, relogio, fimDaFala);
  avancar(DESTAQUE_DURA_MS + 1);
  controller.abort();
  assert.equal(apagamentos, 0, "não apaga no meio da fala, mesmo se a resposta já terminou");
  encerrarFala();
  await Promise.resolve();
  assert.equal(apagamentos, 1, "apaga ao terminar a fala quando a resposta já terminou");

  apagamentos = 0;
  let encerrarFalaLonga!: () => void;
  const falaLonga = new Promise<void>((resolve) => { encerrarFalaLonga = resolve; });
  const resposta = new AbortController();
  agendarRemocaoDestaque(() => apagamentos++, resposta.signal, false, relogio, falaLonga);
  avancar(DESTAQUE_TETO_MS * 2);
  assert.equal(apagamentos, 0, "fala longa não inicia nem consome o teto antes de terminar");
  encerrarFalaLonga();
  await Promise.resolve();
  avancar(DESTAQUE_TETO_MS - 1);
  assert.equal(apagamentos, 0, "permanece durante a resposta até o teto");
  avancar(1);
  assert.equal(apagamentos, 1, "o teto remove mesmo sem sinal de fim da resposta");

  apagamentos = 0;
  const respostaCurta = new AbortController();
  agendarRemocaoDestaque(() => apagamentos++, respostaCurta.signal, false, relogio);
  avancar(DESTAQUE_DURA_MS + 1);
  assert.equal(apagamentos, 0, "não apaga enquanto a resposta segue aberta");
  respostaCurta.abort();
  assert.equal(apagamentos, 1, "apaga no fim da resposta");

  apagamentos = 0;
  agendarRemocaoDestaque(() => apagamentos++, new AbortController().signal, false, relogio);
  avancar(DESTAQUE_TETO_MS);
  assert.equal(apagamentos, 1, "o teto remove mesmo sem sinal");

  apagamentos = 0;
  const semPergunta = new AbortController();
  agendarRemocaoDestaque(() => apagamentos++, semPergunta.signal, true, relogio, Promise.resolve());
  await Promise.resolve();
  avancar(DESTAQUE_DURA_MS - 1);
  assert.equal(apagamentos, 0, "não remove antes de terminar a fala e passar 9 s");
  semPergunta.abort();
  assert.equal(apagamentos, 0, "o fim da resposta não apaga gesto de fala sem pergunta");
  avancar(1);
  assert.equal(apagamentos, 1);
});

test("rastro substitui nota por peça e mantém no máximo oito peças recentes", () => {
  let rastro = new Map<string, string>();
  for (let i = 0; i < 8; i++) rastro = atualizarRastro(rastro, `p${i}`, `nota ${i}`).rastro;
  const substituida = atualizarRastro(rastro, "p3", "nova nota");
  assert.equal(substituida.rastro.size, 8);
  assert.deepEqual(substituida.removidos, ["nota 3"]);
  const nona = atualizarRastro(substituida.rastro, "p8", "nota 8");
  assert.equal(nona.rastro.size, 8);
  assert.deepEqual(nona.removidos, ["nota 0"]);
  assert.equal(nona.rastro.get("p3"), "nova nota");
  assert.equal(nona.rastro.has("p8"), true);
});

test("nota curta do rastro vem das quatro primeiras palavras da fala", () => {
  assert.equal(notaCurtaDaFala("  Como   escala essa peça muda com tráfego?"), "Como escala essa peça");
  assert.equal(notaCurtaDaFala("  "), "");
});

test("tipos do Excalidraw viram a forma do alvo", () => {
  assert.equal(formaDoElemento("ellipse"), "elipse");
  assert.equal(formaDoElemento("diamond"), "losango");
  assert.equal(formaDoElemento("freedraw"), "outra");
});
