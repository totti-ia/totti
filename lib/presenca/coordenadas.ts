import { centro, normalizarCaixa } from "./interno";
import type { Caixa, Ponto } from "./tipos";

export type { Caixa, Ponto } from "./tipos";

export type Vista = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  offsetLeft: number;
  offsetTop: number;
  largura: number;
  altura: number;
};

function validarZoom(v: Vista): void {
  if (!Number.isFinite(v.zoom) || v.zoom <= 0) {
    throw new RangeError("O zoom deve ser finito e maior que zero.");
  }
}

/** Resultado em pixels da janela, incluindo o deslocamento do quadro. */
export function cenaParaTela(p: Ponto, v: Vista): Ponto {
  validarZoom(v);
  return {
    x: (p.x + v.scrollX) * v.zoom + v.offsetLeft,
    y: (p.y + v.scrollY) * v.zoom + v.offsetTop,
  };
}

export function telaParaCena(p: Ponto, v: Vista): Ponto {
  validarZoom(v);
  return {
    x: (p.x - v.offsetLeft) / v.zoom - v.scrollX,
    y: (p.y - v.offsetTop) / v.zoom - v.scrollY,
  };
}

/** Folga em unidades da cena; aceita também dimensões negativas dos elementos. */
export function caixaDosElementos(
  elementos: readonly { x: number; y: number; width: number; height: number }[],
  folga = 16,
): Caixa | null {
  if (!elementos.length) return null;
  let esquerda = Infinity;
  let topo = Infinity;
  let direita = -Infinity;
  let base = -Infinity;
  for (const e of elementos) {
    esquerda = Math.min(esquerda, e.x, e.x + e.width);
    topo = Math.min(topo, e.y, e.y + e.height);
    direita = Math.max(direita, e.x, e.x + e.width);
    base = Math.max(base, e.y, e.y + e.height);
  }
  const margem = Math.max(0, folga);
  return {
    x: esquerda - margem,
    y: topo - margem,
    largura: direita - esquerda + 2 * margem,
    altura: base - topo + 2 * margem,
  };
}

/** A margem é em pixels da tela, independentemente do zoom. */
export function estaVisivel(c: Caixa, v: Vista, margem = 24): boolean {
  const caixa = normalizarCaixa(c);
  const inicio = cenaParaTela(caixa, v);
  const fim = cenaParaTela({ x: caixa.x + caixa.largura, y: caixa.y + caixa.altura }, v);
  const m = Math.max(0, margem);
  return inicio.x >= v.offsetLeft + m && inicio.y >= v.offsetTop + m
    && fim.x <= v.offsetLeft + v.largura - m && fim.y <= v.offsetTop + v.altura - m;
}

/** A união dos alvos só precisa reduzir o zoom quando não cabe na área interna do quadro. */
export function precisaReduzirZoom(c: Caixa, v: Vista, margemPx = 60): boolean {
  validarZoom(v);
  const disponivelLargura = Math.max(0, v.largura - 2 * margemPx);
  const disponivelAltura = Math.max(0, v.altura - 2 * margemPx);
  return c.largura * v.zoom > disponivelLargura || c.altura * v.zoom > disponivelAltura;
}

/** Mantém o zoom; caixas maiores que a vista continuam parcialmente cortadas. */
export function scrollParaCentralizar(c: Caixa, v: Vista): { scrollX: number; scrollY: number } {
  validarZoom(v);
  const p = centro(c);
  return { scrollX: v.largura / (2 * v.zoom) - p.x, scrollY: v.altura / (2 * v.zoom) - p.y };
}
