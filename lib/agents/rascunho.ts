// Rascunho da resposta do Totti no live coding (resposta antecipada). O cache e a chave ficam em
// lib/conversa/rascunho.ts; aqui está o que o live coding usa: preparar o turno numa cópia da sessão e, na confirmação,
// trocar o conteúdo da sessão real pelo da cópia quando a entrada e a sessão são as mesmas. Só servidor.
//
// A sessão inteira entra na chave de propósito: o prompt tem o relógio da sessão, o código numerado e o histórico, então
// reaproveitar só a chamada ao modelo não bastaria. Qualquer evento novo (de quem quer que seja) invalida o rascunho.
import { cacheGlobalDeRascunho, chaveDoRascunho, comRascunho, type CacheDeRascunho } from "@/lib/conversa/rascunho";
import type { ChatMessage, ChatResponse } from "@/lib/contracts";
import { TIPOS_DE_USO } from "@/lib/session/eventos";
import { appendEvent, latestCode, sessionNow, substituirSessao } from "@/lib/session/store";
import type { SessionState } from "@/lib/session/types";
import { runInterviewerTurn } from "@/lib/agents/interviewer";

/** O que o cache guarda: a resposta do turno e a cópia da sessão depois dele (a rascunho não tem cópia). */
export type ResultadoDoRascunho = { resposta: ChatResponse; sessao?: SessionState };

/** O pedido do turno, como a rota o recebe. `turno` são os argumentos de `runInterviewerTurn`. */
export interface PedidoDoTurno {
  sessionId: string;
  /** Como veio no corpo (vai para a chave, antes de qualquer checagem de pergunta conhecida). */
  blipId?: string;
  messages: ChatMessage[];
  reconheceu: boolean;
  liveCode?: string;
  liveLanguage?: string;
  turno: { blipId?: string; messages: ChatMessage[]; reconheceu: boolean };
}

export function cacheDoRascunhoDoLiveCoding(): CacheDeRascunho<ResultadoDoRascunho> {
  return cacheGlobalDeRascunho<ResultadoDoRascunho>("ide");
}

/**
 * Chave do turno: a entrada mais o estado da sessão naquele momento. Calculada antes do snapshot do código, nos dois
 * modos (o rascunho e o turno ao vivo), para que os dois vejam a mesma sessão.
 */
export function chaveDoTurno(session: SessionState, pedido: PedidoDoTurno): string {
  return chaveDoRascunho({
    blipId: pedido.blipId,
    messages: pedido.messages,
    code: pedido.liveCode,
    language: pedido.liveLanguage,
    reconheceu: pedido.reconheceu,
    sessao: semVolateis(session),
  });
}

/**
 * Campos que mudam durante a fala sem afetar a resposta: os eventos de uso (transcrição, voz, custo do LLM). Ficam
 * fora da chave; quem os gravou na sessão real durante o rascunho não perde nada na troca (ver `trocarConteudo`).
 * Snapshots, pausas e o que o decideBlip muda na fila continuam na chave de propósito.
 */
function semVolateis(session: SessionState): SessionState {
  return { ...session, events: session.events.filter((e) => !TIPOS_DE_USO.has(e.type)) };
}

/**
 * Cópia profunda da sessão para o rascunho. O `clock` é função (só a simulação o define) e não se clona: fica de fora
 * e volta na cópia. O resto é dados puros (ver lib/session/types.ts).
 */
export function copiaDaSessao(session: SessionState): SessionState {
  const copia = structuredClone({ ...session, clock: undefined }) as SessionState;
  if (session.clock) copia.clock = session.clock;
  return copia;
}

/**
 * O código de agora entra na linha do tempo antes do turno: o Totti nunca comenta uma versão velha. Usada nos dois
 * modos: o rascunho a aplica na cópia, o turno ao vivo na sessão real.
 */
export function aplicarCodigoDeAgora(session: SessionState, liveCode?: string, liveLanguage?: string): void {
  if (liveCode === undefined || session.ended || liveCode === latestCode(session)) return;
  appendEvent(session, {
    type: "snapshot",
    sessionId: session.sessionId,
    t: sessionNow(session),
    code: liveCode,
    version: (session.codeHistory.at(-1)?.version ?? 0) + 1,
    language: liveLanguage ?? session.language,
  });
}

/**
 * Põe na sessão real o conteúdo da cópia, mantendo o objeto (o store e as WeakMaps de decisões, analista e avaliação
 * seguram a referência). Os eventos de uso gravados na real durante o rascunho (fora da chave) são somados de volta,
 * sem repetir os que a cópia já tem.
 */
export function trocarConteudo(alvo: SessionState, origem: SessionState): void {
  const usoDaReal = alvo.events.filter((e) => TIPOS_DE_USO.has(e.type));
  substituirSessao(origem, alvo);
  const jaNaCopia = new Set(alvo.events.map((e) => chaveDoRascunho(e)));
  const novos = usoDaReal.filter((e) => !jaNaCopia.has(chaveDoRascunho(e)));
  if (novos.length) alvo.events = [...alvo.events, ...novos].sort((a, b) => a.t - b.t);
}

/**
 * Prepara a resposta do turno numa cópia da sessão, sem gravar nada (sem guardarSessao, sem analista, sem `after`).
 * O resultado fica no cache sob a chave; a confirmação que chegar com o rascunho ainda em preparo espera por ele.
 */
export async function prepararRascunho(
  session: SessionState,
  pedido: PedidoDoTurno,
  cache: CacheDeRascunho<ResultadoDoRascunho> = cacheDoRascunhoDoLiveCoding(),
): Promise<{ rascunho: true; reply: string } | { rascunho: false }> {
  if (session.ended) return { rascunho: false };
  const chave = chaveDoTurno(session, pedido);
  const copia = copiaDaSessao(session);
  aplicarCodigoDeAgora(copia, pedido.liveCode, pedido.liveLanguage);
  const promessa = runInterviewerTurn(copia, pedido.turno).then((resposta) => ({ resposta, sessao: copia }));
  cache.guardar(pedido.sessionId, chave, promessa);
  try {
    const { resposta } = await promessa;
    return { rascunho: true, reply: resposta.reply };
  } catch (err) {
    console.error("[chat] rascunho falhou:", err instanceof Error ? err.message : err);
    return { rascunho: false };
  }
}

/**
 * Turno da confirmação: usa o rascunho com a mesma chave, se houver e tiver dado certo; senão, roda ao vivo como antes.
 * Entre o `tomar` e o fim da espera a sessão real fica livre: se outra requisição gravar nela nesse meio-tempo, a troca
 * desfaz essa gravação (só os eventos de uso são somados de volta). Na prática a promessa já está pronta quando a fala
 * confirma, então a janela é de milissegundos.
 */
export async function turnoComRascunho(
  session: SessionState,
  pedido: PedidoDoTurno,
  cache: CacheDeRascunho<ResultadoDoRascunho> = cacheDoRascunhoDoLiveCoding(),
): Promise<{ resposta: ChatResponse; doRascunho: boolean; ms: number }> {
  const chave = chaveDoTurno(session, pedido);
  const inicio = Date.now();
  const { valor, doRascunho } = await comRascunho<ResultadoDoRascunho>(cache, pedido.sessionId, chave, async () => {
    aplicarCodigoDeAgora(session, pedido.liveCode, pedido.liveLanguage);
    return { resposta: await runInterviewerTurn(session, pedido.turno) };
  });
  if (doRascunho && valor.sessao) trocarConteudo(session, valor.sessao);
  return { resposta: valor.resposta, doRascunho, ms: Date.now() - inicio };
}
