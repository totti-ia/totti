import assert from "node:assert/strict";
import { test } from "node:test";
import { apontarEAnotar } from "../coreografia";
import { analisar } from "@/lib/agente/analisar";
import { perguntar } from "@/lib/agente/perguntar";
import { criarClienteFalso } from "@/lib/agente/llm/cliente";
import { KIT_SYSTEM_DESIGN } from "@/lib/agente/kits/system-design";
import { estadoInicial } from "@/lib/agente/sessao/estado";

test("seis perguntas da análise e da conversa deixam gesto visível e anotação no quadro falso", async () => {
  const antigoDocumento = globalThis.document;
  const antigoRaf = globalThis.requestAnimationFrame;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelector: () => null } });
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0) as unknown as number;
  try {
    const elementos = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i + 1}`, type: "rectangle", x: 80 + i * 210, y: 150, width: 150, height: 90,
      isDeleted: false,
    }));
    const tracos: unknown[] = [];
    const notas: { alvo: string; texto: string }[] = [];
    const estado = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0, width: 1500, height: 800 };
    const quadro = {
      api: {
        getSceneElements: () => elementos,
        getAppState: () => estado,
        scrollToContent: async () => {},
      },
      agente: {
        candidatoOcupado: () => false,
        esperarCandidatoLivre: async () => {},
        ancorar: () => {},
        tracar: (o: unknown) => tracos.push(o),
        escrever: async () => {},
        anotarPergunta: async (o: { alvoId: string; texto: string }) => notas.push({ alvo: o.alvoId, texto: o.texto }),
        apagarGrupo: async () => {},
        rolar: () => {},
      },
    } as never;
    const conexoes = Array.from({ length: 5 }, (_, i) => [`r${i + 1}`, `r${i + 2}`] as const);
    const grafo = ["COMPONENTES", ...elementos.map((_, i) => `- [r${i + 1}] Peça ${i + 1} (retângulo)`),
      "CONEXÕES", ...elementos.slice(1).map((_, i) => `- [s${i + 1}] Peça ${i + 1} → Peça ${i + 2}`)].join("\n");
    const problema = KIT_SYSTEM_DESIGN.problemas[0];
    const kit = KIT_SYSTEM_DESIGN;
    const visuais: { fala: string; alvo: string; visual?: import("../acoesVisuais").AcaoVisual[] }[] = [];
    // A análise recebe três falas de pergunta, e a política real garante seus gestos.
    for (let i = 0; i < 6; i++) {
      const alvo = `r${i + 1}`;
      const nome = `Peça ${i + 1}`;
      const fala = `Como funciona ${nome}?`;
      if (i < 3) {
        const resultado = await analisar({
          llm: criarClienteFalso([{
            status: "duvida", pergunta: fala, nota: fala, elementos: [alvo], degrau: null,
            observacoes: [], parteFechada: true, escopo: false,
          }]), kit, problema, log: () => {},
        }, { ...estadoInicial(), fase: "APROFUNDAMENTO" }, {
          sessao_id: "teste-142", fase: "APROFUNDAMENTO", grafo, mudancas: "", conversa_recente: [],
          perguntas_feitas: 0, imagem_url: null,
        }, 10_000 + i);
        visuais.push({ fala: resultado.resposta.pergunta ?? fala, alvo, visual: resultado.resposta.visual });
      } else {
        const resultado = await perguntar({ llm: criarClienteFalso([{
          responder: true, texto: fala, requisito: null, concluiu: false,
        }]), kit, problema, log: () => {}, versao: "v1" }, { ...estadoInicial(), fase: "APROFUNDAMENTO" }, {
          fase: "APROFUNDAMENTO", texto: `Estou pensando em ${nome}.`, grafo,
        }, 20_000 + i);
        visuais.push({ fala: resultado.texto, alvo, visual: resultado.visual });
      }
    }
    // As seis respostas do agente passam pela mesma coreografia sobre uma cena falsa.
    for (let i = 0; i < visuais.length; i++) {
      const { alvo, fala, visual } = visuais[i];
      const resposta = new AbortController();
      resposta.abort();
      await apontarEAnotar({
        quadro, cursor: null, grupo: `pergunta:${i + 1}`, alvos: [alvo], nota: fala,
        fala, visual, conexoes, sinalPodeApagar: resposta.signal, semente: i + 1,
      });
    }
    assert.equal(new Set(tracos.map((o) => (o as { id: string }).id)).size, 6, "cada fala sobre uma peça desenha um gesto visível");
    assert.equal(notas.length, 6, "cada pergunta deixa sua nota no quadro");
    assert.equal(new Set(notas.map((n) => n.alvo)).size, 6);
    assert.ok(notas.every((n) => n.texto.length <= 40));
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: antigoDocumento });
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: antigoRaf });
  }
});
