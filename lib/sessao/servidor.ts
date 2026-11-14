import { z } from "zod";
import { ETAPAS_DO_FECHAMENTO } from "../totti/fechamento";
import { EsquemaVisualOpcional } from "../presenca/acoesVisuais";
import { validarResposta, type PedidoAnalise, type RespostaAnalise, type Sessao } from "./cliente";
import type { Alinhamento } from "../presenca/alinhamento";
import { obterSessaoDaVoz } from "../voz/cliente";
import type { ContextoDaFala } from "../voz/contrato";

export type { FalaRecente, Fase, PedidoAnalise, RespostaAnalise, Sessao } from "./cliente";
export type { Alinhamento } from "../presenca/alinhamento";

const EsquemaSessao: z.ZodType<Sessao> = z.object({
  sessao_id: z.string().min(1),
  area: z.string(),
  problema: z.object({ titulo: z.string(), enunciado: z.string(), fala_do_desafio: z.string().optional() }),
  tempos: z.record(
    z.enum(["AGUARDANDO", "APRESENTACAO", "REQUISITOS", "ALTO_NIVEL", "APROFUNDAMENTO", "FECHAMENTO", "ENCERRADA"]),
    z.number().finite().nonnegative(),
  ),
  apresentacao: z.string().nullable().optional(),
  despedida: z.string().nullable().optional(),
});

const EsquemaPergunta = z.object({ responder: z.boolean(), texto: z.string(), requisito: z.string().nullable(), concluiu: z.boolean().default(false), seguimento: z.boolean().default(false), encerrar: z.boolean().default(false), pediuTempo: z.boolean().default(false), visual: EsquemaVisualOpcional, fechamento: z.enum(ETAPAS_DO_FECHAMENTO).optional() });
export type RespostaPerguntar = z.infer<typeof EsquemaPergunta>;
const EsquemaAlinhamento: z.ZodType<Alinhamento> = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number().finite().nonnegative()),
  character_end_times_seconds: z.array(z.number().finite().nonnegative()),
}).refine((a) => a.characters.length === a.character_start_times_seconds.length
  && a.characters.length === a.character_end_times_seconds.length, "Os horários devem corresponder aos caracteres.")
  .refine((a) => a.character_end_times_seconds.every((fim, i) => fim >= a.character_start_times_seconds[i]), "O fim de cada caractere deve ser posterior ao início.");
const EsquemaFala = z.object({ audio_base64: z.string().min(1), alinhamento: EsquemaAlinhamento });
const EsquemaImagem = z.object({ url: z.string().min(1) });
const EsquemaToken = z.object({ token: z.string().min(1) });

/** Erro HTTP de uma rota do servidor, com o status para quem precisar decidir por ele. */
export class ErroHttp extends Error {
  constructor(mensagem: string, readonly status: number) {
    super(mensagem);
    this.name = "ErroHttp";
  }
}

function rotaDaSessao(sessaoId: string, acao: string): string {
  return `/api/sessoes/${encodeURIComponent(sessaoId)}/${acao}`;
}

function jsonPost(dados: unknown, sinal?: AbortSignal): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados), signal: sinal };
}

function resumir(texto: string): string {
  const normalizado = texto.replace(/\s+/gu, " ").trim();
  return normalizado.length > 240 ? normalizado.slice(0, 240) + "…" : normalizado;
}

function preservarCancelamento(erro: unknown, sinal?: AbortSignal | null): void {
  sinal?.throwIfAborted();
  if (erro instanceof Error && erro.name === "AbortError") throw erro;
}

async function requisitar(rota: string, opcoes: RequestInit): Promise<Response> {
  opcoes.signal?.throwIfAborted();
  const resposta = await fetch(rota, opcoes);
  opcoes.signal?.throwIfAborted();
  if (!resposta.ok) {
    let corpo = "";
    try {
      corpo = await resposta.text();
    } catch (erro) {
      preservarCancelamento(erro, opcoes.signal);
    }
    opcoes.signal?.throwIfAborted();
    throw new ErroHttp(`Erro HTTP ${resposta.status} em ${rota}: ${resumir(corpo) || "sem corpo"}`, resposta.status);
  }
  return resposta;
}

async function lerJson(rota: string, opcoes: RequestInit): Promise<unknown> {
  const resposta = await requisitar(rota, opcoes);
  try {
    const dados: unknown = await resposta.json();
    opcoes.signal?.throwIfAborted();
    return dados;
  } catch (erro) {
    preservarCancelamento(erro, opcoes.signal);
    throw new Error(`JSON inválido na resposta de ${rota}.`);
  }
}

function validar<T>(rota: string, dados: unknown, esquema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const resultado = esquema.safeParse(dados);
  if (!resultado.success) throw erroDeFormato(rota, resultado.error);
  return resultado.data;
}

function erroDeFormato(rota: string, erro: z.ZodError): Error {
  const problema = erro.issues[0];
  const detalhe = problema ? `${problema.path.join(".") || "resposta"}: ${problema.message}` : "formato inválido";
  return new Error(`Resposta inesperada de ${rota}: ${detalhe}`);
}

export async function criarSessao(opcoes: { avaliacaoId: string; candidatoId: string; configId?: string }): Promise<Sessao> {
  const rota = "/api/sessoes";
  // `config_id`: plano de entrevista da vaga (pré-entrevista); o servidor escolhe o kit e calibra o agente por ele.
  const dados = await lerJson(rota, jsonPost({ avaliacao_id: opcoes.avaliacaoId, candidato_id: opcoes.candidatoId, config_id: opcoes.configId }));
  return validar(rota, dados, EsquemaSessao);
}

export async function analisar(pedido: PedidoAnalise, sinal: AbortSignal): Promise<RespostaAnalise> {
  const rota = rotaDaSessao(pedido.sessao_id, "analisar");
  const dados = await lerJson(rota, jsonPost(pedido, sinal));
  try {
    return validarResposta(dados);
  } catch (erro) {
    if (erro instanceof z.ZodError) throw erroDeFormato(rota, erro);
    throw erro;
  }
}

export async function perguntar(sessaoId: string, fase: string, texto: string, contexto: { grafo?: string; pergunta_ativa?: string; requisitos?: string[]; gestos_recentes?: string[]; mudancas?: string; imagem_base64?: string; conversa_do_quadro?: unknown[]; substitui?: boolean; desenho_parado_ha_s?: number; pergunta_cortada?: boolean } = {}, sinal?: AbortSignal): Promise<RespostaPerguntar> {
  const rota = rotaDaSessao(sessaoId, "perguntar");
  const dados = await lerJson(rota, jsonPost({ sessao_id: sessaoId, fase, texto, ...contexto }, sinal));
  return validar(rota, dados, EsquemaPergunta);
}

/** O relógio pede o fechamento sem inventar uma fala do candidato nem chamar o modelo. */
export async function pedirFechamento(sessaoId: string, dados: { fase: string; grafo?: string; gatilho: "tempo" | "pediu_encerrar" }): Promise<RespostaPerguntar> {
  const rota = rotaDaSessao(sessaoId, "fechamento");
  return validar(rota, await lerJson(rota, jsonPost(dados)), EsquemaPergunta);
}

const EsquemaEmpecilho = z.object({
  empecilho: z.object({ fala: z.string().min(1), requisito: z.string().min(1) }).nullable(),
  motivo: z.string().nullable(),
});
export type RespostaEmpecilho = z.infer<typeof EsquemaEmpecilho>;

/** Pede a mudança no problema. O servidor decide se é a hora (ou solta já, com `forcar`, fora de produção). */
export async function pedirEmpecilho(sessaoId: string, dados: { fase: string; grafo?: string; forcar?: boolean }): Promise<RespostaEmpecilho> {
  const rota = rotaDaSessao(sessaoId, "empecilho");
  return validar(rota, await lerJson(rota, jsonPost({ sessao_id: sessaoId, ...dados })), EsquemaEmpecilho);
}

/** `contexto` leva o texto anterior e o ritmo da fala (ver lib/voz/cliente.ts); sem ele, a fala vai só com o texto. */
export async function sintetizarFala(texto: string, sinal?: AbortSignal, contexto: ContextoDaFala = {}): Promise<{ bytes: Uint8Array; alinhamento: Alinhamento }> {
  const rota = "/api/falar";
  const meta = obterSessaoDaVoz();
  const dados = validar(rota, await lerJson(rota, jsonPost({ texto, ...contexto, ...(meta ?? {}) }, sinal)), EsquemaFala);
  let binario: string;
  try {
    binario = atob(dados.audio_base64);
  } catch {
    throw new Error(`Resposta inesperada de ${rota}: audio_base64 inválido.`);
  }
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return { bytes, alinhamento: dados.alinhamento };
}

export async function enviarEventos(sessaoId: string, lote: { horario: string; tipo: string; dados: unknown }[]): Promise<void> {
  await requisitar(rotaDaSessao(sessaoId, "eventos"), jsonPost({ eventos: lote }));
}

/** Encerra a sessão no servidor e pede o scorecard. O candidato não recebe o scorecard: só o aviso de que saiu. */
export async function finalizar(sessaoId: string): Promise<void> {
  await requisitar(rotaDaSessao(sessaoId, "finalizar"), { ...jsonPost({}), keepalive: true });
}

export async function enviarImagem(sessaoId: string, imagem: Blob, horario: string): Promise<string> {
  const rota = rotaDaSessao(sessaoId, "imagens");
  const formulario = new FormData();
  formulario.append("imagem", imagem, "quadro.png");
  formulario.append("horario", horario);
  const dados = await lerJson(rota, { method: "POST", body: formulario });
  return validar(rota, dados, EsquemaImagem).url;
}

export async function tokenTranscricao(sessaoId: string): Promise<string> {
  const rota = `/api/stt-token?${new URLSearchParams({ sessao_id: sessaoId })}`;
  const dados = await lerJson(rota, { method: "GET" });
  return validar(rota, dados, EsquemaToken).token;
}
