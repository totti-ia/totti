// Texto do resumo do envio de convites (cliente e testes). Sem dependências de servidor.

type Contagem = { total: number; enviados: number; falharam: number; pendentes: number };

const numero = (n: number) => n.toLocaleString("pt-BR");

/** "1.240 de 5.000 enviados · 3 falharam" */
export function resumoDoEnvio(p: Contagem): string {
  const base = `${numero(p.enviados)} de ${numero(p.total)} ${p.enviados === 1 ? "enviado" : "enviados"}`;
  return p.falharam > 0 ? `${base} · ${numero(p.falharam)} ${p.falharam === 1 ? "falhou" : "falharam"}` : base;
}

/** Versão para o botão: "1.240 de 5.000". */
export const resumoCurto = (p: Contagem) => `${numero(p.enviados + p.falharam)} de ${numero(p.total)}`;
