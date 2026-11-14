export type EstadoTranscricao = "inativa" | "conectando" | "ouvindo" | "finalizando" | "erro";

export type EventosTranscricao = {
  aoParcial: (texto: string) => void;
  aoTexto: (texto: string) => void;
  aoErro: (erro: Error) => void;
  aoEncerrar: () => void;
  /** Energia RMS crua (0 a 1) de cada bloco enviado ao provedor. Só o Scribe chama; o navegador não tem isso. */
  aoEnergia?: (energia: number) => void;
};

export type SessaoTranscricao = {
  /** Para a captura e aguarda o último resultado antes de liberar o envio. */
  parar: () => Promise<void>;
  /** Descarta resultados pendentes e libera imediatamente todos os recursos. */
  cancelar: () => void;
};

export function acrescentarFala(atual: string, fala: string) {
  return [atual.trimEnd(), fala.trim()].filter(Boolean).join(" ");
}

export function erroMicrofone(erro: unknown): Error {
  const nome = erro instanceof Error ? erro.name : "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return new Error("Permita o acesso ao microfone no navegador para ditar.");
  }
  if (nome === "NotFoundError") return new Error("Nenhum microfone foi encontrado.");
  if (nome === "NotReadableError") return new Error("Não consegui acessar o microfone. Verifique se outro aplicativo está usando ele.");
  return erro instanceof Error ? erro : new Error("Não consegui iniciar a transcrição.");
}
