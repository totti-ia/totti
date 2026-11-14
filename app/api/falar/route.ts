import { after, NextResponse } from "next/server";
import { MAXIMO_CONTEXTO_DA_FALA, RespostaVoz } from "@/lib/voz/contrato";
import { criarLimitador, ipDe, lerTexto } from "@/lib/agente/rotas/http";
import { registrarUsoVoz } from "@/lib/voz/uso";
import { VELOCIDADE_MAXIMA, VELOCIDADE_MINIMA, VELOCIDADE_PADRAO } from "@/lib/voz/velocidade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Voz do agente: ElevenLabs com tempos por caractere (a legenda e a mão do agente seguem a fala).
// Sem ELEVENLABS_API_KEY responde 501. Com servidor, a fala fica na legenda (nunca troca para a voz do navegador).
// A voz do Totti é uma só, em todo o site (quadro, live coding, pré-entrevista): Fernando - Casual (pt-BR), no
// eleven_flash_v2_5, com os ajustes abaixo. Escolhida ouvindo amostras em 2026-11-09. Fixa de propósito, sem variável
// de ambiente: com os ajustes do painel (estilo 0,15, velocidade 1) o tom mudava de uma fala para outra e soava lenta.
const VOZ = "jyRzzBWbHll8EUfOjmhe";
// ~0,4 s numa fala curta (o turbo_v2_5 dá o mesmo tempo; o multilingual_v2, 0,65-0,8 s).
const MODELO = "eleven_flash_v2_5";
/** Estabilidade alta e estilo 0: a voz soa igual em toda fala. Velocidade 1,1 tira a lentidão. */
const AJUSTES_DA_VOZ = { stability: 0.75, similarity_boost: 0.85, style: 0, use_speaker_boost: true, speed: VELOCIDADE_PADRAO } as const;
const MAXIMO_CARACTERES = 2000;
const porIp = criarLimitador(60, 60_000);
const global = criarLimitador(300, 600_000);

const headers = { "Cache-Control": "no-store" };
const erro = (status: number, mensagem: string) => NextResponse.json({ erro: mensagem }, { status, headers });

/** Falas vizinhas: ausente ou vazia não entra; texto acima do limite ou de tipo errado devolve false (vira 400). */
function lerContexto(valor: unknown): string | false | undefined {
  if (valor === undefined) return undefined;
  if (typeof valor !== "string") return false;
  const limpo = valor.trim();
  if (limpo.length > MAXIMO_CONTEXTO_DA_FALA) return false;
  return limpo || undefined;
}

export async function POST(req: Request) {
  const origem = req.headers.get("origin");
  if (origem && origem !== new URL(req.url).origin) return erro(403, "Origem não permitida.");
  const chave = process.env.ELEVENLABS_API_KEY;
  if (!chave) return erro(501, "voz ainda não configurada");
  let texto = "";
  let metadados: { sessao_id: string; contexto: "quadro" | "coding" | "pre"; fala_id?: string } | undefined;
  // Mantém a prosódia entre falas: a ElevenLabs recebe o que veio antes e o que vem depois, quando o cliente manda.
  let vizinhas: { previous_text?: string; next_text?: string } = {};
  let velocidade = VELOCIDADE_PADRAO;
  try {
    const lido = await lerTexto(req, 16 * 1024);
    if (!lido.ok) return lido.resposta;
    const corpo: unknown = JSON.parse(lido.dados);
    if (corpo && typeof corpo === "object" && typeof (corpo as { texto?: unknown }).texto === "string") {
      const objeto = corpo as { texto: string; sessao_id?: unknown; contexto?: unknown; fala_id?: unknown; texto_anterior?: unknown; texto_seguinte?: unknown; velocidade?: unknown };
      texto = objeto.texto.trim();
      if (objeto.sessao_id !== undefined || objeto.contexto !== undefined || objeto.fala_id !== undefined) {
        if (typeof objeto.sessao_id !== "string" || !objeto.sessao_id.trim() || objeto.sessao_id.length > 80
          || !["quadro", "coding", "pre"].includes(String(objeto.contexto))
          || (objeto.fala_id !== undefined && (typeof objeto.fala_id !== "string" || objeto.fala_id.length > 100))) return erro(400, "metadados de sessão inválidos.");
        metadados = { sessao_id: objeto.sessao_id.trim(), contexto: objeto.contexto as "quadro" | "coding" | "pre", ...(typeof objeto.fala_id === "string" ? { fala_id: objeto.fala_id } : {}) };
      }
      const anterior = lerContexto(objeto.texto_anterior);
      const seguinte = lerContexto(objeto.texto_seguinte);
      if (anterior === false || seguinte === false) return erro(400, `contexto de fala inválido (até ${MAXIMO_CONTEXTO_DA_FALA} caracteres).`);
      vizinhas = { ...(anterior ? { previous_text: anterior } : {}), ...(seguinte ? { next_text: seguinte } : {}) };
      if (objeto.velocidade !== undefined) {
        if (typeof objeto.velocidade !== "number" || !(objeto.velocidade >= VELOCIDADE_MINIMA && objeto.velocidade <= VELOCIDADE_MAXIMA)) return erro(400, "velocidade inválida.");
        velocidade = objeto.velocidade;
      }
    }
  } catch {
    return erro(400, "JSON inválido.");
  }
  if (!texto || texto.length > MAXIMO_CARACTERES) return erro(400, `texto obrigatório (até ${MAXIMO_CARACTERES} caracteres).`);
  if (porIp.estourou(ipDe(req)) || global.estourou("global")) return erro(429, "Limite de voz atingido. Tente em instantes.");

  const voz = encodeURIComponent(VOZ);
  try {
    const resposta = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": chave, "Content-Type": "application/json" },
      body: JSON.stringify({ text: texto, model_id: MODELO, language_code: "pt", voice_settings: { ...AJUSTES_DA_VOZ, speed: velocidade }, ...vizinhas }),
      cache: "no-store",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(20000)]),
    });
    if (!resposta.ok) return erro(502, "ElevenLabs recusou o pedido de voz.");
    const dados = (await resposta.json()) as { audio_base64?: unknown; alignment?: Record<string, unknown> | null };
    const vozGerada = RespostaVoz.safeParse({ audio_base64: dados.audio_base64, alinhamento: dados.alignment });
    if (!vozGerada.success) return erro(502, "Resposta inesperada do ElevenLabs.");
    if (metadados) after(() => registrarUsoVoz(metadados, texto).catch((e) => console.warn("[voz] não registrou uso da sessão:", e instanceof Error ? e.message : "erro")));
    return NextResponse.json(vozGerada.data, { headers });
  } catch {
    return erro(502, "ElevenLabs indisponível.");
  }
}
