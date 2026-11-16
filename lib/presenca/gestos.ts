import { contornoAMao, setaAMao, type Traco } from "./formas";
import type { AcaoVisual } from "./acoesVisuais";
import type { Caixa, Ponto } from "./tipos";
import { quebrarLinhas } from "../excalidraw/texto";

/**
 * `destaque`: marca temporária (contorno, apontar, realce), que some sozinha; o resto (nota, letras do comparar,
 * traço livre) fica.
 */
export type Gesto = { tipo: "traco"; traco: Traco; destaque?: boolean } | { tipo: "apontar"; ponto: Ponto }
  | { tipo: "texto"; texto: string; ponto: Ponto };
/** Forma da peça no quadro (o tipo do elemento do Excalidraw): o gesto de marcar depende dela. */
export type FormaDoAlvo = "retangulo" | "elipse" | "losango" | "seta" | "linha" | "texto" | "outra";
/** Caixa de um elemento; setas e linhas podem trazer a polilinha (pontos relativos a x,y) em `pontos`. */
export type CaixaComPontos = Caixa & { pontos?: readonly (readonly [number, number])[]; forma?: FormaDoAlvo; containerId?: string | null };

/** Tipo do elemento do Excalidraw → forma do alvo. */
export function formaDoElemento(tipo: string): FormaDoAlvo {
  switch (tipo) {
    case "rectangle": return "retangulo";
    case "ellipse": return "elipse";
    case "diamond": return "losango";
    case "arrow": return "seta";
    case "line": return "linha";
    case "text": return "texto";
    default: return "outra";
  }
}

/** Distância mínima entre a tinta do Totti e a borda da peça: nunca risca por cima do texto dela. */
export const FOLGA_DA_MARCA = 10;

/** Ponto médio ao longo da polilinha (pelo comprimento). */
function pontoMedioDaPolilinha(c: CaixaComPontos): Ponto | null {
  const pts = c.pontos;
  if (!pts || pts.length < 2) return null;
  const trechos = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = trechos.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let alvo = total / 2;
  for (let i = 0; i < trechos.length; i++) {
    if (alvo <= trechos[i] || i === trechos.length - 1) {
      const f = trechos[i] === 0 ? 0 : alvo / trechos[i];
      return { x: c.x + pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y: c.y + pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f };
    }
    alvo -= trechos[i];
  }
  return null;
}
const meio = (c: Caixa): Ponto => pontoMedioDaPolilinha(c) ?? { x: c.x + c.largura / 2, y: c.y + c.altura / 2 };
/** Numa seta ou linha, os gestos de contorno miram um trecho pequeno no meio dela, não a caixa inteira
 * (uma seta diagonal longa virava um círculo cobrindo metade do quadro). */
function focoDe(c: CaixaComPontos): Caixa {
  const m = pontoMedioDaPolilinha(c);
  return m ? { x: m.x - 40, y: m.y - 26, largura: 80, altura: 52 } : c;
}
const traco = (c: Caixa, pontos: [number, number][], destaque = false): Gesto =>
  ({ tipo: "traco", traco: { origem: { x: c.x, y: c.y }, pontos }, ...(destaque ? { destaque } : {}) });
/** Sublinhado colado na linha de base: só para texto solto. */
const sublinharTexto = (c: Caixa): Gesto => traco(c, [[-2, c.altura + 4], [c.largura * 0.45, c.altura + 6], [c.largura + 2, c.altura + 3]], true);

/**
 * Retângulo (e o que não tem forma própria): contorno parcial, um "L" à mão no canto de baixo à direita, por fora
 * da peça. Marca sem fechar a caixa nem passar por baixo dela.
 */
function cantoAMao(c: Caixa, semente: number): Gesto {
  const f = FOLGA_DA_MARCA;
  const tremor = ((semente % 7) - 3) * 0.6;
  return traco(c, [
    [c.largura * 0.55, c.altura + f + 1],
    [c.largura * 0.8, c.altura + f + 2 + tremor * 0.3],
    [c.largura + f, c.altura + f],
    [c.largura + f + 2 + tremor * 0.3, c.altura * 0.8],
    [c.largura + f + 1, c.altura * 0.45],
  ], true);
}

/** Seta ou linha: um arco curto ao lado do trecho do meio, sem encostar no traço. */
function realceDaSeta(c: CaixaComPontos): Gesto {
  const pts = c.pontos;
  const m = pontoMedioDaPolilinha(c) ?? meio(c);
  let dx = 1;
  let dy = 0;
  if (pts && pts.length >= 2) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    dx = (b[0] - a[0]) / d;
    dy = (b[1] - a[1]) / d;
  }
  const n = { x: -dy, y: dx };
  const afastar = FOLGA_DA_MARCA + 6;
  const pontos: [number, number][] = [-1, -0.5, 0, 0.5, 1].map((t) => {
    const curva = (1 - t * t) * 5;
    return [dx * t * 28 + n.x * (afastar + curva), dy * t * 28 + n.y * (afastar + curva)];
  });
  return { tipo: "traco", traco: { origem: { x: m.x, y: m.y }, pontos }, destaque: true };
}

/** Seta ou linha (também quando só a polilinha veio, sem a forma). */
const ehLinear = (c: CaixaComPontos) => c.forma === "seta" || c.forma === "linha" || (!c.forma && !!c.pontos);

/** Marcar uma peça: a geometria sai da forma dela, não de sorteio. */
function marcar(c: CaixaComPontos, semente: number): Gesto {
  if (ehLinear(c)) return realceDaSeta(c);
  switch (c.forma) {
    case "elipse":
    case "losango":
      return { tipo: "traco", traco: contornoAMao(c, semente, FOLGA_DA_MARCA), destaque: true };
    case "seta":
    case "linha":
      return realceDaSeta(c);
    case "texto":
      return sublinharTexto(c);
    default:
      return cantoAMao(c, semente);
  }
}

/** Ponto na borda da peça na direção `dir` (unitária) a partir do centro, já afastado pela folga. */
function bordaComFolga(c: CaixaComPontos, dir: Ponto, folga: number): Ponto {
  const centro = { x: c.x + c.largura / 2, y: c.y + c.altura / 2 };
  const [a, b] = [c.largura / 2, c.altura / 2];
  let r: number;
  if (c.forma === "elipse") r = 1 / Math.sqrt((dir.x / a) ** 2 + (dir.y / b) ** 2);
  else if (c.forma === "losango") r = 1 / (Math.abs(dir.x) / a + Math.abs(dir.y) / b);
  else r = Math.min(dir.x ? a / Math.abs(dir.x) : Infinity, dir.y ? b / Math.abs(dir.y) : Infinity);
  return { x: centro.x + dir.x * (r + folga), y: centro.y + dir.y * (r + folga) };
}

/**
 * Apontar que se vê: uma setinha curta à mão vindo de fora (de cima, à esquerda) e parando a alguns pixels da borda,
 * sem cobrir o texto. Numa seta ou linha, aponta o trecho do meio.
 */
function apontar(c: CaixaComPontos, semente: number): Gesto[] {
  const dir = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  // A ponta para um pouco mais longe que as outras marcas: a seta chega na diagonal.
  const folga = FOLGA_DA_MARCA + 4;
  const para = ehLinear(c)
    ? (() => { const m = pontoMedioDaPolilinha(c) ?? meio(c); return { x: m.x - dir.x * folga, y: m.y - dir.y * folga }; })()
    : bordaComFolga(c, { x: -dir.x, y: -dir.y }, folga);
  const de = { x: para.x - dir.x * 56, y: para.y - dir.y * 56 };
  // A ponta é um "V" curto à mão, desenhado depois da haste (a seta do Excalidraw não aparecia com a haste curva).
  const asa = (giro: number): [number, number] => {
    const cos = Math.cos(Math.PI + giro);
    const sen = Math.sin(Math.PI + giro);
    return [(dir.x * cos - dir.y * sen) * 10, (dir.x * sen + dir.y * cos) * 10];
  };
  const [a1, a2] = [asa(0.5), asa(-0.5)];
  return [
    { tipo: "traco", traco: setaAMao(de, para, semente), destaque: true },
    { tipo: "traco", traco: { origem: { x: para.x + a1[0], y: para.y + a1[1] }, pontos: [[0, 0], [-a1[0], -a1[1]], [a2[0] - a1[0], a2[1] - a1[1]]] }, destaque: true },
  ];
}
function intersecao(a: Caixa, b: Caixa): number {
  return Math.max(0, Math.min(a.x + a.largura, b.x + b.largura) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.altura, b.y + b.altura) - Math.max(a.y, b.y));
}

/** Busca espaço livre ao redor do assunto e nas demais regiões visíveis. */
export function lugarDaAnotacao(texto: string, alvo: Caixa | undefined, ocupados: Caixa[], area: Caixa): Caixa {
  const linhas = quebrarLinhas(texto, 26).split("\n");
  const largura = Math.min(area.largura, Math.max(...linhas.map((l) => l.length)) * 11 + 20);
  const altura = Math.min(area.altura, linhas.length * 25 + 12);
  const referencia = alvo ?? { x: area.x, y: area.y, largura: 0, altura: 0 };
  const candidatos: Ponto[] = [
    { x: referencia.x + referencia.largura + 24, y: referencia.y },
    { x: referencia.x, y: referencia.y + referencia.altura + 24 },
    { x: referencia.x - largura - 24, y: referencia.y },
    { x: referencia.x, y: referencia.y - altura - 24 },
  ];
  for (let linha = 0; linha < 4; linha++) for (let coluna = 0; coluna < 4; coluna++) {
    candidatos.push({ x: area.x + (area.largura - largura) * coluna / 3, y: area.y + (area.altura - altura) * linha / 3 });
  }
  const caixas = candidatos.map((p) => ({
    x: Math.max(area.x, Math.min(p.x, area.x + area.largura - largura)),
    y: Math.max(area.y, Math.min(p.y, area.y + area.altura - altura)), largura, altura,
  }));
  const custo = (c: Caixa) => ocupados.reduce((s, o) => s + intersecao(c, o), 0) * 1000
    + Math.hypot(c.x - referencia.x, c.y - referencia.y);
  return caixas.reduce((melhor, c) => custo(c) < custo(melhor) ? c : melhor);
}

/** Converte o plano relativo em gestos na cena, sem modificar os elementos do candidato. */
export function comporGestos(acao: AcaoVisual, caixas: ReadonlyMap<string, CaixaComPontos>, area: Caixa, semente: number, conexoes: readonly (readonly [string, string])[] = []): Gesto[] {
  if (acao.tipo === "anotar") {
    const alvo = acao.alvo ? caixas.get(acao.alvo) : undefined;
    if (acao.alvo && !alvo) return [];
    const lugar = lugarDaAnotacao(acao.texto, alvo, [...caixas.values()], area);
    return [{ tipo: "texto", texto: acao.texto, ponto: { x: lugar.x + 10, y: lugar.y + 6 } }];
  }
  if (acao.tipo === "percorrer" || acao.tipo === "comparar") {
    const alvos = acao.alvos.map((id) => caixas.get(id));
    if (alvos.some((c) => !c)) return [];
    return alvos.flatMap((c, i): Gesto[] => acao.tipo === "percorrer"
      ? [{ tipo: "apontar", ponto: meio(c!) }]
      : [marcar(c!, semente + i), { tipo: "texto", texto: String.fromCharCode(65 + i), ponto: { x: c!.x - 22, y: c!.y } }]);
  }
  if (acao.tipo === "agrupar" || acao.tipo === "numerar") {
    const alvos = acao.alvos.map((id) => caixas.get(id));
    if (alvos.some((c) => !c)) return [];
    if (acao.tipo === "numerar") {
      if (!acao.alvos.slice(1).every((id, i) => conexoes.some(([de, ate]) => de === acao.alvos[i] && ate === id))) return [];
      return alvos.map((c, i) => ({ tipo: "texto", texto: String(i + 1), ponto: { x: c!.x - 12, y: c!.y - 18 } }));
    }
    const x = Math.min(...alvos.map((c) => c!.x)) - 12;
    const y = Math.min(...alvos.map((c) => c!.y)) - 12;
    const direita = Math.max(...alvos.map((c) => c!.x + c!.largura)) + 12;
    const baixo = Math.max(...alvos.map((c) => c!.y + c!.altura)) + 12;
    const largura = direita - x;
    const altura = baixo - y;
    const dashes: Gesto[] = [];
    const pontilhar = (ax: number, ay: number, bx: number, by: number) => {
      const comprimento = Math.hypot(bx - ax, by - ay);
      for (let inicio = 0; inicio < comprimento; inicio += 20) {
        const fim = Math.min(inicio + 12, comprimento);
        const p1 = { x: ax + (bx - ax) * inicio / comprimento, y: ay + (by - ay) * inicio / comprimento };
        const p2 = { x: ax + (bx - ax) * fim / comprimento, y: ay + (by - ay) * fim / comprimento };
        dashes.push(traco({ x: p1.x, y: p1.y, largura: 0, altura: 0 }, [[0, 0], [p2.x - p1.x, p2.y - p1.y]], true));
      }
    };
    pontilhar(x, y, x + largura, y);
    pontilhar(x + largura, y, x + largura, y + altura);
    pontilhar(x + largura, y + altura, x, y + altura);
    pontilhar(x, y + altura, x, y);
    return dashes;
  }
  if (acao.tipo === "interrogar") {
    const c = caixas.get(acao.alvo);
    return c ? [{ tipo: "texto", texto: "?", ponto: { x: c.x + c.largura + 8, y: c.y - 8 } }] : [];
  }
  const original = caixas.get(acao.alvo);
  if (!original) return [];
  switch (acao.tipo) {
    case "apontar": return apontar(original, semente);
    // A intenção é marcar; a forma do alvo decide o desenho (os tipos antigos chegam aqui pelo mesmo caminho).
    case "marcar":
    case "enquadrar":
    case "colchetes":
      return [marcar(original, semente)];
    case "sublinhar": {
      const rotulo = [...caixas.values()].find((c) => c.containerId === acao.alvo && c.forma === "texto");
      return [rotulo ? sublinharTexto(rotulo) : original.forma === "texto" ? sublinharTexto(original) : marcar(original, semente)];
    }
    case "circular": {
      if (ehLinear(original)) return [marcar(original, semente)];
      const raio = Math.hypot(original.largura / 2, original.altura / 2) + FOLGA_DA_MARCA;
      const circulo = original.forma === "elipse" ? contornoAMao(original, semente, FOLGA_DA_MARCA)
        : contornoAMao({ x: original.x + original.largura / 2 - raio, y: original.y + original.altura / 2 - raio, largura: raio * 2, altura: raio * 2 }, semente, 0);
      return [{ tipo: "traco", traco: circulo, destaque: true }];
    }
    case "traco": {
      const c = focoDe(original);
      return [traco(c, acao.pontos.map(([x, y]) => [-10 + x * (c.largura + 20), -10 + y * (c.altura + 20)]))];
    }
  }
}
