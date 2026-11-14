// Rotas do fim da entrevista e de apoio ao teste local:
//   POST /api/sessoes/[id]/finalizar   encerra a sessão e gera (uma vez) o scorecard
//   GET  /api/sessoes/[id]/scorecard   devolve o scorecard gerado
//   GET  /api/dev/sessoes/[id]/estado  visão SEGURA do estado (só dev)
// O scorecard é do recrutador, não do candidato: em produção só sai com o header x-api-key
// (AVALIACOES_API_SECRET). Em dev (NODE_ENV != production ou AGENTE_DEV=1) sai direto, para a página de teste.
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { kvPadrao, type Kv } from "@/lib/storage/kv";
import { ErroLlm } from "../llm/cliente";
import { resolverAvaliacao } from "../kits";
import type { SessaoArmazenada } from "../armazenamento";
import { atualizarNoIndice, cartaoDoScorecard } from "../resultados";
import { gerarScorecard, gerarScorecardFalso, kitDaSessao, type Scorecard } from "../scorecard";
import { criteriosSemEvidencia, transicionar } from "../sessao/estado";
import { contexto, type Contexto } from "./contexto";
import { erro, json, type ParamsId } from "./http";
import { TENTATIVAS_FEATHERLESS_RELATORIO, TEMPO_POR_TENTATIVA_RELATORIO_MS } from "@/lib/session/persistencia";

export function devHabilitado(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.AGENTE_DEV === "1";
}

function eRecrutador(req: Request): boolean {
  if (devHabilitado()) return true;
  const segredo = process.env.AVALIACOES_API_SECRET;
  const dado = req.headers.get("x-api-key");
  if (!segredo || !dado) return false;
  const a = Buffer.from(segredo);
  const b = Buffer.from(dado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const eIdPlausivel = (id: string) => id.length > 0 && id.length <= 80;

type Falha = { falha: string; status: number };

/** Geração em andamento por sessão: duas chamadas simultâneas não pagam duas vezes o modelo final. */
const emAndamento = new Map<string, Promise<Scorecard | Falha>>();

type Avaliacao = NonNullable<Awaited<ReturnType<typeof resolverAvaliacao>>>;

/** Se outra instância já gera o scorecard, espera por ele em vez de pagar o modelo de novo; passado isso, assume a geração. */
const NS_JANELA_SCORECARD = "scorecard-report-window";

/** O índice do painel é auxiliar: falhar nele nunca derruba a geração do scorecard. */
async function noIndice(kv: Kv, id: string, mudanca: Parameters<typeof atualizarNoIndice>[2]): Promise<void> {
  try {
    await atualizarNoIndice(kv, id, mudanca);
  } catch (e) {
    console.warn("[agente] indice_nao_atualizado", { sessao_id: id, erro: e instanceof Error ? e.name : "desconhecido" });
  }
}

export async function finalizarHandler(req: Request, { params }: ParamsId): Promise<Response> {
  const { id } = await params;
  if (!eIdPlausivel(id)) return erro(404, "sessão não encontrada");
  const ctx = contexto();
  const sessao = await ctx.repositorio.obter(id);
  if (!sessao) return erro(404, "sessão não encontrada");
  const verScorecard = eRecrutador(req);
  const resposta = (sc: Scorecard) => json(verScorecard ? sc : { ok: true, gerado: true });

  const pronto = await ctx.repositorio.obterScorecard(id);
  if (pronto) return resposta(pronto);

  if (!ctx.fake && !ctx.llm) {
    return erro(503, "Scorecard indisponível: o servidor está sem OPENROUTER_API_KEY (use AGENTE_FAKE=1 para testar sem chave).");
  }
  const alvo = await resolverAvaliacao(sessao.avaliacaoId);
  if (!alvo) return erro(500, "avaliação da sessão indisponível");

  const r = await garantirScorecard(ctx, id, sessao, alvo);
  if ("falha" in r) return r.status === 202 ? json({ gerando: true }, 202) : erro(r.status, r.falha);
  return resposta(r);
}

/**
 * Gera (uma vez) e guarda o scorecard da sessão. Duas chamadas simultâneas na mesma instância compartilham o
 * mesmo trabalho; entre instâncias, uma reivindicação no kv faz a segunda esperar o resultado da primeira.
 */
export function garantirScorecard(ctx: Contexto, id: string, sessao: SessaoArmazenada, alvo: Avaliacao): Promise<Scorecard | Falha> {
  let tarefa = emAndamento.get(id);
  if (!tarefa) {
    tarefa = gerarEGuardar(ctx, id, sessao, alvo).finally(() => {
      emAndamento.delete(id);
    });
    emAndamento.set(id, tarefa);
  }
  return tarefa;
}

async function gerarEGuardar(ctx: Contexto, id: string, sessao: SessaoArmazenada, alvo: Avaliacao): Promise<Scorecard | Falha> {
  const kv = kvPadrao();
  const reivindicou = await kv.setIfAbsent("scorecard-job", id, { em: ctx.agora() });
  if (!reivindicou) {
    const job = await kv.get<{ em: number }>("scorecard-job", id);
    if (job && ctx.agora() - job.em < TEMPO_POR_TENTATIVA_RELATORIO_MS + 20_000) return { falha: "relatório ainda sendo gerado", status: 202 };
    await kv.set("scorecard-job", id, { em: ctx.agora() });
  }

  try {
    // Encerra a sessão (idempotente: depois de ENCERRADA o reducer ignora tudo).
    const atual = (await ctx.repositorio.obter(id)) ?? sessao;
    const estado = transicionar(atual.estado, { tipo: "ENCERRAR" }, ctx.agora()).estado;
    await ctx.repositorio.salvarEstado(id, estado);
    await noIndice(kv, id, { ended: true, state: "running" });
    const entrada = {
      sessaoId: id,
      candidatoId: sessao.candidatoId,
      estado,
      eventos: await ctx.repositorio.listarEventos(id),
      imagens: await ctx.repositorio.listarImagens(id),
    };
    const tentativaAnterior = await kv.get<{ attempt: number }>(NS_JANELA_SCORECARD, id);
    const attempt = (tentativaAnterior?.attempt ?? 0) + 1;
    await kv.set(NS_JANELA_SCORECARD, id, { attempt });
    const rota = attempt <= TENTATIVAS_FEATHERLESS_RELATORIO ? "primario" : "reserva";
    await noIndice(kv, id, { reportAttempt: attempt, reportReservaTentada: rota === "reserva", state: "running" });
    const agora = () => new Date(ctx.agora());
    try {
      const sc =
        ctx.fake || !ctx.llm
          ? gerarScorecardFalso({ kit: alvo.kit, problema: alvo.problema, agora }, entrada)
          : await gerarScorecard({ llm: ctx.llm, kit: alvo.kit, problema: alvo.problema, agora, rota, aoUsar: (u) => {
              void ctx.repositorio.anexarEventos(id, [{ horario: new Date(ctx.agora()).toISOString(), tipo: "scorecard_uso", dados: {
                modelo: u.modelo ?? "desconhecido", provedor: u.provedor ?? "desconhecido", reserva_disparada: u.reservaDisparada ?? false, ms: u.ms,
                tokens_entrada: u.entrada, tokens_saida: u.saida, ...(u.cache !== undefined ? { tokens_cache: u.cache } : {}), custo_usd: u.custo,
              } }]).catch(() => []);
            } }, entrada);
      await ctx.repositorio.salvarScorecard(id, sc);
      await noIndice(kv, id, {
        state: "done",
        overallScore: sc.nota_geral ?? undefined,
        recommendation: sc.recomendacao,
        cartao: cartaoDoScorecard(sc, kitDaSessao(alvo.kit, estado)),
      });
      return sc;
    } catch (e) {
      // Só o nome do erro vai ao log: nada de prompt, conversa ou chave.
      console.warn("[agente] scorecard_falhou", { sessao_id: id, erro: e instanceof Error ? e.name : "desconhecido" });
      await noIndice(kv, id, { state: attempt <= TENTATIVAS_FEATHERLESS_RELATORIO ? "running" : "error" });
      return {
        falha:
          e instanceof ErroLlm && e.codigo === "timeout"
            ? "O scorecard excedeu o prazo de geração. Nenhum relatório foi salvo; tente finalizar novamente."
          : "Não foi possível gerar o scorecard agora. Tente de novo em instantes.",
        status: attempt <= TENTATIVAS_FEATHERLESS_RELATORIO ? 202 : 502,
      };
    }
  } finally {
    // Libera a reivindicação: um scorecard pronto se acha pelo repositório; uma falha deixa tentar de novo.
    await kv.delete("scorecard-job", id).catch(() => {});
  }
}

/**
 * Gera o scorecard depois que a resposta já saiu (fim da entrevista): o relatório fica pronto no painel sem
 * ninguém abrir a página. Na Vercel o `after` mantém a função viva até terminar; fora de uma requisição
 * (testes, scripts) cai no segundo plano comum.
 */
export function finalizarEmSegundoPlano(id: string): void {
  const rodar = async () => {
    try {
      const ctx = contexto();
      const sessao = await ctx.repositorio.obter(id);
      if (!sessao || (await ctx.repositorio.obterScorecard(id))) return;
      if (!ctx.fake && !ctx.llm) return;
      const alvo = await resolverAvaliacao(sessao.avaliacaoId);
      if (alvo) await garantirScorecard(ctx, id, sessao, alvo);
    } catch (e) {
      console.warn("[agente] scorecard_em_segundo_plano_falhou", { sessao_id: id, erro: e instanceof Error ? e.name : "desconhecido" });
    }
  };
  try {
    after(rodar);
  } catch {
    void rodar();
  }
}

export async function scorecardGetHandler(req: Request, { params }: ParamsId): Promise<Response> {
  const { id } = await params;
  if (!eRecrutador(req)) return erro(404, "não encontrado");
  if (!eIdPlausivel(id)) return erro(404, "sessão não encontrada");
  const ctx = contexto();
  if (!(await ctx.repositorio.obter(id))) return erro(404, "sessão não encontrada");
  const sc = await ctx.repositorio.obterScorecard(id);
  if (!sc) return erro(404, "scorecard ainda não gerado (chame POST /finalizar)");
  return json(sc);
}

/** Visão segura do estado: nada de ficha, rubrica, texto de dúvida pendente ou conversa. */
export async function estadoDevHandler(_req: Request, { params }: ParamsId): Promise<Response> {
  if (!devHabilitado()) return erro(404, "não encontrado");
  const { id } = await params;
  if (!eIdPlausivel(id)) return erro(404, "sessão não encontrada");
  const ctx = contexto();
  const sessao = await ctx.repositorio.obter(id);
  if (!sessao) return erro(404, "sessão não encontrada");
  const e = sessao.estado;
  return json({
    fase: e.fase,
    plin: e.plin,
    plinPendente: e.perguntaPendente !== null,
    perguntaAtiva: e.perguntaAtiva !== null,
    perguntasFeitas: e.perguntasFeitas,
    perguntaFinalFeita: e.perguntaFinalFeita,
    criteriosSemEvidencia: criteriosSemEvidencia(e),
    observacoes: e.observacoes.length,
    analises: sessao.analises,
    scorecardGerado: (await ctx.repositorio.obterScorecard(id)) !== null,
  });
}
