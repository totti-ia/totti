import { normalizarParaComparar } from "../totti/relatorio";
import type { SinalDeIntegridade } from "./tipos";

export type FalaDaConversa = { t: number; role: "agent" | "candidate"; text: string; latenciaMs?: number };
export type TipoDePergunta = "conversa" | "tecnica";
export type DistribuicaoDeResposta = { tipo: TipoDePergunta; quantidade: number; medianaMs: number; minimoMs: number; maximoMs: number };

/** Régua conservadora do relatório, sem participar da entrevista ou da avaliação. */
export const LIMITES_CONVERSA = {
  ecos: 3, palavrasEco: 6, coberturaEco: 0.8,
  respostasPorTipo: 3, medianaMs: 4000, desvioMs: 750, diferencaMs: 1000,
  semFalaMs: 120_000, janelaDoBlocoMs: 30_000, linhasDoBloco: 8, caracteresDoBloco: 200,
} as const;

const normal = normalizarParaComparar;
const mediana = (valores: number[]) => {
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
};

export function pediuTempo(texto: string): boolean {
  return /\b(pensando|preciso pensar|vou pensar|deixa eu pensar|deixe me pensar|um momento|um minuto|calma|mais tempo|preciso de um tempo)\b/u.test(normal(texto));
}

/** Sem categoria segura, não inventamos dificuldade a partir da duração da resposta. */
export function tipoDePergunta(texto: string): TipoDePergunta | null {
  const n = normal(texto);
  if (/^(e )?por que\b/u.test(n) || n === "porque") return "tecnica";
  if (/\b(por que|porque|como|qual|quais|explique|explica|e se)\b/u.test(n)
    && /\b(codigo|banco|escal|complexidade|custo|memoria|latencia|algoritmo|estrutura|fila|cache|sistema|falha|solucao|implement|escolh|decis|gargalo|funciona|duplic|orden|busca|requisic)/u.test(n)) return "tecnica";
  if (/\b(pode seguir|podemos seguir|tudo bem|tudo certo|pronto para|vamos comecar|pode comecar|me conta sobre voce|se apresente|me ouve|esta ouvindo|alguma duvida)\b/u.test(n)) return "conversa";
  return null;
}

/** Sequência quase literal da pergunta no começo da resposta; citações posteriores não contam. */
export function ecoDaPergunta(pergunta: string, resposta: string): boolean {
  const p = normal(pergunta).split(" ").filter(Boolean);
  const abertura = normal(resposta).replace(/^(?:entao )?(?:voce quer saber |a pergunta e |voce perguntou |se entendi bem )/u, "");
  const r = abertura.split(" ").filter(Boolean).slice(0, p.length + 3);
  if (p.length < LIMITES_CONVERSA.palavrasEco || p.length > 80 || r[0] !== p[0]) return false;
  // Maior subsequência em ordem: tolera pequenas palavras de ligação sem aceitar só o mesmo assunto.
  let anterior = Array(p.length + 1).fill(0) as number[];
  for (const palavra of r) {
    const atual = [0];
    for (let j = 1; j <= p.length; j++) atual[j] = palavra === p[j - 1] ? anterior[j - 1] + 1 : Math.max(anterior[j], atual[j - 1]);
    anterior = atual;
  }
  return anterior[p.length] >= Math.max(LIMITES_CONVERSA.palavrasEco, Math.ceil(p.length * LIMITES_CONVERSA.coberturaEco));
}

export function sinaisDaConversa(falas: readonly FalaDaConversa[]): { sinais: SinalDeIntegridade[]; temposDeResposta: DistribuicaoDeResposta[] } {
  const sinais: SinalDeIntegridade[] = [];
  const ecos: { pergunta: FalaDaConversa; resposta: FalaDaConversa }[] = [];
  const tempos: { t: number; ms: number; tipo: TipoDePergunta }[] = [];
  let pergunta: FalaDaConversa | undefined;
  for (const fala of [...falas].sort((a, b) => a.t - b.t)) {
    if (fala.role === "agent") { pergunta = fala; continue; }
    if (!pergunta) continue;
    if (ecoDaPergunta(pergunta.text, fala.text)) ecos.push({ pergunta, resposta: fala });
    const tipo = tipoDePergunta(pergunta.text);
    if (tipo && !pediuTempo(fala.text) && Number.isFinite(fala.latenciaMs) && fala.latenciaMs! >= 0) tempos.push({ t: fala.t, ms: fala.latenciaMs!, tipo });
    // Só a primeira resposta é pareada; pensar em voz alta depois de pedir tempo não é atraso.
    pergunta = undefined;
  }
  if (ecos.length >= LIMITES_CONVERSA.ecos) {
    for (const { pergunta, resposta } of ecos) sinais.push({ id: `eco_da_pergunta-${sinais.length + 1}`, tipo: "eco_da_pergunta", t: resposta.t,
      texto: `Começou repetindo a pergunta do Totti (${ecos.length} respostas na entrevista)`, detalhe: `O Totti: “${pergunta.text}” · Candidato: “${resposta.text}”` });
  }
  const temposDeResposta = (["conversa", "tecnica"] as const).flatMap((tipo) => {
    const valores = tempos.filter((v) => v.tipo === tipo).map((v) => v.ms);
    return valores.length ? [{ tipo, quantidade: valores.length, medianaMs: mediana(valores), minimoMs: Math.min(...valores), maximoMs: Math.max(...valores) }] : [];
  });
  const valores = tempos.map((v) => v.ms);
  if (temposDeResposta.length === 2 && temposDeResposta.every((d) => d.quantidade >= LIMITES_CONVERSA.respostasPorTipo)) {
    const m = mediana(valores);
    // Todos os tempos precisam ficar perto da mediana: o MAD sozinho esconderia respostas muito diferentes.
    if (m >= LIMITES_CONVERSA.medianaMs && valores.every((v) => Math.abs(v - m) <= LIMITES_CONVERSA.desvioMs)
      && Math.abs(temposDeResposta[0].medianaMs - temposDeResposta[1].medianaMs) <= LIMITES_CONVERSA.diferencaMs) {
      sinais.push({ id: "tempo_plano-1", tipo: "tempo_plano", t: tempos[0].t, fim: tempos.at(-1)!.t,
        texto: "Tempos de resposta altos e próximos em perguntas de conversa e técnicas",
        detalhe: temposDeResposta.map((d) => `${d.tipo === "conversa" ? "Conversa e confirmação" : "Técnicas"}: ${d.quantidade} respostas, mediana ${(d.medianaMs / 1000).toFixed(1)} s, de ${(d.minimoMs / 1000).toFixed(1)} a ${(d.maximoMs / 1000).toFixed(1)} s`).join(" · ") });
    }
  }
  return { sinais, temposDeResposta };
}

/** Linhas novas entre duas fotos, retirando prefixo e sufixo iguais (não conta mero deslocamento). */
export function blocoSemFala(fotos: readonly { t: number; code: string; language?: string }[], falas: readonly FalaDaConversa[], starter = "", colagensProprias: readonly number[] = []): SinalDeIntegridade[] {
  const candidatos = falas.filter((f) => f.role === "candidate" && f.text.trim());
  // Entrevista silenciosa por preferência não gera sinal; é preciso haver fala no restante.
  if (candidatos.length < 3) return [];
  const sinais: SinalDeIntegridade[] = [];
  let anterior: { t: number; code: string; language?: string } = { t: 0, code: starter };
  for (const foto of [...fotos].sort((a, b) => a.t - b.t)) {
    if ((anterior.language && foto.language && anterior.language !== foto.language)
      || colagensProprias.some((t) => t > anterior.t && t <= foto.t)) { anterior = foto; continue; }
    const antes = anterior.code.split("\n"), depois = foto.code.split("\n");
    let inicio = 0, fimAntes = antes.length, fimDepois = depois.length;
    while (inicio < fimAntes && inicio < fimDepois && antes[inicio] === depois[inicio]) inicio++;
    while (fimAntes > inicio && fimDepois > inicio && antes[fimAntes - 1] === depois[fimDepois - 1]) { fimAntes--; fimDepois--; }
    const linhas = depois.slice(inicio, fimDepois).filter((l) => l.trim());
    // Exige uma foto anterior recente: uma foto depois de 3 min não revela quando o bloco entrou.
    const semFala = anterior.t >= LIMITES_CONVERSA.semFalaMs && !candidatos.some((f) => f.t >= anterior.t - LIMITES_CONVERSA.semFalaMs && f.t <= foto.t);
    const novas = linhas.filter((l) => !antes.includes(l)).length;
    if (semFala && foto.t > anterior.t && foto.t - anterior.t <= LIMITES_CONVERSA.janelaDoBlocoMs
      && novas >= LIMITES_CONVERSA.linhasDoBloco && linhas.join("\n").length >= LIMITES_CONVERSA.caracteresDoBloco) {
      sinais.push({ id: `bloco_sem_fala-${sinais.length + 1}`, tipo: "bloco_sem_fala", t: foto.t,
        texto: `Entraram ${novas} linhas de código sem fala do candidato nos 2 minutos anteriores`,
        detalhe: "Há fala no restante da entrevista. A ausência de fala não prova a origem do código." });
    }
    anterior = foto;
  }
  return sinais;
}
