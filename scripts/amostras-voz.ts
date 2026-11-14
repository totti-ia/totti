/**
 * Amostras para ouvir a voz do Totti antes e depois do contexto entre falas e da velocidade por tipo de fala.
 *
 * Gera 10 MP3 com a MESMA voz, modelo e ajustes da rota /api/falar (lib/voz/ajustes.ts):
 *   antes-1..5.mp3   a frase de teste sem contexto, com speed 1,1 (como era antes: a variação entre pedidos aparece)
 *   depois-1..5.mp3  a frase de teste com previous_text = fala anterior N e speed = velocidadeDaFala(frase) (como é agora)
 *
 * Como rodar (a pasta de saída é obrigatória):
 *   npm run voz:amostras -- <pasta-de-saida>
 *   ou: npx tsx --env-file=.env.local scripts/amostras-voz.ts <pasta-de-saida>
 *
 * Lê ELEVENLABS_API_KEY do ambiente; a chave nunca é impressa.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AJUSTES_DA_VOZ, MODELO, VOZ } from "../lib/voz/ajustes";
import { velocidadeDaFala, VELOCIDADE_PADRAO } from "../lib/voz/velocidade";

const FRASE_DE_TESTE = "Legal. E se o número de acessos dobrar amanhã, o que você mudaria primeiro?";

const FALAS_ANTERIORES = [
  "Oi, tudo bem? Eu sou o Totti e vou conduzir essa conversa com você hoje.",
  "Beleza, vamos começar pelo problema. Dá uma olhada no enunciado e me conta como você pensaria a solução.",
  "Entendi, você colocou um cache na frente do banco.",
  "Hum, certo. E por que essa opção e não um banco replicado?",
  "A gente está chegando no fim do tempo, então vou te fazer uma última pergunta.",
];

type Trabalho = { nome: string; corpo: Record<string, unknown> };

const pastaDeSaida = process.argv[2];
const chave = process.env.ELEVENLABS_API_KEY;

function trabalhos(): Trabalho[] {
  const ajustesBase = { ...AJUSTES_DA_VOZ };
  const lista: Trabalho[] = [];
  for (let n = 1; n <= FALAS_ANTERIORES.length; n++) {
    lista.push({
      nome: `antes-${n}`,
      corpo: { text: FRASE_DE_TESTE, model_id: MODELO, language_code: "pt", voice_settings: { ...ajustesBase, speed: VELOCIDADE_PADRAO } },
    });
  }
  for (let n = 1; n <= FALAS_ANTERIORES.length; n++) {
    lista.push({
      nome: `depois-${n}`,
      corpo: {
        text: FRASE_DE_TESTE,
        model_id: MODELO,
        language_code: "pt",
        previous_text: FALAS_ANTERIORES[n - 1],
        voice_settings: { ...ajustesBase, speed: velocidadeDaFala(FRASE_DE_TESTE) },
      },
    });
  }
  return lista;
}

async function sintetizar(corpo: Record<string, unknown>): Promise<{ status: number; audio?: Buffer; detalhe?: string }> {
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
    console.error("Uso: npm run voz:amostras -- <pasta-de-saida>");
    process.exit(1);
  }
  if (!chave) {
    console.error("ELEVENLABS_API_KEY não definida no ambiente (.env.local).");
    process.exit(1);
  }
  await mkdir(pastaDeSaida, { recursive: true });

  for (const { nome, corpo } of trabalhos()) {
    const resultado = await sintetizar(corpo);
    if (resultado.status !== 200 || !resultado.audio) {
      console.error(`Erro da ElevenLabs em ${nome}: HTTP ${resultado.status}${resultado.detalhe ? ` - ${resultado.detalhe}` : ""}`);
      process.exit(1);
    }
    const caminho = join(pastaDeSaida, `${nome}.mp3`);
    await writeFile(caminho, resultado.audio);
    console.log(`${nome}.mp3  ${resultado.audio.length} bytes  HTTP ${resultado.status}`);
  }
}

main().catch((e: unknown) => {
  console.error("Falha ao gerar amostras:", e instanceof Error ? e.message : "erro desconhecido");
  process.exit(1);
});
