"use client";

import { useEffect, useRef } from "react";
import { ouvirFoco, RegistroDeFoco } from "./saidasDeFoco";

/**
 * Registro das saídas de foco da sala (#123). Só escuta com `ativo` (a sessão de pé e ainda não encerrada): o tempo
 * antes de começar e o diálogo de encerrar ficam de fora. Quem envia chama `esvaziar()` no envio que já existe.
 */
export function useRegistroDeFoco(ativo: boolean): RegistroDeFoco {
  const ref = useRef<RegistroDeFoco | null>(null);
  ref.current ??= new RegistroDeFoco();
  const registro = ref.current;
  useEffect(() => (ativo ? ouvirFoco(registro) : undefined), [ativo, registro]);
  return registro;
}
