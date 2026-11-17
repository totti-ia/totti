"use client";

// O palco do herói: a sala de system design como ela é (quadro do Excalidraw, legenda escura embaixo, pílula da
// chamada no canto), numa entrevista de ~15s em loop:
// a candidata desenha Cliente → API → Banco · o Totti seleciona e arredonda as caixas · circula o banco e anota em
// azul · pergunta por voz (legenda) · ela responde e desenha o cache · o Totti marca o check · o relatório chega.
// Tudo é desenhado num palco fixo de 760×500 e escalado para caber, então nada corta em tela nenhuma.
// É ilustração do produto (selo "exemplo"), não dado ao vivo. Com "reduzir movimento", mostra o quadro final parado.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Circle, Diamond, Eraser, Hand, Image as Imagem, Lock, Menu, Mic, Minus, MousePointer2, Pencil, PhoneOff, Plus, Redo2, Square, Type, Undo2 } from "lucide-react";

const L = 760;
const A = 500;
/** Um "tique" do roteiro = 44ms. A volta inteira tem VOLTA tiques (~15s). */
const TIQUE_MS = 44;
const VOLTA = 345;
const FINAL = 326;

const TINTA = "#1e1e1e";
const AZUL = "#1971c2";
const VERDE = "#2f9e44";
const SELECAO = "#6965db";
const FONTE_MAO = '"Excalifont Landing", "Comic Sans MS", cursive';

type P = [number, number];

const lim = (x: number) => Math.max(0, Math.min(1, x));
const faixa = (c: number, a: number, b: number) => lim((c - a) / (b - a));
const suave = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Tremor determinístico (o mesmo traço a cada volta), entre -1 e 1. */
const ruido = (i: number, s: number) => Math.sin(i * 12.9898 + s * 78.233) * 0.5 + Math.sin(i * 4.1 + s * 1.7) * 0.5;

type Caixa = { x: number; y: number; w: number; h: number; rotulo: string; desenha: [number, number]; arruma: [number, number]; s: number };
type Seta = { de: P; para: P; desenha: [number, number]; s: number };

const CAIXAS: Caixa[] = [
  { x: 56, y: 196, w: 140, h: 66, rotulo: "Cliente", desenha: [4, 20], arruma: [104, 116], s: 1 },
  { x: 290, y: 196, w: 140, h: 66, rotulo: "API", desenha: [28, 44], arruma: [104, 116], s: 2 },
  { x: 524, y: 196, w: 150, h: 66, rotulo: "Banco", desenha: [52, 70], arruma: [104, 116], s: 3 },
  { x: 384, y: 300, w: 176, h: 58, rotulo: "Cache (Redis)", desenha: [228, 246], arruma: [266, 276], s: 4 },
];
const SETAS: Seta[] = [
  { de: [200, 229], para: [284, 229], desenha: [20, 28], s: 5 },
  { de: [434, 229], para: [518, 229], desenha: [44, 52], s: 6 },
  { de: [392, 266], para: [440, 298], desenha: [246, 253], s: 7 },
  { de: [520, 298], para: [570, 266], desenha: [253, 260], s: 8 },
];

/** Retângulo no traço do Excalidraw: dois passes levemente diferentes, cantos com raio r (0 = canto vivo). */
function tracoCaixa(c: Caixa, r: number, passe: number): string {
  const j = (k: number) => ruido(k + passe * 31, c.s) * 1.4;
  const { x, y, w, h } = c;
  if (r < 0.5)
    return `M${x + j(1)},${y + j(2)} L${x + w + j(3)},${y + j(4)} L${x + w + j(5)},${y + h + j(6)} L${x + j(7)},${y + h + j(8)} L${x + j(9)},${y + j(10) + 1.5}`;
  return [
    `M${x + r + j(1)},${y + j(2)}`,
    `L${x + w - r + j(3)},${y + j(4)}`,
    `Q${x + w},${y} ${x + w + j(5)},${y + r + j(6)}`,
    `L${x + w + j(7)},${y + h - r + j(8)}`,
    `Q${x + w},${y + h} ${x + w - r + j(9)},${y + h + j(10)}`,
    `L${x + r + j(11)},${y + h + j(12)}`,
    `Q${x},${y + h} ${x + j(13)},${y + h - r + j(14)}`,
    `L${x + j(15)},${y + r + j(16)}`,
    `Q${x},${y} ${x + r + j(17)},${y + j(18) + 1}`,
  ].join(" ");
}

function tracoSeta(s: Seta, passe: number): string {
  const [x1, y1] = s.de;
  const [x2, y2] = s.para;
  const mx = (x1 + x2) / 2 + ruido(passe, s.s) * 2;
  const my = (y1 + y2) / 2 + ruido(passe + 9, s.s) * 2;
  return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
}

function pontaDaSeta(s: Seta): string {
  const [x1, y1] = s.de;
  const [x2, y2] = s.para;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p = (d: number) => `${(x2 - 12 * Math.cos(a + d)).toFixed(1)},${(y2 - 12 * Math.sin(a + d)).toFixed(1)}`;
  return `M${p(0.45)} L${x2},${y2} L${p(-0.45)}`;
}

/** Ponto no contorno da caixa, a uma fração t do caminho (onde está a mão da candidata enquanto desenha). */
function noContorno(c: Caixa, t: number): P {
  let d = t * 2 * (c.w + c.h);
  if (d < c.w) return [c.x + d, c.y];
  d -= c.w;
  if (d < c.h) return [c.x + c.w, c.y + d];
  d -= c.h;
  if (d < c.w) return [c.x + c.w - d, c.y + c.h];
  d -= c.w;
  return [c.x, c.y + c.h - d];
}

/** Interpola entre quadros-chave [tique, x, y] com curva suave. */
function trilha(chaves: [number, number, number][], c: number): P {
  if (c <= chaves[0][0]) return [chaves[0][1], chaves[0][2]];
  for (let i = 1; i < chaves.length; i++) {
    const [t1, x1, y1] = chaves[i];
    const [t0, x0, y0] = chaves[i - 1];
    if (c <= t1) {
      const k = suave((c - t0) / (t1 - t0 || 1));
      return [lerp(x0, x1, k), lerp(y0, y1, k)];
    }
  }
  const u = chaves[chaves.length - 1];
  return [u[1], u[2]];
}

const TRACOS_DA_CANDIDATA = [
  ...CAIXAS.map((k) => ({ de: k.desenha[0], ate: k.desenha[1], em: (t: number) => noContorno(k, t) })),
  ...SETAS.map((s) => ({ de: s.desenha[0], ate: s.desenha[1], em: (t: number): P => [lerp(s.de[0], s.para[0], t), lerp(s.de[1], s.para[1], t)] })),
].sort((a, b) => a.de - b.de);
const DESCANSO: P = [240, 380];

/** A mão da candidata: segue o traço enquanto desenha e descansa entre um traço e outro. */
function maoDaCandidata(c: number): P {
  let fim = 0;
  let ultimo: P = DESCANSO;
  for (const tr of TRACOS_DA_CANDIDATA) {
    if (c >= tr.de && c <= tr.ate) return tr.em((c - tr.de) / (tr.ate - tr.de));
    if (c < tr.de) {
      const intervaloLongo = tr.de - fim > 20;
      if (!intervaloLongo) return trilha([[fim, ...ultimo], [tr.de, ...tr.em(0)]], c);
      if (c < tr.de - 10) return trilha([[fim, ...ultimo], [fim + 10, ...DESCANSO]], c);
      return trilha([[tr.de - 10, ...DESCANSO], [tr.de, ...tr.em(0)]], c);
    }
    fim = tr.ate;
    ultimo = tr.em(1);
  }
  return trilha([[fim, ...ultimo], [fim + 10, ...DESCANSO]], c);
}

const CIRCULO = { cx: 599, cy: 229, rx: 104, ry: 56 };
function pontoDoCirculo(t: number): P {
  const a = -2.4 + t * (Math.PI * 2 + 0.5);
  const r = 1 + 0.05 * Math.sin(a * 3) + t * 0.05;
  return [CIRCULO.cx + Math.cos(a) * CIRCULO.rx * r, CIRCULO.cy + Math.sin(a) * CIRCULO.ry * r];
}
const CAMINHO_DO_CIRCULO = `M${Array.from({ length: 64 }, (_, i) => pontoDoCirculo(i / 63).map((v) => v.toFixed(1)).join(" ")).join(" L")}`;

const NOTA = "100 mil acessos/s?";
const NOTA_XY: P = [520, 150];

const PERGUNTA = "Se um link curto viralizar e for aberto cem mil vezes por segundo, o banco aguenta?";
const RESPOSTA = "Coloco um cache na frente, com os links mais acessados. O banco só recebe o que não está no cache.";

const CRITERIOS = [
  { nome: "Escalabilidade", nota: 3.5 },
  { nome: "Modelagem de dados", nota: 3 },
  { nome: "Comunicação", nota: 4 },
];

/** O cursor do Totti, por fase: entra, seleciona tudo, arredonda, circula o banco, escreve, confere o cache, sai. */
function maoDoTotti(c: number): P {
  if (c >= 118 && c <= 132) return pontoDoCirculo(faixa(c, 118, 132));
  if (c > 132 && c <= 146) return [NOTA_XY[0] + 150 * faixa(c, 132, 146), NOTA_XY[1] + 4];
  return trilha(
    [
      [0, 800, 120],
      [76, 800, 120],
      [84, 40, 176],
      [96, 690, 284],
      [104, 690, 284],
      [114, 610, 300],
      [118, ...pontoDoCirculo(0)],
      [146, NOTA_XY[0] + 150, NOTA_XY[1] + 4],
      [160, 650, 380],
      [262, 650, 380],
      [270, 566, 292],
      [278, 566, 292],
      [284, NOTA_XY[0] - 10, NOTA_XY[1] + 4],
      [296, 650, 400],
    ],
    c,
  );
}

/** Relógio contínuo em tiques (float), via requestAnimationFrame; pausa fora da tela ou com a aba escondida. */
function useRoteiro() {
  const raiz = useRef<HTMLDivElement>(null);
  const [c, setC] = useState(0);
  const [parado, setParado] = useState(false);
  const [escala, setEscala] = useState(0);
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const medir = new ResizeObserver(([e]) => setEscala(e.contentRect.width / L));
    medir.observe(el);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setParado(true);
      return () => medir.disconnect();
    }
    let visivel = true;
    let raf = 0;
    let acumulado = 0;
    let ultimo = performance.now();
    const passo = (agora: number) => {
      acumulado += Math.min(100, agora - ultimo);
      ultimo = agora;
      setC((acumulado / TIQUE_MS) % VOLTA);
      raf = requestAnimationFrame(passo);
    };
    const ligar = () => {
      cancelAnimationFrame(raf);
      if (!visivel || document.hidden) return;
      ultimo = performance.now();
      raf = requestAnimationFrame(passo);
    };
    const obs = new IntersectionObserver(([e]) => {
      visivel = e.isIntersecting;
      ligar();
    });
    obs.observe(el);
    document.addEventListener("visibilitychange", ligar);
    ligar();
    return () => {
      cancelAnimationFrame(raf);
      medir.disconnect();
      obs.disconnect();
      document.removeEventListener("visibilitychange", ligar);
    };
  }, []);
  return { raiz, c: parado ? FINAL : c, escala };
}

export default function QuadroAoVivo() {
  const { raiz, c, escala } = useRoteiro();
  const some = c > FINAL + 4 ? 1 - faixa(c, FINAL + 4, VOLTA - 2) : 1;

  const selecao = faixa(c, 84, 96); // o retângulo de seleção abrindo
  const selecionado = c >= 96 && c < 116;
  const selecionaCache = c >= 266 && c < 280;
  const circulo = faixa(c, 118, 132);
  const circuloSome = 1 - faixa(c, 270, 280);
  const nota = Math.floor(NOTA.length * faixa(c, 132, 146));
  const check = faixa(c, 280, 286);

  const legenda =
    c >= 150 && c < 198 ? { texto: PERGUNTA, ate: Math.floor(PERGUNTA.length * faixa(c, 150, 194)), totti: true }
    : c >= 200 && c < 262 ? { texto: RESPOSTA, ate: Math.floor(RESPOSTA.length * faixa(c, 200, 244)), totti: false }
    : null;
  const tottiFalando = c >= 150 && c < 194;

  const relatorio = suave(faixa(c, 290, 302));
  const barras = suave(faixa(c, 298, 318));
  const segundos = 12 * 60 + 7 + Math.floor(c / 22);
  const [tx, ty] = maoDoTotti(c);
  const [mx, my] = maoDaCandidata(c);

  return (
    <div ref={raiz} className="relative w-full" style={{ aspectRatio: `${L} / ${A}` }} aria-hidden>
      <div
        className="absolute top-0 left-0 overflow-hidden rounded-[22px] bg-white text-[#1c1812] shadow-[0_50px_90px_-40px_rgb(28_24_18/0.55),0_0_0_1px_rgb(28_24_18/0.08)]"
        style={{ width: L, height: A, transform: `scale(${escala})`, transformOrigin: "0 0", visibility: escala ? "visible" : "hidden" }}
      >
        <BarraDoExcalidraw />

        <svg width={L} height={A} viewBox={`0 0 ${L} ${A}`} className="absolute inset-0" style={{ opacity: some }}>
          {/* o enunciado que o Totti escreveu no começo da entrevista */}
          <text x={40} y={112} fontSize={30} fill={TINTA} style={{ fontFamily: FONTE_MAO }}>
            Encurtador de URL
          </text>
          <text x={40} y={142} fontSize={17} fill={TINTA} style={{ fontFamily: FONTE_MAO }}>
            Recebe uma URL longa e devolve uma curta.
          </text>

          {CAIXAS.map((k) => {
            const d = faixa(c, ...k.desenha);
            if (d <= 0) return null;
            const r = 14 * suave(faixa(c, ...k.arruma));
            const rotulo = Math.floor(k.rotulo.length * faixa(c, k.desenha[1] - 4, k.desenha[1] + 4));
            return (
              <g key={k.rotulo}>
                {[0, 1].map((passe) => (
                  <path
                    key={passe}
                    d={tracoCaixa(k, r, passe)}
                    pathLength={1}
                    strokeDasharray="1 1"
                    strokeDashoffset={1 - d}
                    fill="none"
                    stroke={TINTA}
                    strokeWidth={passe ? 1 : 1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={passe ? 0.7 : 1}
                  />
                ))}
                <text x={k.x + k.w / 2} y={k.y + k.h / 2 + 7} textAnchor="middle" fontSize={20} fill={TINTA} style={{ fontFamily: FONTE_MAO }}>
                  {k.rotulo.slice(0, rotulo)}
                </text>
              </g>
            );
          })}

          {SETAS.map((s) => {
            const d = faixa(c, ...s.desenha);
            if (d <= 0) return null;
            return (
              <g key={s.s} fill="none" stroke={TINTA} strokeLinecap="round" strokeLinejoin="round">
                {[0, 1].map((passe) => (
                  <path key={passe} d={tracoSeta(s, passe)} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - d} strokeWidth={passe ? 1 : 1.6} opacity={passe ? 0.7 : 1} />
                ))}
                {d >= 1 && <path d={pontaDaSeta(s)} strokeWidth={1.6} />}
              </g>
            );
          })}

          {/* seleção do Totti: o retângulo arrastado e as alças, como no Excalidraw */}
          {selecao > 0 && c < 98 && <rect x={40} y={176} width={650 * selecao} height={108 * selecao} fill="rgb(105 101 219 / 0.08)" stroke={SELECAO} strokeWidth={1} />}
          {selecionado && <Alcas x={46} y={186} w={638} h={86} />}
          {selecionaCache && <Alcas x={374} y={290} w={196} h={78} />}

          {/* anotações do Totti, em azul */}
          {circulo > 0 && (
            <path
              d={CAMINHO_DO_CIRCULO}
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - circulo}
              fill="none"
              stroke={AZUL}
              strokeWidth={2.2}
              strokeLinecap="round"
              opacity={circuloSome}
            />
          )}
          {nota > 0 && (
            <text x={NOTA_XY[0]} y={NOTA_XY[1]} fontSize={19} fill={AZUL} style={{ fontFamily: FONTE_MAO }}>
              {NOTA.slice(0, nota)}
            </text>
          )}
          {check > 0 && (
            <path
              d={`M${NOTA_XY[0] - 28},${NOTA_XY[1] - 8} l7,8 l13,-17`}
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - check}
              fill="none"
              stroke={VERDE}
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* a mão da candidata (o ponteiro dela) */}
          <g transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)})`}>
            <path d="M0 0 L0 15 L4 11.4 L6.8 17.4 L9.4 16.2 L6.7 10.4 L12 10.4 Z" fill="#fff" stroke={TINTA} strokeWidth={1.2} strokeLinejoin="round" />
            <rect x={13} y={14} width={72} height={20} rx={10} fill="#8a8277" />
            <text x={49} y={28} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="#fff" style={{ fontFamily: "var(--font-inter)" }}>
              Candidata
            </text>
          </g>

          {/* o cursor do Totti (o mesmo da sala: seta escura com o nome) */}
          <g transform={`translate(${tx.toFixed(1)} ${ty.toFixed(1)})`}>
            <path d="M2 2 L2 17.5 L6.4 13.4 L9.3 20 L12.2 18.7 L9.4 12.3 L15.5 12.3 Z" fill="#1c1812" stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
            <rect x={14} y={18} width={46} height={20} rx={10} fill="#1c1812" />
            <text x={37} y={32} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="#f5f0e8" style={{ fontFamily: "var(--font-inter)" }}>
              Totti
            </text>
          </g>
        </svg>

        {/* legenda ao vivo: o que já foi falado fica claro, o resto apagado */}
        <div className="absolute bottom-[66px] left-[130px] w-[500px]" style={{ opacity: some }}>
          {legenda && (
            <p className="flex items-center gap-3 rounded-[16px] bg-[rgb(28_24_18/0.88)] px-4 py-2.5 text-[13.5px] leading-[1.4] text-[#f5f0e8] shadow-[0_12px_30px_-12px_rgb(0_0_0/0.5)]">
              {legenda.totti ? <Barras ativo={tottiFalando} /> : <Mic size={14} className="shrink-0 text-[#f5f0e8]/70" />}
              <span>
                <span className="mr-1.5 font-semibold">{legenda.totti ? "Totti" : "Candidata"}</span>
                {legenda.texto.slice(0, legenda.ate)}
                <span className="text-[#f5f0e8]/35">{legenda.texto.slice(legenda.ate)}</span>
              </span>
            </p>
          )}
        </div>

        {/* a pílula da chamada, no canto */}
        <div className="absolute right-3.5 bottom-3.5 flex h-11 items-center gap-1.5 rounded-full bg-[rgb(28_24_18/0.88)] pr-1.5 pl-2 text-[13px] text-[#f5f0e8] shadow-[0_12px_30px_-12px_rgb(0_0_0/0.5)]">
          <Anel falando={tottiFalando} c={c} />
          <span className="px-1 font-mono tabular-nums">
            {String(Math.floor(segundos / 60)).padStart(2, "0")}:{String(segundos % 60).padStart(2, "0")}
          </span>
          <span className="rounded-full bg-[#f5f0e8]/12 px-2.5 py-1 text-[11.5px] font-medium">Interromper</span>
          <span className="flex size-8 items-center justify-center rounded-full bg-[#f5f0e8]/12">
            <Mic size={14} />
          </span>
          <span className="flex size-8 items-center justify-center rounded-full bg-[#f5f0e8]/12">
            <PhoneOff size={14} />
          </span>
        </div>

        {/* o relatório, que a recrutadora recebe no fim */}
        <div
          className="absolute top-[70px] right-3.5 w-[262px] rounded-[18px] bg-[#f5f2ec] p-4 shadow-[0_24px_50px_-20px_rgb(28_24_18/0.45),0_0_0_1px_rgb(28_24_18/0.08)]"
          style={{ opacity: relatorio * some, transform: `translateX(${(1 - relatorio) * 24}px)` }}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold">Relatório</span>
            <span className="font-mono text-[11px] text-[#6b675f]">Backend Pleno</span>
          </div>
          <ul className="mt-3 flex flex-col gap-2.5">
            {CRITERIOS.map((k) => (
              <li key={k.nome} className="flex flex-col gap-1">
                <span className="flex justify-between text-[12.5px]">
                  <span className="text-[#5c5448]">{k.nome}</span>
                  <span className="font-mono">{(k.nota * barras).toFixed(1).replace(".", ",")}</span>
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-[#1c1812]/10">
                  <span className="block h-full rounded-full bg-[#1c1812]" style={{ width: `${(k.nota / 4) * 100 * barras}%` }} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-[#1c1812]/10 pt-2.5 text-[12px] leading-[1.45] text-[#5c5448]">
            “Coloco um cache na frente…” <span className="font-mono text-[11px]">min 12:31</span>
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-[#6b675f]">3 evidências · recomenda seguir</p>
        </div>
      </div>
    </div>
  );
}

const FERRAMENTAS = [Lock, Hand, MousePointer2, Square, Diamond, Circle, ArrowRight, Minus, Pencil, Type, Imagem, Eraser];

/** A barra de ferramentas e os controles do Excalidraw, como aparecem na sala. */
function BarraDoExcalidraw() {
  return (
    <>
      <span className="absolute top-3.5 left-3.5 flex size-9 items-center justify-center rounded-[10px] bg-[#ececf4] text-[#1b1b1f]">
        <Menu size={16} />
      </span>
      <div className="absolute top-3 left-1/2 flex h-11 -translate-x-1/2 items-center gap-0.5 rounded-[12px] bg-white px-1.5 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_4px_14px_-4px_rgb(0_0_0/0.12)]">
        {FERRAMENTAS.map((Icone, i) => (
          <span key={i} className={`flex size-8 items-center justify-center rounded-[8px] text-[#1b1b1f] ${i === 2 ? "bg-[#e0dfff]" : ""}`}>
            <Icone size={15} strokeWidth={1.75} />
          </span>
        ))}
      </div>
      <span className="absolute top-3.5 right-3.5 flex h-9 items-center gap-1.5 rounded-[10px] bg-[#ececf4] px-3 text-[12.5px] text-[#1b1b1f]">
        <BookOpen size={14} /> exemplo
      </span>
      <div className="absolute bottom-[58px] left-3.5 flex h-9 items-center gap-2.5 rounded-[10px] bg-[#ececf4] px-2.5 text-[#1b1b1f]/50">
        <Undo2 size={14} />
        <Redo2 size={14} />
      </div>
      <div className="absolute bottom-3.5 left-3.5 flex h-9 items-center gap-1 rounded-[10px] bg-[#ececf4] px-1.5 text-[12px] text-[#1b1b1f]">
        <Minus size={13} className="mx-1" />
        <span>100%</span>
        <Plus size={13} className="mx-1" />
      </div>
    </>
  );
}

/** As alças de seleção do Excalidraw em volta do que foi selecionado. */
function Alcas({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const cantos: P[] = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
    [x + w / 2, y],
    [x + w / 2, y + h],
    [x, y + h / 2],
    [x + w, y + h / 2],
  ];
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={SELECAO} strokeWidth={1} />
      {cantos.map(([cx, cy], i) => (
        <rect key={i} x={cx - 4} y={cy - 4} width={8} height={8} rx={2} fill="#fff" stroke={SELECAO} strokeWidth={1} />
      ))}
      <circle cx={x + w / 2} cy={y - 16} r={4} fill="#fff" stroke={SELECAO} strokeWidth={1} />
    </g>
  );
}

function Barras({ ativo }: { ativo: boolean }) {
  return (
    <span className="flex h-4 shrink-0 items-center gap-[3px]">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="h-full w-[3px] rounded-full bg-[#f5f0e8]"
          style={{ transform: "scaleY(0.3)", animation: ativo ? `barra .9s ease-in-out ${i * 0.12}s infinite` : undefined }}
        />
      ))}
    </span>
  );
}

/** O anel do Totti na pílula: um arco claro gira (mais longo quando ele fala). */
function Anel({ falando, c }: { falando: boolean; c: number }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0">
      <circle cx="14" cy="14" r="9" fill="none" stroke="#f5f0e8" strokeOpacity={0.35} strokeWidth={2} />
      <circle
        cx="14"
        cy="14"
        r="9"
        fill="none"
        stroke="#f5f0e8"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeDasharray={falando ? "14 43" : "6 51"}
        transform={`rotate(${(c * 9) % 360} 14 14)`}
      />
    </svg>
  );
}
