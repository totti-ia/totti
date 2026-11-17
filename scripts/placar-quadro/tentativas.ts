/**
 * Repete só a resposta sem mensagem (choices[0].message ausente) das chamadas do instrumento: candidato simulado e juiz.
 * As chamadas do Totti não passam por aqui: as falhas dele são resultado da versão medida.
 */
export async function repetirRespostaIncompleta<T>(chamar: () => Promise<T>, avisar: (tentativa: number) => void = () => {}): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await chamar();
    } catch (erro) {
      const incompleta = erro instanceof Error && /resposta da \w+ sem choices\[0\]\.message/.test(erro.message);
      if (!incompleta || tentativa >= 3) throw erro;
      avisar(tentativa);
      await new Promise((resolve) => setTimeout(resolve, tentativa * 1000));
    }
  }
}
