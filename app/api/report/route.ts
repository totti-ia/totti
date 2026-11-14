// Relatório final para a recrutadora. A avaliação começa no session_ended (lib/agents/evaluator.ts);
// aqui só se consulta o resultado.
import { NextRequest, NextResponse } from "next/server";
import { candidatosPorSessao } from "@/lib/convites/store";
import { avaliacaoLocal, startEvaluation } from "@/lib/agents/evaluator";
import { listarDoIndice } from "@/lib/agente/resultados";
import { exemploHabilitado, relatorioExemplo } from "@/lib/session/relatorio-exemplo";
import { findReport, listReports } from "@/lib/session/reports";
import { cartaoDoRelatorio } from "@/lib/session/cartao";
import { AVALIACAO_PERDIDA_MS, TENTATIVAS_FEATHERLESS_RELATORIO, guardarSessao, sessaoViva } from "@/lib/session/persistencia";
import { listSessions } from "@/lib/session/store";
import { lerDecisoes, type DecisaoRegistrada } from "@/lib/vagas/decisao";
import { kvPadrao } from "@/lib/storage/kv";
import type { CartaoDoResultado, FormatoDaEntrevista, RecomendacaoDoResultado } from "@/lib/vagas/cartao";

export const dynamic = "force-dynamic";

/** Item da lista de sessões (GET /api/report sem sessionId). */
export interface ReportListItem {
  sessionId: string;
  /** Config da vaga: é por ela que o painel da vaga acha as entrevistas feitas pelo link. */
  configId: string;
  roleTitle: string;
  startedAt: number;
  ended: boolean;
  state?: "running" | "done" | "error";
  overallScore?: number;
  recommendation?: RecomendacaoDoResultado;
  /** Live Coding ou System Design: cada um tem o seu relatório completo. */
  formato: FormatoDaEntrevista;
  /** Para onde "Relatório" leva: /relatorio/<id>, igual nos dois formatos. */
  href: string;
  /** O resumo completo (justificativas, pontos fortes e fracos) para o painel mostrar sem abrir o relatório. */
  cartao?: CartaoDoResultado;
  /** Nome do candidato, quando a entrevista foi aberta pelo link do convite. */
  candidato?: string;
  /** O que a recrutadora decidiu, quando decidiu. */
  decisao?: DecisaoRegistrada;
}

/**
 * GET /api/report?sessionId=...
 * - 200: o `Report`
 * - 202: { status: "gerando" } — a página consulta de novo em instantes
 * - 409: sessão ainda em andamento; 404: não encontrada; 500: { error } (`&retry=1` tenta de novo)
 * Sem sessionId: lista as sessões em memória, para a recrutadora escolher.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const sessionId = params.get("sessionId");
  if (!sessionId) {
    const items: ReportListItem[] = listSessions().map((s) => ({
      sessionId: s.sessionId,
      configId: s.config.id,
      roleTitle: s.config.roleTitle,
      startedAt: s.startedAt,
      ended: s.ended,
      state: s.report?.state,
      overallScore: s.report?.report?.overallScore,
      recommendation: s.report?.report?.recommendation,
      formato: "live_coding" as const,
      href: `/relatorio/${encodeURIComponent(s.sessionId)}`,
      cartao: s.report?.report ? cartaoDoRelatorio(s.report.report) : undefined,
    }));
    // Relatórios de sessões que já saíram da memória (o servidor reiniciou).
    const emMemoria = new Set(items.map((i) => i.sessionId));
    for (const { startedAt, report } of await listReports()) {
      if (emMemoria.has(report.sessionId)) continue;
      items.push({
        sessionId: report.sessionId,
        configId: report.configId,
        roleTitle: report.roleTitle,
        startedAt,
        ended: true,
        state: "done",
        overallScore: report.overallScore,
        recommendation: report.recommendation,
        formato: "live_coding",
        href: `/relatorio/${encodeURIComponent(report.sessionId)}`,
        cartao: cartaoDoRelatorio(report),
      });
    }
    // As entrevistas de System Design (quadro): vêm do índice, que guarda a vaga e o resultado.
    for (const q of await listarDoIndice(kvPadrao())) {
      items.push({
        sessionId: q.sessionId,
        configId: q.configId,
        roleTitle: q.roleTitle,
        startedAt: q.startedAt,
        ended: q.ended,
        state: q.state,
        overallScore: q.overallScore,
        recommendation: q.recommendation,
        formato: "system_design",
        href: `/relatorio/${encodeURIComponent(q.sessionId)}`,
        cartao: q.cartao,
      });
    }
    const nomes = await candidatosPorSessao();
    const decisoes = await lerDecisoes();
    for (const item of items) {
      item.candidato = nomes.get(item.sessionId);
      item.decisao = decisoes.get(item.sessionId);
    }
    return NextResponse.json(items.sort((a, b) => b.startedAt - a.startedAt));
  }

  // Exemplo de dev (`/report?sessionId=exemplo`): abre o relatório sem fazer uma entrevista.
  if (exemploHabilitado(sessionId)) return NextResponse.json(relatorioExemplo());

  const salvoAntes = await findReport(sessionId);
  if (salvoAntes) return NextResponse.json(salvoAntes.report);
  const session = await sessaoViva(sessionId);
  if (!session) {
    const salvo = await findReport(sessionId);
    if (salvo) return NextResponse.json(salvo.report);
    return NextResponse.json({ error: "sessão não encontrada" }, { status: 404 });
  }
  if (!session.ended) {
    return NextResponse.json({ error: "a entrevista ainda está em andamento" }, { status: 409 });
  }

  // Avaliação começada por outra instância (a cópia restaurada diz "gerando"): espera, a menos que tenha se perdido.
  if (session.report?.state === "running" && !avaliacaoLocal(session)) {
    if (Date.now() - session.report.startedAt < AVALIACAO_PERDIDA_MS) return NextResponse.json({ status: "gerando" }, { status: 202 });
    session.report.state = "error";
  }
  const manual = params.get("retry") === "1";
  const atual = session.report;
  if (atual?.state === "error" && !manual && (atual.attempt ?? 0) > TENTATIVAS_FEATHERLESS_RELATORIO) {
    return NextResponse.json({ error: atual.error }, { status: 500 });
  }
  const status = startEvaluation(session, { retry: manual || atual?.state === "error", ...(manual ? { rota: "reserva" as const } : {}) });
  await guardarSessao(session);
  if (status.state === "running") return NextResponse.json({ status: "gerando" }, { status: 202 });
  if (status.state === "error" && (status.attempt ?? 0) <= TENTATIVAS_FEATHERLESS_RELATORIO) {
    return NextResponse.json({ status: "gerando" }, { status: 202 });
  }
  if (status.state === "error") return NextResponse.json({ error: status.error }, { status: 500 });
  return NextResponse.json(status.report);
}
