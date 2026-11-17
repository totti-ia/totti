/** Falhas de infraestrutura ou avaliações ausentes não produzem uma comparação confiável. */
export function comparavel(p: { casos: { nota?: unknown }[]; conversas: { juiz?: unknown }[]; resumo: { falhasDeProvedor: number } }): boolean {
  return p.casos.length > 0 && p.conversas.length > 0 && p.casos.every((c) => !!c.nota) && p.conversas.every((c) => !!c.juiz) && p.resumo.falhasDeProvedor === 0;
}
