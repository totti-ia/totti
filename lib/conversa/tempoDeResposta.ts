/** Só marcas de relógio: não programa timers, não muda o portão nem o fim do turno. */
export type ObservadorDoAudio = { iniciou(): void; terminou(completo: boolean): void };

export function criarTempoDeResposta(agora = Date.now) {
  let fim: number | undefined;
  let falando = false;
  let vozPendente = false;
  let latencia: number | undefined;
  let ultima: number | undefined;
  let sobreposicao = false;
  const audio: ObservadorDoAudio = {
    iniciou() { falando = true; fim = undefined; sobreposicao = vozPendente; },
    terminou(completo) {
      if (!falando) return; // Falha de síntese ou reação descartada nunca vira fim de áudio.
      falando = false;
      fim = completo && !sobreposicao && !vozPendente ? agora() : undefined;
    },
  };
  return {
    audio,
    inicioDaVoz(em = agora()) {
      if (vozPendente) return;
      vozPendente = true;
      sobreposicao ||= falando;
      latencia = !falando && fim !== undefined && em >= fim ? Math.round(em - fim) : undefined;
      fim = undefined; // Uma fala do Totti só mede a primeira resposta.
    },
    interromper() { falando = false; fim = undefined; latencia = undefined; sobreposicao = true; },
    tomar(substitui = false): number | undefined {
      const medida = substitui ? ultima : latencia;
      ultima = medida;
      vozPendente = false;
      latencia = undefined;
      return medida;
    },
  };
}
