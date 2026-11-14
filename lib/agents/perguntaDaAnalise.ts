/**
 * Travas da pergunta que a análise do código prepara (#130, item 13), o equivalente do que o quadro faz em
 * lib/agente/analisar.ts: sem abertura de molde e sem voltar pela terceira vez ao mesmo trecho do código. Puro.
 */
import type { LineRange } from "@/lib/contracts";
import type { QueuedQuestion, SessionState } from "@/lib/session/types";

/** Trecho já perguntado este tanto de vezes ou mais: o assunto dele está explorado (no quadro, `LIMITE_PECA_PERGUNTADA`). */
export const LIMITE_TRECHO_PERGUNTADO = 2;

/** Palavras com que uma pergunta começa (sem acento, minúsculas): a abertura de molde só sai se o que sobra começa assim. */
const PALAVRAS_DE_PERGUNTA = /^(o que|como|qual|quais|por que|porque|e se|quando|onde|quanto|quantos|voce|se|e|esse|essa|esses|essas|isso|aqui|nesse|nessa|com)(?![\p{L}])/u;

function semAcento(t: string): string {
  return t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function comMaiuscula(t: string): string {
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/**
 * Abertura de molde: "Vi que você ...", "Notei que você ..." e "Percebi que você ..." até o primeiro ponto ou vírgula,
 * e "Para entender como você ..., " no começo. Corta a abertura e mantém a pergunta, só quando o que sobra é uma
 * pergunta ("?") que começa como pergunta e tem pelo menos três palavras (o grifo mostra o trecho de que ela fala).
 * Senão, fica como está.
 */
export function cortarAberturaDeMolde(pergunta: string): { texto: string; cortou: boolean } {
  const original = pergunta.trim();
  let texto = original;
  // `\s` e não `\b` depois de "você": o \b do JS não conta o "ê" como letra.
  const abertura = /^(?:vi|notei|percebi) que voc[êe]\s[^.,:]*[.,:]\s*/i.exec(texto);
  if (abertura) texto = texto.slice(abertura[0].length);
  const para = /^para entender como voc[êe]\s[^,]*,\s*/i.exec(texto);
  if (para) texto = texto.slice(para[0].length);
  if (texto === original) return { texto: pergunta, cortou: false };
  const sobra = semAcento(texto);
  if (!texto.includes("?") || !PALAVRAS_DE_PERGUNTA.test(sobra) || sobra.split(/\s+/).length < 3) return { texto: pergunta, cortou: false };
  return { texto: comMaiuscula(texto), cortou: true };
}

/** Os dois trechos se sobrepõem em pelo menos metade do menor. */
function mesmoTrecho(a: LineRange, b: LineRange): boolean {
  const comum = Math.min(a.endLine, b.endLine) - Math.max(a.startLine, b.startLine) + 1;
  if (comum <= 0) return false;
  const menor = Math.min(a.endLine - a.startLine + 1, b.endLine - b.startLine + 1);
  return comum * 2 >= menor;
}

/** As perguntas que o Totti já levantou (viraram balão) com um trecho grifado. */
function perguntasComTrecho(session: SessionState): (QueuedQuestion & { highlight: LineRange })[] {
  const levantadas = new Set(session.blips.map((b) => b.id));
  return session.queue.filter((q): q is QueuedQuestion & { highlight: LineRange } => levantadas.has(q.id) && q.highlight !== undefined && !q.kickoff);
}

/**
 * Os trechos do código já perguntados, com quantas vezes e o rótulo da última pergunta: vão no prompt da análise, como
 * as "peças já perguntadas" do quadro. Trechos que se sobrepõem contam juntos.
 */
export function trechosJaPerguntados(session: SessionState): { linhas: LineRange; rotulo?: string; vezes: number }[] {
  const trechos: { linhas: LineRange; rotulo?: string; vezes: number }[] = [];
  for (const q of perguntasComTrecho(session)) {
    const igual = trechos.find((t) => mesmoTrecho(t.linhas, q.highlight));
    if (igual) {
      igual.vezes += 1;
      igual.rotulo = q.topicLabel ?? igual.rotulo;
    } else trechos.push({ linhas: q.highlight, rotulo: q.topicLabel, vezes: 1 });
  }
  return trechos;
}

/** Os trechos já perguntados, já formatados para o prompt ("linhas 4–7 (o loop interno): 2 vezes"). */
export function trechosParaPrompt(session: SessionState): string[] {
  return trechosJaPerguntados(session).map(({ linhas, rotulo, vezes }) => {
    const onde = linhas.startLine === linhas.endLine ? `linha ${linhas.startLine}` : `linhas ${linhas.startLine}–${linhas.endLine}`;
    return `${onde}${rotulo ? ` (${rotulo})` : ""}: ${vezes} ${vezes === 1 ? "vez" : "vezes"}`;
  });
}

/**
 * Assunto já explorado: a pergunta aponta para um trecho que já foi perguntado LIMITE_TRECHO_PERGUNTADO vezes ou mais.
 * O desafio (melhorar uma solução que funciona) é outro assunto sobre o mesmo código, e pergunta sem trecho não se compara.
 */
export function assuntoJaExplorado(q: { kind?: string; lines?: LineRange }, session: SessionState): boolean {
  if (q.kind === "desafio" || !q.lines) return false;
  const vezes = perguntasComTrecho(session).filter((feita) => mesmoTrecho(feita.highlight, q.lines!)).length;
  return vezes >= LIMITE_TRECHO_PERGUNTADO;
}
