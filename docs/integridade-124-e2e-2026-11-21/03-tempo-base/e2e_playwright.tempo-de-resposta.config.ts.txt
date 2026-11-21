import { defineConfig } from "@playwright/test";
import voz from "./playwright.voz.config";

// Mesma sala, agente falso e microfone do teste de voz. Executar separado, com a máquina livre.
export default defineConfig({ ...voz, testMatch: "tempo-de-resposta.spec.ts" });
