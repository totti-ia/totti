// O lote de saídas de foco no formato da linha do tempo do quadro (POST /api/sessoes/:id/eventos), #123.
import type { SaidaDeFoco } from "./saidasDeFoco";

export function eventoDeFoco(saidas: readonly SaidaDeFoco[]) {
  return {
    horario: new Date().toISOString(),
    tipo: "foco" as const,
    dados: {
      saidas: saidas.map((s) => ({ inicio: new Date(s.inicioEm).toISOString(), duracaoMs: s.duracaoMs, motivo: s.motivo })),
    },
  };
}
