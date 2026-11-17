/**
 * Medição completa: casos e conversas rodaram e todos foram julgados. As falhas do Totti (prazo estourado ou erro do
 * provedor dele) não tornam o placar incomparável: são resultado da versão medida e entram na comparação.
 */
export function comparavel(p: { casos: { nota?: unknown }[]; conversas: { juiz?: unknown }[] }): boolean {
  return p.casos.length > 0 && p.conversas.length > 0 && p.casos.every((c) => !!c.nota) && p.conversas.every((c) => !!c.juiz);
}

type Base = { casos: { nome: string }[]; conversas: { persona: string }[]; modelos?: { juiz?: string; candidato?: string } };

/** O que impede comparar duas medições entre si: casos, personas, juiz ou candidato diferentes. */
export function diferencasDeBase(a: Base, b: Base): string[] {
  const conjunto = (xs: string[]) => [...xs].sort().join(", ");
  const diferencas: string[] = [];
  const casosA = conjunto(a.casos.map((c) => c.nome));
  const casosB = conjunto(b.casos.map((c) => c.nome));
  if (casosA !== casosB) diferencas.push(`casos fixos diferentes (${casosA || "nenhum"} × ${casosB || "nenhum"})`);
  const personasA = conjunto(a.conversas.map((c) => c.persona));
  const personasB = conjunto(b.conversas.map((c) => c.persona));
  if (personasA !== personasB) diferencas.push(`personas diferentes (${personasA || "nenhuma"} × ${personasB || "nenhuma"})`);
  for (const papel of ["juiz", "candidato"] as const) {
    if (a.modelos?.[papel] !== b.modelos?.[papel]) diferencas.push(`${papel} diferente (${a.modelos?.[papel]} × ${b.modelos?.[papel]})`);
  }
  return diferencas;
}
