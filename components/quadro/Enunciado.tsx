"use client";

import { copiarEnunciado } from "@/lib/integridade/copia";
import { nomeDoCanario } from "@/lib/integridade/canario";

/** Versão selecionável do enunciado que também está escrito no quadro. */
export default function Enunciado({ sessaoId, titulo, texto }: { sessaoId: string; titulo: string; texto: string }) {
  return (
    <details className="absolute top-[72px] left-4 z-10 max-w-sm rounded-padrao bg-superficie p-3 shadow-padrao">
      <summary className="cursor-pointer text-sm font-medium">Enunciado</summary>
      <div className="mt-3 max-h-[50vh] overflow-auto select-text text-sm" onCopy={(e) => copiarEnunciado(e, nomeDoCanario(sessaoId))}>
        <h2 className="font-semibold">{titulo}</h2>
        <p className="mt-2 whitespace-pre-wrap">{texto}</p>
      </div>
    </details>
  );
}
