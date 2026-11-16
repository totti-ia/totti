import type { ClipboardEvent } from "react";
import { fraseDoCanario } from "./canario";

/** Só a área de transferência recebe a frase. Não altera a cena, o DOM ou os prompts. */
export function textoCopiadoComCanario(texto: string, canario?: string | null): string {
  return canario && texto.trim().length >= 60 ? `${texto}\n\n${fraseDoCanario(canario)}` : texto;
}

export function copiarEnunciado(e: ClipboardEvent, canario?: string | null) {
  const selecionado = window.getSelection()?.toString() ?? "";
  const copiado = textoCopiadoComCanario(selecionado, canario);
  if (copiado === selecionado) return;
  e.preventDefault();
  e.clipboardData.setData("text/plain", copiado);
}
