import assert from "node:assert/strict";
import { test } from "node:test";
import { criarConversor } from "@/lib/excalidraw/conversor";
import type { ExcalidrawElement, ExcalidrawImperativeAPI } from "@/lib/excalidraw/tipos";

test("anotarPergunta grava rastro no quadro, substitui por peça e limita a oito; imagem e grafo omitem notas do agente", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const modulo = require("node:module") as { _load: (...args: unknown[]) => unknown };
  const originalLoad = modulo._load;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: {} } });
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ getPropertyValue: () => "#0071e3" }) });
  modulo._load = function(request: unknown, ...args: unknown[]) {
    if (request === "@excalidraw/excalidraw") return {
      CaptureUpdateAction: { NEVER: "never" },
      FONT_FAMILY: { Excalifont: 5 },
      convertToExcalidrawElements: (elements: Record<string, unknown>[]) => elements.map((e) => ({
        ...e, type: e.type, isDeleted: false, locked: true, opacity: 100, version: e.version ?? 1,
      })),
      exportToBlob: async ({ elements }: { elements: ExcalidrawElement[] }) => elements,
      newElementWith: (element: Record<string, unknown>, changes: Record<string, unknown>) => ({ ...element, ...changes }),
    };
    return originalLoad.call(this, request, ...args);
  };
  const { criarCamadaAgente, ehDoAgente } = await import("@/lib/excalidraw/agente");
  const { imagemDoCandidato } = await import("@/lib/excalidraw/imagem");
  modulo._load = originalLoad;
  let cena: ExcalidrawElement[] = [
    {
      id: "peca", type: "rectangle", x: 100, y: 100, width: 180, height: 80, angle: 0,
      strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "hachure", strokeWidth: 1,
      roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1,
      version: 1, versionNonce: 1, index: "a0" as never, isDeleted: false, locked: false,
      customData: undefined,
      label: undefined,
    } as unknown as ExcalidrawElement,
  ];
  const api = {
    getSceneElements: () => cena,
    getSceneElementsIncludingDeleted: () => cena,
    getAppState: () => ({
      newElement: null, multiElement: null, resizingElement: null, editingTextElement: null,
      selectedElementsAreBeingDragged: false, isResizing: false, isRotating: false, cursorButton: "up",
    }),
    updateScene: ({ elements }: { elements?: ExcalidrawElement[] }) => { if (elements) cena = elements; },
    getFiles: () => ({}),
  } as unknown as ExcalidrawImperativeAPI;
  const camada = criarCamadaAgente(api);
  for (let i = 0; i < 8; i++) {
    await camada.anotarPergunta({
      id: `nota-${i}`, grupo: `rastro:p${i}`, alvoId: `p${i}`, texto: `Pergunta número ${i} excedente ignorada`,
      x: 320, y: 100 + i * 30, velocidade: 100_000,
    });
  }
  await camada.anotarPergunta({
    id: "nota-p3-nova", grupo: "rastro:p3", alvoId: "p3", texto: "Nova pergunta sobre a peça três", x: 320, y: 400, velocidade: 100_000,
  });
  await camada.anotarPergunta({
    id: "nota-8", grupo: "rastro:p8", alvoId: "p8", texto: "Pergunta número oito excedente ignorada", x: 320, y: 430, velocidade: 100_000,
  });

  const notas = cena.filter((e) => e.customData?.grupo?.startsWith("rastro:") && !e.isDeleted);
  assert.equal(notas.length, 8);
  assert.equal(new Set(notas.map((e) => e.customData?.grupo)).size, 8, "há no máximo uma anotação por peça");
  assert.equal(notas.some((e) => e.id === "nota-0"), false, "a nona peça remove a anotação mais antiga");
  const notaSubstituta = notas.find((e) => e.id === "nota-p3-nova");
  assert.ok(notaSubstituta);
  assert.equal("text" in notaSubstituta ? notaSubstituta.text : "", "Nova pergunta sobre a peça três");
  assert.ok(notas.every((e) => !(("text" in e ? e.text : "").length > 40)), "cada nota respeita o teto de 40 caracteres");
  assert.ok(notas.every(ehDoAgente), "todas as notas carregam autoria do agente para exclusão da imagem");

  const imagem = await imagemDoCandidato(api) as unknown as ExcalidrawElement[];
  assert.deepEqual(imagem.map((e) => e.id), ["peca"], "a exportação da imagem recebe só elementos do candidato");
  const convertido = criarConversor().converter(cena);
  assert.equal(convertido.instantaneo.anotacoes.length, 0, "notas do agente não entram no grafo");
  assert.deepEqual(convertido.instantaneo.componentes.map((c) => c.id), ["r1"]);
});
