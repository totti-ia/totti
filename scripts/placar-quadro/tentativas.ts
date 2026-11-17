/** Repete apenas uma resposta incompleta do candidato simulado, sem alterar chamadas do Totti ou do juiz. */
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
