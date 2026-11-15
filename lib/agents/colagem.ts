import type { SessionEvent } from "@/lib/contracts";

export const COLA_MIN_LINES = 5;
const linhas = (texto: string) => texto.split("\n").map((l) => l.trim()).filter(Boolean);

/** A origem explícita vence; clientes antigos mantêm a comparação usada pela fila. */
export function colagemDeFora(evento: Extract<SessionEvent, { type: "paste" }>, codigo: string, anterior: string): boolean {
  if (evento.origem) return evento.origem === "fora";
  if (evento.lines < COLA_MIN_LINES) return false;
  const todas = codigo.split("\n");
  const inicio = Math.min(Math.max(1, evento.startLine), todas.length);
  const coladas = linhas(todas.slice(inicio - 1, inicio - 1 + evento.lines).join("\n"));
  if (coladas.length < COLA_MIN_LINES) return false;
  const tinha = new Set(linhas(anterior));
  return coladas.filter((l) => tinha.has(l)).length / coladas.length < 0.7;
}
