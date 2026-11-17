/**
 * Prepara um placar salvo para o juiz. Ao rejulgar, tudo volta sem nota. Ao completar, as notas já dadas ficam e só o
 * que o juiz não avaliou (falha de rede, resposta sem mensagem, JSON inválido) volta para a fila: nada é descartado
 * nem escolhido, e a regra é a mesma para qualquer versão medida.
 */
export function paraJulgar<C extends { nota?: unknown }, V extends { juiz?: unknown; erroJuiz?: string }>(
  casos: C[],
  conversas: V[],
  manterNotas: boolean,
): { casos: C[]; conversas: V[] } {
  return {
    casos: casos.map(({ nota, ...c }) => (manterNotas && nota ? { ...c, nota } : c) as C),
    conversas: conversas.map(({ juiz, erroJuiz: _erro, ...c }) => (manterNotas && juiz ? { ...c, juiz } : c) as V),
  };
}
