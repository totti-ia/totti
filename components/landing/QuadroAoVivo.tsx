"use client";

// O palco do herói: uma entrevista de system design em ~14s, em loop.
// A candidata rabisca a arquitetura → o Totti arruma o desenho (o traço tremido vira caixa arredondada) →
// circula o banco e anota → pergunta por voz → ela responde e desenha a réplica → o relatório sai com a nota.
// É ilustração do produto (selo "exemplo"), não dado ao vivo. Com "reduzir movimento", mostra o quadro final parado.
import { useEffect, useRef, useState } from "react";
import { BarrasDeVoz } from "@/components/totti/Perola";

/** Um "tique" do roteiro = 44ms (a volta dá ~14,5s). A volta inteira tem VOLTA tiques. */
const VOLTA = 330;
const TIQUE_MS = 44;

type Ponto = [number, number];

const lim = (x: number) => Math.max(0, Math.min(1, x));
const faixa = (c: number, [a, b]: readonly [number, number]) => lim((c - a) / (b - a));
const suave = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Tremor de traço feito à mão: duas senoides por forma, determinístico (o mesmo desenho a cada volta). */
const tremor = (i: number, semente: number) => Math.sin(i * 0.55 + semente) * 0.6 + Math.sin(i * 1.7 + semente * 2.3) * 0.4;

/** N pontos no contorno de um retângulo de cantos com raio r, começando no canto de cima à esquerda. */
function contorno(x: number, y: number, w: number, h: number, r: number, n: number): Ponto[] {
  const arco = (Math.PI * r) / 2;
  const segs: { len: number; at: (t: number) => Ponto }[] = [
    { len: w - 2 * r, at: (t) => [x + r + t * (w - 2 * r), y] },
    { len: arco, at: (t) => [x + w - r + r * Math.sin((t * Math.PI) / 2), y + r - r * Math.cos((t * Math.PI) / 2)] },
    { len: h - 2 * r, at: (t) => [x + w, y + r + t * (h - 2 * r)] },
    { len: arco, at: (t) => [x + w - r + r * Math.cos((t * Math.PI) / 2), y + h - r + r * Math.sin((t * Math.PI) / 2)] },
    { len: w - 2 * r, at: (t) => [x + w - r - t * (w - 2 * r), y + h] },
    { len: arco, at: (t) => [x + r - r * Math.sin((t * Math.PI) / 2), y + h - r + r * Math.cos((t * Math.PI) / 2)] },
    { len: h - 2 * r, at: (t) => [x, y + h - r - t * (h - 2 * r)] },
    { len: arco, at: (t) => [x + r - r * Math.cos((t * Math.PI) / 2), y + r - r * Math.sin((t * Math.PI) / 2)] },
  ];
  const total = segs.reduce((s, g) => s + g.len, 0);
  const pts: Ponto[] = [];
  for (let k = 0; k < n; k++) {
    let d = (k / n) * total;
    for (const g of segs) {
      if (d <= g.len || g === segs[segs.length - 1]) {
        pts.push(g.at(g.len ? Math.min(1, d / g.len) : 0));
        break;
      }
      d -= g.len;
    }
  }
  return pts;
}

type Forma =
  | { tipo: "caixa"; x: number; y: number; w: number; h: number; rotulo: string; desenha: [number, number]; arruma: [number, number]; semente: number }
  | { tipo: "seta"; de: Ponto; para: Ponto; desenha: [number, number]; arruma: [number, number]; semente: number };

const FORMAS: Forma[] = [
  { tipo: "caixa", x: 20, y: 62, w: 108, h: 54, rotulo: "Cliente", desenha: [3, 20], arruma: [104, 118], semente: 1 },
  { tipo: "seta", de: [128, 89], para: [186, 89], desenha: [20, 28], arruma: [108, 122], semente: 2 },
  { tipo: "caixa", x: 186, y: 62, w: 108, h: 54, rotulo: "API", desenha: [28, 45], arruma: [110, 124], semente: 3 },
  { tipo: "seta", de: [294, 89], para: [352, 89], desenha: [45, 53], arruma: [113, 127], semente: 4 },
  { tipo: "caixa", x: 352, y: 62, w: 128, h: 54, rotulo: "Banco", desenha: [53, 70], arruma: [116, 130], semente: 5 },
  { tipo: "seta", de: [240, 116], para: [240, 182], desenha: [70, 78], arruma: [119, 133], semente: 6 },
  { tipo: "caixa", x: 186, y: 182, w: 108, h: 54, rotulo: "Fila", desenha: [78, 95], arruma: [122, 136], semente: 7 },
  // depois da pergunta: a candidata desenha a réplica e o Totti arruma de novo
  { tipo: "seta", de: [416, 116], para: [416, 182], desenha: [244, 252], arruma: [262, 274], semente: 8 },
  { tipo: "caixa", x: 352, y: 182, w: 128, h: 54, rotulo: "Réplica", desenha: [252, 268], arruma: [266, 280], semente: 9 },
];

/** Os pontos da forma no instante: tremidos (traço da candidata) → limpos (depois que o Totti arruma). */
function pontosDaForma(f: Forma, arrumado: number): Ponto[] {
  const amp = 3.2 * (1 - arrumado);
  if (f.tipo === "caixa") {
    const base = contorno(f.x, f.y, f.w, f.h, lerp(2, 12, arrumado), 56);
    return base.map(([x, y], i) => [x + tremor(i, f.semente) * amp, y + tremor(i + 40, f.semente) * amp]);
  }
  const [x1, y1] = f.de;
  const [x2, y2] = f.para;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  return Array.from({ length: 14 }, (_, i) => {
    const t = i / 13;
    const curva = Math.sin(t * Math.PI) * 4 * (1 - arrumado);
    const off = curva + tremor(i, f.semente) * amp * 0.6;
    return [lerp(x1, x2, t) + nx * off, lerp(y1, y2, t) + ny * off] as Ponto;
  });
}

const caminho = (p: Ponto[], fechado: boolean) => `M${p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}${fechado ? "Z" : ""}`;

/** Ponto a uma fração do comprimento da polilinha (onde a caneta da candidata está). */
function pontoEm(p: Ponto[], t: number, fechado: boolean): Ponto {
  const pts = fechado ? [...p, p[0]] : p;
  const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
  let d = t * lens.reduce((s, l) => s + l, 0);
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]) {
      const k = lens[i] ? d / lens[i] : 0;
      return [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)];
    }
    d -= lens[i];
  }
  return pts[pts.length - 1];
}

const PERGUNTA = "Se o banco cair, o que acontece com os pedidos que já estão na fila?";
const RESPOSTA = "Ponho uma réplica, e o worker reprocessa da fila quando ela assumir.";
const NOTA = "ponto único de falha?";

const CRITERIOS = [
  { nome: "Arquitetura", nota: 3.5 },
  { nome: "Tolerância a falhas", nota: 3 },
  { nome: "Comunicação", nota: 4 },
];

/** Relógio contínuo em tiques (float), via requestAnimationFrame; pausa fora da tela ou com a aba escondida. */
function useRoteiro() {
  const raiz = useRef<HTMLDivElement>(null);
  const [c, setC] = useState(0);
  const [parado, setParado] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setParado(true);
      return;
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
    if (raiz.current) obs.observe(raiz.current);
    document.addEventListener("visibilitychange", ligar);
    ligar();
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      document.removeEventListener("visibilitychange", ligar);
    };
  }, []);
  return { raiz, c: parado ? 318 : c };
}

export default function QuadroAoVivo() {
  const { raiz, c } = useRoteiro();

  // no fim da volta tudo some junto e recomeça do quadro vazio
  const opacidadeGeral = c > 318 ? 1 - (c - 318) / 12 : 1;

  // caneta da candidata: segue o traço que está sendo desenhado
  let caneta: Ponto | null = null;
  const desenhos = FORMAS.map((f) => {
    const d = faixa(c, f.desenha);
    const a = suave(faixa(c, f.arruma));
    const pts = pontosDaForma(f, a);
    const fechado = f.tipo === "caixa";
    if (d > 0) caneta = pontoEm(pts, d, fechado);
    return { f, d, a, pts, fechado };
  });
  const canetaVisivel = (c > 1 && c < 99) || (c > 241 && c < 271);
  const [cx, cy]: Ponto = caneta ?? [60, 60];

  // cursor do Totti: viaja entre alvos (com transição); quem decide o alvo é a fase do roteiro
  const alvoTotti: Ponto =
    c < 100 ? [500, 14] : c < 138 ? ([[84, 70], [240, 70], [420, 70], [240, 192]][Math.min(3, Math.floor((c - 100) / 9))] as Ponto)
    : c < 150 ? [496, 92] : c < 172 ? [352 + Math.min(1, (c - 150) / 18) * 130, 30] : c < 262 ? [500, 14] : c < 284 ? [420, 194] : [500, 14];

  const circulo = faixa(c, [140, 152]);
  const circuloSome = 1 - faixa(c, [282, 292]);
  const nota = Math.floor(NOTA.length * faixa(c, [150, 168]));

  const pq = Math.floor(PERGUNTA.length * faixa(c, [172, 206]));
  const pr = Math.floor(RESPOSTA.length * faixa(c, [210, 242]));
  const totFala = pq > 0 && pq < PERGUNTA.length;
  const sistema = c >= 100 && c < 150 ? "› Totti organizou o desenho" : c >= 150 && c < 172 ? "› Totti anotou no quadro" : null;

  const relatorio = faixa(c, [288, 300]);
  const barras = suave(faixa(c, [294, 312]));

  return (
    <div ref={raiz} className="relative" aria-hidden>
      <div className="overflow-hidden rounded-[28px] bg-[#13110e] text-[#f5f0e8] shadow-[0_50px_90px_-40px_rgb(28_24_18/0.7)]">
        <div className="flex items-center justify-between border-b border-[#f5f0e8]/8 px-[18px] py-3.5">
          <span className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-2.5 rounded-full bg-[#27231d]" />
            ))}
          </span>
          <span className="font-mono text-[12.5px] text-[#f5f0e8]/70">quadro · System Design</span>
          <span className="font-mono text-[12.5px] text-[#f5f0e8]/50">exemplo</span>
        </div>

        <div style={{ opacity: opacidadeGeral }}>
          <svg viewBox="0 0 500 250" className="block w-full px-3 pt-3">
            {/* pontilhado do quadro */}
            <defs>
              <pattern id="quadro-pontos" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#f5f0e8" opacity="0.07" />
              </pattern>
            </defs>
            <rect width="500" height="250" fill="url(#quadro-pontos)" />

            {desenhos.map(({ f, d, a, pts, fechado }, i) => {
              if (d <= 0) return null;
              const cor = a > 0.5 ? "#f5f0e8" : "#c9c2b6";
              return (
                <g key={i}>
                  <path
                    d={caminho(pts, fechado)}
                    pathLength={1}
                    strokeDasharray="1 1"
                    strokeDashoffset={1 - d}
                    fill={fechado ? `rgb(245 240 232 / ${0.05 * a})` : "none"}
                    stroke={cor}
                    strokeWidth={lerp(2.2, 1.6, a)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {f.tipo === "seta" && d >= 1 && <PontaDeSeta de={pts[pts.length - 2]} para={pts[pts.length - 1]} cor={cor} />}
                  {f.tipo === "caixa" && (
                    <text
                      x={f.x + f.w / 2}
                      y={f.y + f.h / 2 + 5}
                      textAnchor="middle"
                      fontSize="15"
                      fill={cor}
                      opacity={lim((d - 0.75) * 4)}
                      fontStyle={a > 0.5 ? "normal" : "italic"}
                      fontWeight={a > 0.5 ? 600 : 400}
                      style={{ fontFamily: a > 0.5 ? "var(--font-jetbrains)" : "var(--font-inter)" }}
                    >
                      {f.rotulo}
                    </text>
                  )}
                </g>
              );
            })}

            {/* a anotação do Totti: circula o banco e escreve a dúvida */}
            {circulo > 0 && (
              <g opacity={circuloSome}>
                <ellipse
                  cx={416}
                  cy={89}
                  rx={84}
                  ry={44}
                  pathLength={1}
                  strokeDasharray={`${circulo} 1`}
                  fill="none"
                  stroke="#f5f0e8"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  transform="rotate(-4 416 89)"
                />
                <text x={352} y={30} fontSize="13" fill="#f5f0e8" style={{ fontFamily: "var(--font-jetbrains)" }}>
                  {NOTA.slice(0, nota)}
                </text>
              </g>
            )}

            {/* caneta da candidata */}
            <g
              style={{ transform: `translate(${cx}px, ${cy}px)`, opacity: canetaVisivel ? 1 : 0, transition: "opacity .3s" }}
            >
              <circle r="3.5" fill="#c9c2b6" />
              <rect x={cx > 410 ? -78 : 8} y="6" width="70" height="20" rx="10" fill="#3a352d" />
              <text x={cx > 410 ? -43 : 43} y="20" textAnchor="middle" fontSize="11.5" fill="#f5f0e8" fontWeight="600" style={{ fontFamily: "var(--font-inter)" }}>
                Candidata
              </text>
            </g>

            {/* cursor do Totti */}
            <g style={{ transform: `translate(${alvoTotti[0]}px, ${alvoTotti[1]}px)`, transition: "transform .55s cubic-bezier(0.65, 0, 0.35, 1)" }}>
              <path d="M0 0 L13 6.5 L6.5 8.2 L4 14.5 Z" fill="#f5f0e8" stroke="#13110e" strokeWidth="1.3" strokeLinejoin="round" />
              <rect x="10" y="12" width="44" height="20" rx="10" fill="#f5f0e8" />
              <text x="32" y="26" textAnchor="middle" fontSize="11.5" fill="#1c1812" fontWeight="700" style={{ fontFamily: "var(--font-inter)" }}>
                Totti
              </text>
            </g>
          </svg>

          <div className="flex min-h-[112px] flex-col justify-end gap-2.5 border-t border-[#f5f0e8]/8 px-[18px] pt-3.5 pb-5">
            {sistema && <span className="font-mono text-[12.5px] text-[#f5f0e8]/60">{sistema}</span>}
            {pq > 0 && (
              <div className="flex items-start gap-2.5">
                <BarrasDeVoz ativo={totFala} n={3} altura={16} largura={3} className="mt-[3px] shrink-0 !gap-0.5 text-[#f5f0e8]" />
                <span className="text-[15px] leading-[1.45]">
                  <b>Totti</b> {PERGUNTA.slice(0, pq)}
                </span>
              </div>
            )}
            {pr > 0 && (
              <div className="flex items-start gap-2.5">
                <span className="mt-[7px] size-2 shrink-0 rounded-full bg-[#c9c2b6]" />
                <span className="text-[15px] leading-[1.45] text-[#d9d1c4]">
                  <b className="text-[#f5f0e8]">Candidata</b> {RESPOSTA.slice(0, pr)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* o relatório chega no fim */}
      <div
        className="absolute right-2 -bottom-10 w-[272px] rounded-[20px] bg-superficie p-[18px] text-texto shadow-[0_24px_50px_-20px_rgb(28_24_18/0.45)] sm:-right-5"
        style={{
          opacity: relatorio * opacidadeGeral,
          transform: `translateY(${(1 - suave(relatorio)) * 16}px) scale(${0.97 + 0.03 * suave(relatorio)})`,
        }}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold">Relatório</span>
          <span className="font-mono text-[11.5px] text-texto-suave">Backend Pleno</span>
        </div>
        <ul className="mt-3 flex flex-col gap-2.5">
          {CRITERIOS.map((k) => (
            <li key={k.nome} className="flex flex-col gap-1">
              <span className="flex justify-between text-[12.5px]">
                <span className="text-texto-suave">{k.nome}</span>
                <span className="font-mono">{(k.nota * barras).toFixed(1).replace(".", ",")}</span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-texto/10">
                <span className="block h-full rounded-full bg-texto" style={{ width: `${(k.nota / 4) * 100 * barras}%` }} />
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-borda pt-2.5 font-mono text-[11.5px] text-texto-suave">3 evidências · min 18:20 · recomenda seguir</p>
      </div>
    </div>
  );
}

function PontaDeSeta({ de, para, cor }: { de: Ponto; para: Ponto; cor: string }) {
  const ang = Math.atan2(para[1] - de[1], para[0] - de[0]);
  const p = (da: number): string => `${(para[0] - 8 * Math.cos(ang + da)).toFixed(1)},${(para[1] - 8 * Math.sin(ang + da)).toFixed(1)}`;
  return <path d={`M${p(0.5)}L${para[0]},${para[1]}L${p(-0.5)}`} fill="none" stroke={cor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />;
}
