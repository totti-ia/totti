/**
 * Gera candidatas de reações curtas do Totti ("Hm.", "Uhum.", "Tá.") com a MESMA voz da rota /api/falar.
 *
 * Por que existe: sintetizada sozinha, a reação curta soa seca. Aqui geramos gravações suaves, com contexto de
 * conversa (falas vizinhas), para o Lucas ouvir e escolher uma. Nada vai para public/audio/ por este script.
 *
 * Como rodar (a pasta de saída é obrigatória):
 *   npm run voz:reacoes -- <pasta-de-saida>
 *   ou: npx tsx --env-file=.env.local scripts/gerar-reacoes.ts <pasta-de-saida>
 *
 * Gera 3 variantes por reação (a, b, c) e, com `hm-hoje`, o "Hmm." como a rota gera hoje, para comparação.
 * Lê ELEVENLABS_API_KEY do ambiente; a chave nunca é impressa.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AJUSTES_DA_VOZ, MODELO, VOZ } from "../lib/voz/ajustes";

type Ajustes = { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean; speed: number };
type Variante = { sufixo: string; ajustes: Ajustes; contexto: boolean };

const REACOES: Record<string, string> = {
  hm: "Hmm.",
  hum: "Hum.",
  uhum: "Uhum.",
  ta: "Tá.",
  certo: "Certo.",
};

const ANTERIOR = "Então, eu pensei em começar pelo banco de dados.";
const SEGUINTE = "E depois?";

const BASE: Ajustes = { ...AJUSTES_DA_VOZ, speed: 1.0 };

const VARIANTES: Variante[] = [
  { sufixo: "a", ajustes: BASE, contexto: true },
  { sufixo: "b", ajustes: { ...BASE, stability: 0.5, style: 0.2 }, contexto: true },
  { sufixo: "c", ajustes: { ...BASE, speed: 0.9, stability: 0.9 }, contexto: true },
];

const HOJE: Variante = { sufixo: "hoje", ajustes: { ...AJUSTES_DA_VOZ }, contexto: false };

const pastaDeSaida = process.argv[2];
const chave = process.env.ELEVENLABS_API_KEY;

async function sintetizar(texto: string, variante: Variante, comContexto: boolean): Promise<{ status: number; audio?: Buffer; detalhe?: string }> {
  const corpo = {
    text: texto,
    model_id: MODELO,
    language_code: "pt",
    voice_settings: variante.ajustes,
    ...(comContexto && variante.contexto ? { previous_text: ANTERIOR, next_text: SEGUINTE } : {}),
  };
  const resposta = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOZ)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": chave ?? "", "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(corpo),
    },
  );
  if (!resposta.ok) {
    const bruto = await resposta.text();
    let detalhe = bruto.slice(0, 200);
    try {
      const json = JSON.parse(bruto) as { detail?: { message?: string } | string };
      if (typeof json.detail === "string") detalhe = json.detail;
      else if (json.detail?.message) detalhe = json.detail.message;
    } catch {
      // corpo não é JSON: mantém o trecho bruto (nunca contém a chave da requisição)
    }
    return { status: resposta.status, detalhe };
  }
  return { status: resposta.status, audio: Buffer.from(await resposta.arrayBuffer()) };
}

async function main() {
  if (!pastaDeSaida) {
    console.error("Uso: npx tsx --env-file=.env.local scripts/gerar-reacoes.ts <pasta-de-saida>");
    process.exit(1);
  }
  if (!chave) {
    console.error("ELEVENLABS_API_KEY não definida no ambiente (.env.local).");
    process.exit(1);
  }
  await mkdir(pastaDeSaida, { recursive: true });

  const trabalhos: { nome: string; texto: string; variante: Variante }[] = [
    { nome: "hm-hoje", texto: REACOES.hm, variante: HOJE },
  ];
  for (const [slug, texto] of Object.entries(REACOES)) {
    for (const variante of VARIANTES) trabalhos.push({ nome: `${slug}-${variante.sufixo}`, texto, variante });
  }

  let contextoAceito = true;
  for (const { nome, texto, variante } of trabalhos) {
    let resultado = await sintetizar(texto, variante, contextoAceito);
    if (resultado.status !== 200 && contextoAceito && variante.contexto && (resultado.status === 400 || resultado.status === 422)) {
      console.warn(`[aviso] ElevenLabs recusou previous_text/next_text (${resultado.status}: ${resultado.detalhe}). Gerando sem contexto.`);
      contextoAceito = false;
      resultado = await sintetizar(texto, variante, false);
    }
    if (resultado.status !== 200 || !resultado.audio) {
      console.error(`Erro da ElevenLabs em ${nome}: HTTP ${resultado.status}${resultado.detalhe ? ` - ${resultado.detalhe}` : ""}`);
      process.exit(1);
    }
    const caminho = join(pastaDeSaida, `${nome}.mp3`);
    await writeFile(caminho, resultado.audio);
    console.log(`${caminho}  ${resultado.audio.length} bytes  HTTP ${resultado.status}`);
  }
  if (!contextoAceito) console.log("Obs.: contexto (previous_text/next_text) não aceito pelo modelo; arquivos gerados sem ele.");
}

main().catch((e: unknown) => {
  console.error("Falha ao gerar reações:", e instanceof Error ? e.message : "erro desconhecido");
  process.exit(1);
});
