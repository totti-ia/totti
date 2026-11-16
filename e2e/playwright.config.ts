import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORTA = Number(process.env.PORTA_E2E ?? 3005);

/**
 * Áudio falso em silêncio: o microfone falso padrão do Chromium emite bipes, que o
 * detector de silêncio da sala confunde com fala e encerra a resposta do plin sozinho.
 */
function audioSilencioso() {
  const pasta = join(tmpdir(), "converge-e2e");
  mkdirSync(pasta, { recursive: true });
  const arquivo = join(pasta, "silencio.wav");
  const taxa = 16_000;
  const amostras = taxa; // 1 s, repetido em loop pelo navegador
  const dados = amostras * 2;
  const wav = Buffer.alloc(44 + dados);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dados, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(taxa, 24);
  wav.writeUInt32LE(taxa * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dados, 40);
  writeFileSync(arquivo, wav);
  return arquivo;
}

export default defineConfig({
  testDir: ".",
  // Saídas na raiz, como antes de a config vir para e2e/ (o .gitignore já ignora essas pastas).
  outputDir: "../test-results",
  // O fluxo é longo (escrita à mão do agente, pausa da análise): 3 rodadas seguidas na mesma página.
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]],
  use: {
    baseURL: `http://localhost:${PORTA}`,
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    permissions: ["camera", "microphone"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: [
            // Sem som nos alto-falantes de quem roda os testes (a voz do navegador fala as perguntas).
            "--mute-audio",
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${audioSilencioso()}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORTA}`,
    url: `http://localhost:${PORTA}/entrevista/system-design`,
    // Modo servidor com endpoints interceptados pelo spec: exercita análise e upload de imagens.
    env: { NEXT_PUBLIC_USAR_SERVIDOR: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
