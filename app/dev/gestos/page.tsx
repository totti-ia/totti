"use client";

// Vitrine dos gestos do Totti no quadro (#82, #142), só para o time conferir: um quadro de exemplo com os cinco tipos de
// alvo e um botão por gesto. Não é parte do produto.
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import type { Quadro } from "@/components/Canvas";
import CursorAgente, { type ControleCursor } from "@/components/CursorAgente";
import { apontarEAnotar } from "@/lib/presenca/coreografia";
import { atualizarRastro, criarMemoriaVisual, olharODesenho, mapearAcoesVisuais, type AcaoVisual } from "@/lib/presenca/acoesVisuais";

const Canvas = dynamic(() => import("@/components/Canvas"), { ssr: false });

const ALVOS = [
  { id: "elipse", nome: "Elipse" },
  { id: "retangulo", nome: "Retângulo" },
  { id: "losango", nome: "Losango" },
  { id: "seta", nome: "Seta" },
  { id: "texto", nome: "Texto solto" },
] as const;

const GESTOS = ["marcar", "apontar", "sublinhar", "circular", "enquadrar", "colchetes"] as const;

/** O desenho de exemplo, como um candidato faria. O runtime do Excalidraw só carrega no navegador. */
async function desenhoDeExemplo() {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const texto = (t: string) => ({ text: t, fontSize: 20 });
  return convertToExcalidrawElements([
    { type: "ellipse", id: "elipse", x: 120, y: 160, width: 220, height: 110, label: texto("Entrada dos dados") },
    { type: "rectangle", id: "retangulo", x: 520, y: 160, width: 200, height: 100, label: texto("Fila") },
    { type: "diamond", id: "losango", x: 140, y: 400, width: 190, height: 130, label: texto("Cache?") },
    { type: "arrow", id: "seta", x: 345, y: 215, width: 170, height: 0, points: [[0, 0], [170, 0]] },
    { type: "text", id: "texto", x: 540, y: 450, text: "Banco de dados", fontSize: 24 },
  ], { regenerateIds: false });
}

export default function VitrineDeGestos() {
  const [quadro, setQuadro] = useState<Quadro | null>(null);
  const cursor = useRef<ControleCursor | null>(null);
  const memoria = useRef(criarMemoriaVisual());
  const rodada = useRef(0);
  const [rastroDemo, setRastroDemo] = useState<Map<string, string>>(new Map());

  async function preparar(q: Quadro) {
    q.api.updateScene({ elements: await desenhoDeExemplo() });
    setQuadro(q);
  }

  function executar(visual: AcaoVisual[]) {
    if (!quadro) return;
    const numero = ++rodada.current;
    // Memória nova a cada clique: a vitrine mostra o gesto pedido, mesmo repetido.
    memoria.current = criarMemoriaVisual();
    void apontarEAnotar({
      quadro, cursor: cursor.current, grupo: `vitrine:${numero}`, alvos: [], nota: "", semente: numero * 7919,
      visual, memoria: memoria.current, conexoes: [["elipse", "retangulo"]],
    });
  }

  function demonstrarLimiteRastro() {
    let rastro = new Map<string, string>();
    for (let i = 1; i <= 9; i++) rastro = atualizarRastro(rastro, `peça ${i}`, `Pergunta ${i}`).rastro;
    const atualizado = atualizarRastro(rastro, "peça 9", "Nova pergunta peça 9");
    setRastroDemo(atualizado.rastro);
  }

  return (
    <main className="flex h-screen flex-col bg-white text-[#1e1e1e]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-black/10 px-4 py-3 text-[13px]">
        {ALVOS.map((alvo) => (
          <div key={alvo.id} className="flex items-center gap-1">
            <span className="mr-1 font-semibold">{alvo.nome}</span>
            {GESTOS.map((tipo) => (
              <button key={tipo} type="button" disabled={!quadro} onClick={() => executar([{ tipo, alvo: alvo.id }])}
                className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40">
                {tipo}
              </button>
            ))}
          </div>
        ))}
        <button type="button" disabled={!quadro} onClick={() => executar([{ tipo: "comparar", alvos: ["elipse", "retangulo"] }])}
          className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40">comparar elipse × retângulo</button>
        <button type="button" disabled={!quadro} onClick={() => executar([{ tipo: "comparar", alvos: ["losango", "retangulo"] }])}
          className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40">comparar peças soltas</button>
        <button type="button" disabled={!quadro} onClick={() => executar([{ tipo: "anotar", alvo: "losango", texto: "Leitura ou escrita?" }])}
          className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40">anotar no losango</button>
        <button type="button" disabled={!quadro} onClick={() => executar([{ tipo: "marcar", alvo: "elipse" }])}
          className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40">fala sobre uma peça: marcar</button>
        <button type="button" disabled={!quadro} onClick={() => executar([{ tipo: "percorrer", alvos: ["elipse", "seta", "retangulo"] }])}
          className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40">percorrer entrada → fila</button>
        <button type="button" disabled={!quadro} onClick={() => executar([{ tipo: "agrupar", alvos: ["elipse", "retangulo", "losango"] }])}
          className="btn btn-xs disabled:opacity-40">agrupar peças</button>
        <button type="button" disabled={!quadro} onClick={() => executar([{ tipo: "numerar", alvos: ["elipse", "retangulo"] }])}
          className="btn btn-xs disabled:opacity-40">numerar fluxo</button>
        <button type="button" disabled={!quadro} onClick={() => executar([{ tipo: "interrogar", alvo: "losango" }])}
          className="btn btn-xs disabled:opacity-40">interrogar</button>
        <button type="button" disabled={!quadro} onClick={() => executar(mapearAcoesVisuais(
          olharODesenho("COMPONENTES\n- [r1] Entrada (elipse)\n- [r2] Fila (retângulo)\nCONEXÕES\n- [s1] Entrada → Fila"),
          (id) => id === "r1" ? "elipse" : id === "r2" ? "retangulo" : null,
        ) ?? [])}
          className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40">olhando o desenho</button>
        <button type="button" disabled={!quadro} onClick={() => executar([{ tipo: "anotar", alvo: "elipse", texto: "Como escala essa peça?" }])}
          className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40">rastro: pergunta sobre escala</button>
        <button type="button" onClick={demonstrarLimiteRastro}
          className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5">rastro: substituir e limitar a 8</button>
        {rastroDemo.size > 0 && <span aria-live="polite" className="text-xs text-black/60">
          Demonstração: {rastroDemo.size}/8 notas; peça 9 = “{rastroDemo.get("peça 9")}” (substituída)
        </span>}
      </div>
      <div className="relative min-h-0 flex-1">
        <Canvas onPronto={(q) => void preparar(q)} />
      </div>
      <CursorAgente onPronto={(c) => { cursor.current = c; }} />
    </main>
  );
}
