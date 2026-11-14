// Adaptador do relatório do Live Coding (`Report`, da IDE) para o tipo comum.
import { CONCEITOS_EMPECILHO, type Gravacao, type Report } from "@/lib/contracts";
import { formatMs } from "@/lib/format";
import { duracaoCurta, duracaoDaEntrevista, plural } from "./formato";
import type {
  AcontecimentoComum,
  AdaptacaoComum,
  AprendizadoComum,
  CriterioComum,
  ProvaComum,
  RelatorioComum,
} from "./tipos";

type Evidencia = Report["criteria"][number]["evidence"][number];

const TIPO_MUDANCA = { requisito: "O requisito mudou", caso_novo: "Entrou um caso novo" } as const;

export function provaDaIde(e: Evidencia): ProvaComum {
  return { t: e.t, texto: e.text, tipo: "fala", elementos: [], imagem: null };
}

function criterioDaIde(c: Report["criteria"][number]): CriterioComum {
  return {
    id: c.id,
    nome: c.name,
    nota: c.score,
    significado: null,
    justificativa: "",
    // Critério sem nota não tem prova: as evidências dele só explicam por que ficou de fora.
    provas: c.score === null ? [] : c.evidence.map(provaDaIde),
    regras: (c.squadRules ?? []).map((r) => ({ texto: r.text, efeito: r.effect })),
  };
}

/** Quando o critério não foi explorado, o texto dele ainda vale como explicação. */
function justificativaDaIde(c: Report["criteria"][number]): string {
  return c.score === null ? (c.evidence[0]?.text ?? "") : "";
}

function adaptacaoDaIde(a: NonNullable<Report["adaptation"]>): AdaptacaoComum {
  const tempo = a.adaptedAt === null ? null : duracaoCurta(a.adaptedAt - a.announcedAt);
  return {
    titulo: a.title,
    descricao: `${TIPO_MUDANCA[a.kind]} · exige ${CONCEITOS_EMPECILHO[a.concept]}`,
    anunciadaEm: a.announcedAt,
    nota: a.score,
    significado: null,
    justificativa: a.evidence[0]?.text ?? "",
    detalhes: [
      `Veio aos ${formatMs(a.announcedAt)}.`,
      tempo ? `Os testes da mudança passaram ${tempo} depois.` : "Não chegou a passar nos testes da mudança.",
      `Código final: ${a.testsPassed}/${a.testsTotal} testes da mudança.`,
    ],
    provas: a.evidence.map(provaDaIde),
  };
}

/** Dicas, travamentos e a mudança numa linha do tempo só, medidos pelos eventos da sessão. */
function momentosDoAprendizado(l: NonNullable<Report["learning"]>): AprendizadoComum["momentos"] {
  const momentos: AprendizadoComum["momentos"] = [];
  for (const s of l.stuck) {
    const como =
      s.cause === "falhas_seguidas" ? "execuções seguidas falhando sem passar em mais testes" : "parado sem mexer no código, com ele falhando";
    const ajuda = s.hintLevels.length ? `com a dica ${s.hintLevels.join(" e ")}` : "sem dica";
    momentos.push({
      t: s.startedAt,
      titulo: "Travou",
      texto:
        s.unstuckAt === null
          ? `${como} · não destravou até o fim (${ajuda})`
          : `${como} · destravou ${formatMs(s.unstuckAt - s.startedAt)} depois, ${ajuda}`,
    });
  }
  for (const h of l.hints) {
    const depois = h.codePassing
      ? "veio com o código já passando nos testes"
      : h.unstuckAt === null
        ? "não passou em mais testes depois dela"
        : `passou em mais testes ${formatMs(h.unstuckAt - h.t)} depois (${plural(h.runsAfter, "execução", "execuções")})`;
    momentos.push({ t: h.t, titulo: `Dica ${h.level} de ${l.hintsAvailable}`, texto: `“${h.text}” · ${depois}` });
  }
  if (l.change) {
    const c = l.change;
    momentos.push({
      t: c.announcedAt,
      titulo: "Mudança",
      texto: [
        `exige ${CONCEITOS_EMPECILHO[c.concept]}`,
        c.adaptedAt === null ? "não passou nos testes dela" : `adaptou ${formatMs(c.adaptedAt - c.announcedAt)} depois`,
        `${plural(c.failedAttempts, "tentativa", "tentativas")} sem passar`,
        c.hintsUsed === 0 ? "sem dica" : plural(c.hintsUsed, "dica", "dicas"),
        c.conversationTurns === 0 ? "não falou na conversa da mudança" : `falou ${plural(c.conversationTurns, "vez", "vezes")} na conversa`,
      ].join(" · "),
    });
  }
  return momentos.sort((a, b) => a.t - b.t);
}

function aprendizadoDaIde(l: NonNullable<Report["learning"]>): AprendizadoComum {
  return {
    nota: l.score,
    resumo: `${l.hints.length} de ${plural(l.hintsAvailable, "dica permitida", "dicas permitidas")} · ${plural(l.stuck.length, "travamento", "travamentos")}`,
    momentos: momentosDoAprendizado(l),
    provas: l.evidence.map(provaDaIde),
  };
}

/** O que vai escrito no gráfico: travamentos, dicas, a mudança, quando ele se adaptou e colagens. */
export function acontecimentosDaIde(report: Report, gravacao: Gravacao | null | undefined): AcontecimentoComum[] {
  const lista: AcontecimentoComum[] = [];
  const l = report.learning;
  for (const s of l?.stuck ?? []) {
    lista.push({
      t: s.startedAt,
      fim: s.unstuckAt,
      tipo: "travou",
      titulo: s.unstuckAt === null ? "Travou e não destravou" : `Travou por ${duracaoCurta(s.unstuckAt - s.startedAt)}`,
      detalhe:
        (s.cause === "falhas_seguidas"
          ? `${s.failedRuns} execuções seguidas falhando sem passar em mais testes`
          : "Parado sem mexer no código, com ele falhando") + (s.hintLevels.length ? `, até a dica ${s.hintLevels.join(" e ")}.` : ", sem pedir dica."),
    });
  }
  if (l) {
    for (const h of l.hints) {
      lista.push({
        t: h.t,
        tipo: "dica",
        titulo:
          h.unstuckAt === null || h.codePassing
            ? `Dica ${h.level} de ${l.hintsAvailable}`
            : `Dica ${h.level} → destravou em ${duracaoCurta(h.unstuckAt - h.t)}`,
        detalhe: `“${h.text}”${h.unstuckAt === null && !h.codePassing ? " Não passou em mais testes depois dela." : ""}`,
      });
    }
  } else {
    for (const m of gravacao?.marcos ?? []) {
      if (m.tipo === "dica" || m.text.startsWith("Recebeu uma dica")) lista.push({ t: m.t, tipo: "dica", titulo: m.text });
    }
  }
  const a = report.adaptation;
  if (a) {
    lista.push({
      t: a.announcedAt,
      fim: a.adaptedAt,
      tipo: "mudanca",
      titulo: `Mudança: ${a.title}`,
      detalhe: `${TIPO_MUDANCA[a.kind]}. Exige ${CONCEITOS_EMPECILHO[a.concept]}.`,
    });
    if (a.adaptedAt !== null) {
      lista.push({
        t: a.adaptedAt,
        tipo: "adaptou",
        titulo: `Adaptou em ${duracaoCurta(a.adaptedAt - a.announcedAt)}`,
        detalhe: "Primeira execução com todos os testes da mudança passando, sem quebrar os antigos.",
      });
    }
  }
  for (const m of gravacao?.marcos ?? []) {
    if (m.tipo === "colagem" || m.text.startsWith("Colou")) lista.push({ t: m.t, tipo: "colagem", titulo: m.text });
  }
  return lista;
}

/** "7 de novembro, 15:02", no fuso do servidor (o mesmo do relatório do quadro). */
export function quandoFoi(ms: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.FUSO_HORARIO || "America/Recife",
  }).format(new Date(ms));
}

export function relatorioDaIde(
  report: Report,
  gravacao?: Gravacao | null,
  extras: { demonstracao?: boolean; candidato?: string | null; iniciadaEm?: number } = {},
): RelatorioComum {
  const s = report.signals;
  const a = report.adaptation;
  const duracaoMs = gravacao?.durationMs ?? s.durationMs;
  return {
    formato: "live_coding",
    id: report.sessionId,
    titulo: report.roleTitle,
    contexto: "relatório da entrevista de Live Coding",
    candidato: extras.candidato ?? null,
    realizadaEm: extras.iniciadaEm !== undefined ? quandoFoi(extras.iniciadaEm) : null,
    duracao: duracaoDaEntrevista(s.durationMs),
    duracaoMs,
    recomendacao: report.recommendation,
    notaGeral: report.overallScore,
    resumo: report.summary,
    briefing: "",
    resumoDaSolucao: "",
    enunciado: "",
    desenhoFinal: null,
    pontosFortes: report.strengths,
    pontosDeAtencao: report.concerns,
    proximosPassos: report.nextSteps,
    criterios: report.criteria.map((c) => ({ ...criterioDaIde(c), justificativa: justificativaDaIde(c) })),
    eliminatorios: [],
    adaptacao: a ? adaptacaoDaIde(a) : null,
    aprendizado: report.learning ? aprendizadoDaIde(report.learning) : null,
    acontecimentos: acontecimentosDaIde(report, gravacao),
    fatos: [
      { nome: "Testes escondidos", valor: `${s.testsPassed} de ${s.testsTotal}` },
      { nome: "Dicas", valor: s.hintsUsed === 0 ? "Nenhuma" : String(s.hintsUsed) },
      { nome: "Colagens", valor: s.pastes === 0 ? "Nenhuma" : String(s.pastes) },
      ...(a ? [{ nome: "Adaptou à mudança em", valor: a.adaptedAt === null ? "Não adaptou" : duracaoCurta(a.adaptedAt - a.announcedAt) }] : []),
      { nome: "Duração", valor: duracaoCurta(s.durationMs) },
    ],
    provasConferidas: null,
    ajustes: [],
    demonstracao: extras.demonstracao ?? false,
  };
}
