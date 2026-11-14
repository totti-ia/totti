// Monta o que a tela do relatório (recrutadora) mostra a partir do scorecard guardado.
// Só servidor: troca ids por nomes legíveis (critério, elemento do desenho) e liga cada prova
// de desenho à imagem do quadro daquele momento. Nada da ficha ou dos sinais esperados sai daqui.
import type { EventoArmazenado, SessaoArmazenada } from "./armazenamento/repositorio";
import { kitComRubricaDaVaga, type Kit, type Problema } from "./kits/tipos";
import { NIVEIS_ADAPTACAO, type Recomendacao, type Scorecard } from "./scorecard";

export type ProvaVista =
  | { tipo: "fala"; momento: string | null; texto: string }
  | {
      tipo: "desenho";
      momento: string | null;
      elementos: string[];
      imagem: string | null;
      /** O que o entrevistador viu no desenho naquele momento (ex.: "banco único sem cache"). */
      observacao: string | null;
    };

export type CriterioVisto = {
  id: string;
  nome: string;
  nota: number | null;
  /** O que a nota significa na rubrica (ex.: o nível 3 do critério). */
  significado: string | null;
  justificativa: string;
  provas: ProvaVista[];
  /** Regras da squad que pesaram neste critério ("critério aprendido com o time"). */
  aprendidoComOTime?: { texto: string; efeito: "valoriza" | "penaliza"; origem?: "vaga" | "empresa" }[];
};

/** Regra de reprovação da vaga ("cobrar duas vezes") e se o candidato a cumpriu. Fora da nota. */
export type EliminatorioVisto = {
  regra: string;
  status: "atendida" | "violada" | "nao_observada";
  justificativa: string;
  provas: ProvaVista[];
};

/** A mudança no problema que o entrevistador trouxe e como o candidato se adaptou (fora da nota geral). */
export type AdaptacaoVista = {
  mudanca: string;
  momento: string | null;
  nota: number | null;
  significado: string | null;
  justificativa: string;
  provas: ProvaVista[];
  desenhosDepois: number;
  falasDepois: number;
};

export type RelatorioVisto = {
  sessaoId: string;
  candidatoId: string;
  area: string;
  problema: string;
  /** O enunciado que o candidato recebeu (público): dá contexto ao desenho final. */
  enunciado: string;
  /** Já formatado no servidor (fuso do evento), para não mudar entre servidor e navegador. */
  realizadaEm: string;
  duracao: string | null;
  perguntas: number;
  notaGeral: number | null;
  recomendacao: Recomendacao;
  criterios: CriterioVisto[];
  pontosFortes: string[];
  pontosAAprofundar: string[];
  briefing: string;
  /** "" quando o scorecard é antigo (sem o campo): a tela não mostra o bloco. */
  resumoDaSolucao: string;
  resumoDaEntrevista: string;
  desenhoFinal: string | null;
  provasConferidas: number;
  ajustes: string[];
  demonstracao: boolean;
  adaptacao: AdaptacaoVista | null;
  /** Regras de reprovação do plano da vaga. Ausente quando o plano não tem. */
  eliminatorios?: EliminatorioVisto[];
};

const MARCAS_FINAIS_DE_CONEXAO = [" (ponta perto, sem encostar)", " (tracejada)", " (seta solta)", " (linha solta)"];

/** Tira UMA marca final de conexão (marca interna ou rótulo entre aspas), ou devolve o texto como veio. */
function semMarcaFinal(t: string): string {
  const sufixo = MARCAS_FINAIS_DE_CONEXAO.find(m => t.endsWith(m));
  if (sufixo) return t.slice(0, -sufixo.length);
  if (!t.endsWith('")')) return t;
  // Rótulo: ("..."), que pode ter aspas escapadas (\"). Anda do fim até a aspa de abertura (sem barra antes).
  for (let i = t.length - 3; i >= 1; i--) {
    if (t[i] !== '"') continue;
    let barras = 0;
    while (i - 1 - barras >= 0 && t[i - 1 - barras] === "\\") barras++;
    if (barras % 2 === 1) continue;
    if (t[i - 1] !== "(") return t;
    return t.slice(0, i - 1).trimEnd();
  }
  return t;
}

/** Primeira seta do texto (a que aparece antes na linha), com a posição e o sinal. */
function primeiraSeta(t: string): { pos: number; seta: string } | null {
  let melhor: { pos: number; seta: string } | null = null;
  for (const seta of ["→", "↔", "—"]) {
    const pos = t.indexOf(` ${seta} `);
    if (pos >= 0 && (!melhor || pos < melhor.pos)) melhor = { pos, seta };
  }
  return melhor;
}

/**
 * Linha de conexão do grafo ("Entrada dos dados → Quadro (ponta perto, sem encostar)") -> nome legível para a
 * prova: "Entrada dos dados → Quadro", "seta de Entrada dos dados" (sem destino) ou "seta para Quadro" (sem origem).
 * Nunca devolve "?" nem as marcas internas. Também entende grafos antigos ("A → ?", "? → B", "(seta solta)").
 */
function nomeDeConexao(id: string, linha: string): string | null {
  if (!id.startsWith("s")) return null;
  let t = linha.trim();
  for (;;) {
    const antes = t;
    t = semMarcaFinal(t).trim();
    if (t === antes) break;
  }
  const achada = primeiraSeta(t);
  if (!achada) return null;
  const { seta } = achada;
  const a = t.slice(0, achada.pos);
  const b = t.slice(achada.pos + seta.length + 2);
  const semOrigem = a === "(sem origem)" || a === "?";
  const semDestino = b === "(sem destino)" || b === "?";
  if (semOrigem && semDestino) return "seta solta";
  if (semDestino) return `seta de ${a}`;
  if (semOrigem) return `seta para ${b}`;
  return `${a} ${seta} ${b}`;
}

/** "- [e1] Postgres (elipse)  dentro de [m1] ..." -> e1: "Postgres". Vale o nome mais recente. */
export function nomesDosElementos(eventos: EventoArmazenado[]): Map<string, string> {
  const nomes = new Map<string, string>();
  for (const e of eventos) {
    const grafo = (e.dados as { grafo?: unknown } | null)?.grafo;
    if (e.tipo !== "desenho" || typeof grafo !== "string") continue;
    for (const [, id, resto] of grafo.matchAll(/^- \[([^\]]+)\] (.+)$/gm)) {
      const conexao = nomeDeConexao(id, resto);
      if (conexao) { nomes.set(id, conexao); continue; }
      const nome = resto
        .replace(/\s{2}dentro de \[.*$/, "")
        .replace(/, perto de \[.*$/, "")
        .replace(/\s*\(seta solta\)$/, "")
        .replace(/\s*\([^()]*\)$/, "")
        .replace(/^"(.*)"$/, "$1")
        .trim();
      if (nome) nomes.set(id, nome);
    }
  }
  return nomes;
}

function formatarMomento(horario: string, inicio: number): string | null {
  const t = Date.parse(horario);
  if (!Number.isFinite(t) || t < inicio) return null;
  const s = Math.round((t - inicio) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function formatarDuracao(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 30_000) return null;
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function montarRelatorio(p: {
  sessao: SessaoArmazenada;
  scorecard: Scorecard;
  kit: Kit;
  problema: Problema;
  eventos: EventoArmazenado[];
  imagens: { numero: number; horario: string }[];
}): RelatorioVisto {
  const { sessao, scorecard, eventos } = p;
  // Os critérios do relatório são os da vaga (plano da sessão); a rubrica fixa do kit só vale sem plano.
  const kit = kitComRubricaDaVaga(p.kit, sessao.estado.plano);
  const ordenados = [...eventos].sort((a, b) => Date.parse(a.horario) - Date.parse(b.horario));
  // A entrevista começa quando sai da espera (primeiro evento de fase), não quando a página abriu.
  const primeiraFase = ordenados.find((e) => e.tipo === "fase");
  const inicio = primeiraFase ? Date.parse(primeiraFase.horario) : sessao.criadaEm;
  const fim = ordenados.length ? Date.parse(ordenados[ordenados.length - 1].horario) : NaN;

  const nomes = nomesDosElementos(ordenados);
  const urlDaImagem = (n: number) => `/api/sessoes/${encodeURIComponent(sessao.id)}/imagens/${n}`;
  const imagens = [...p.imagens].sort((a, b) => Date.parse(a.horario) - Date.parse(b.horario));
  /**
   * A foto do quadro daquele momento. A foto é tirada na análise, segundos DEPOIS do traço:
   * vale a primeira a partir do momento (até 3 min); sem ela, a última antes.
   */
  const imagemAte = (horario: string): string | null => {
    const t = Date.parse(horario);
    if (!Number.isFinite(t)) return null;
    const depois = imagens.find((i) => {
      const ti = Date.parse(i.horario);
      return ti >= t - 1000 && ti <= t + 180_000;
    });
    if (depois) return urlDaImagem(depois.numero);
    const antes = imagens.filter((i) => Date.parse(i.horario) < t).at(-1);
    return antes ? urlDaImagem(antes.numero) : null;
  };

  const criterios: CriterioVisto[] = scorecard.criterios.map((c) => {
    const def = kit.criterios.find((k) => k.id === c.criterio);
    const nota = c.nota;
    return {
      id: c.criterio,
      nome: def?.nome ?? c.criterio,
      nota,
      significado: nota !== null && def ? def.niveis[nota as 1 | 2 | 3 | 4] ?? null : null,
      justificativa: c.justificativa,
      aprendidoComOTime: (c.regras_squad ?? []).map((r) => ({ texto: r.text, efeito: r.effect, ...(r.origin ? { origem: r.origin } : {}) })),
      provas: c.evidencias.map((e): ProvaVista =>
        e.tipo === "fala"
          ? { tipo: "fala", momento: formatarMomento(e.horario, inicio), texto: e.texto ?? "" }
          : {
              tipo: "desenho",
              momento: formatarMomento(e.horario, inicio),
              elementos: (e.elementos ?? []).map((id) => nomes.get(id) ?? id),
              imagem: e.imagem ?? imagemAte(e.horario),
              observacao: e.texto?.trim() || null,
            },
      ),
    };
  });

  return {
    sessaoId: sessao.id,
    candidatoId: sessao.candidatoId,
    area: kit.area,
    problema: p.problema.titulo,
    enunciado: p.problema.enunciado.trim(),
    realizadaEm: new Intl.DateTimeFormat("pt-BR", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: process.env.FUSO_HORARIO || "America/Recife",
    }).format(new Date(inicio)),
    duracao: formatarDuracao(fim - inicio),
    perguntas: sessao.estado.perguntasFeitas,
    notaGeral: scorecard.nota_geral,
    recomendacao: scorecard.recomendacao,
    criterios,
    pontosFortes: scorecard.pontos_fortes,
    pontosAAprofundar: scorecard.pontos_a_aprofundar,
    briefing: scorecard.briefing_para_proxima_etapa,
    resumoDaSolucao: scorecard.resumo_da_solucao?.trim() ?? "",
    resumoDaEntrevista: scorecard.resumo_da_entrevista?.trim() ?? "",
    desenhoFinal: imagens.length ? urlDaImagem(imagens[imagens.length - 1].numero) : null,
    provasConferidas: criterios.reduce((n, c) => n + c.provas.length, 0),
    ajustes: scorecard.ajustes,
    demonstracao: scorecard.origem === "fake",
    adaptacao: scorecard.adaptacao ? {
      mudanca: scorecard.adaptacao.mudanca,
      momento: formatarMomento(scorecard.adaptacao.anunciada_em, inicio),
      nota: scorecard.adaptacao.nota,
      significado: scorecard.adaptacao.nota !== null ? NIVEIS_ADAPTACAO[scorecard.adaptacao.nota as 1 | 2 | 3 | 4] ?? null : null,
      justificativa: scorecard.adaptacao.justificativa,
      provas: scorecard.adaptacao.evidencias.map((e): ProvaVista => ({ tipo: "fala", momento: formatarMomento(e.horario, inicio), texto: e.texto ?? "" })),
      desenhosDepois: scorecard.adaptacao.desenhos_depois,
      falasDepois: scorecard.adaptacao.falas_depois,
    } : null,
    ...(scorecard.eliminatorios?.length ? {
      eliminatorios: scorecard.eliminatorios.map((e): EliminatorioVisto => ({
        regra: e.regra,
        status: e.status,
        justificativa: e.justificativa,
        provas: e.evidencias.map((ev): ProvaVista => ({ tipo: "fala", momento: formatarMomento(ev.horario, inicio), texto: ev.texto ?? "" })),
      })),
    } : {}),
  };
}
