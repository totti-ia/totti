// A mão executa uma composição escolhida pelo modelo, em sincronia com a fala.
// Sem plano, os gestos de apoio variam com o histórico. [] significa não desenhar.
// Tudo pertence a um grupo temporário; nenhuma ação altera o desenho do candidato.
import type { Quadro } from "@/components/Canvas";
import type { ControleCursor } from "@/components/CursorAgente";
import { alvosDaAcao, garantirCoberturaVisual, escolherAcoesVisuais, criarMemoriaVisual, type AcaoVisual, type MemoriaVisual } from "./acoesVisuais";
import { comporGestos, formaDoElemento } from "./gestos";
import {
  caixaDosElementos,
  cenaParaTela,
  estaVisivel,
  parteDoTraco,
  planejarMovimento,
  scrollParaCentralizar,
  precisaReduzirZoom,
  suavizar,
  type Caixa,
  type Ponto,
  type Traco,
  type Vista,
} from "@/lib/presenca";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const proximoQuadro = () => new Promise<number>((r) => requestAnimationFrame(r));

class Cancelada extends Error {}

/** Roda `passo(progresso)` de 0 a 1 ao longo de `duracaoMs`, a cada quadro. Para se o sinal for abortado. */
async function animar(duracaoMs: number, passo: (progresso: number) => void, sinal?: AbortSignal) {
  const inicio = performance.now();
  for (;;) {
    if (sinal?.aborted) throw new Cancelada();
    const p = Math.min(1, (performance.now() - inicio) / duracaoMs);
    passo(p);
    if (p >= 1) return;
    await proximoQuadro();
  }
}

function vistaDe(quadro: Quadro): Vista {
  const s = quadro.api.getAppState();
  return {
    scrollX: s.scrollX,
    scrollY: s.scrollY,
    zoom: s.zoom.value,
    offsetLeft: s.offsetLeft,
    offsetTop: s.offsetTop,
    largura: s.width,
    altura: s.height,
  };
}

/** A parte da cena que está à vista. */
function areaVisivel(v: Vista): Caixa {
  return { x: -v.scrollX, y: -v.scrollY, largura: v.largura / v.zoom, altura: v.altura / v.zoom };
}

function pontaDoTraco(t: Traco): Ponto {
  const ultimo = t.pontos[t.pontos.length - 1] ?? [0, 0];
  return { x: t.origem.x + ultimo[0], y: t.origem.y + ultimo[1] };
}

export type OpcoesApontar = {
  quadro: Quadro;
  cursor: ControleCursor | null;
  grupo: string;
  /** IDs reais dos elementos a circular. Vazio: a nota vai ao lado do desenho, sem círculo. */
  alvos: string[];
  nota: string;
  semente: number;
  /** Abortar para a coreografia no meio (o cursor some; o que já foi desenhado fica para quem chamou apagar). */
  sinal?: AbortSignal;
  /** Resolvido quando termina a resposta do candidato; o destaque fica até lá (no máximo 45 s). */
  sinalPodeApagar?: AbortSignal;
  /** Resolve no fim da fala do Totti; o teto de 45 s começa nesse instante. */
  fimDaFala?: Promise<void>;
  /** Texto da fala/pergunta, usado como nota curta quando `nota` não foi fornecida. */
  fala?: string;
  /** Para gesto sem pergunta: apaga 9 s após a coreografia. */
  semPergunta?: boolean;
  visual?: AcaoVisual[];
  conexoes?: readonly (readonly [string, string])[];
  memoria?: MemoriaVisual;
};

// A mão do agente faz uma coisa por vez: as ações entram numa fila.
let fila: Promise<unknown> = Promise.resolve();
function enfileirar<T>(acao: () => Promise<T>): Promise<T> {
  const vez = fila.then(acao, acao);
  fila = vez.catch(() => undefined);
  return vez;
}

export function apontarEAnotar(o: OpcoesApontar) {
  return enfileirar(async () => {
    if (o.sinal?.aborted) return;
    try {
      await coreografar(o);
    } catch (erro) {
      if (!(erro instanceof Cancelada)) throw erro;
    } finally {
      o.cursor?.esconder();
    }
  });
}

/** Cor do texto escrito "a lápis" (enunciado e requisitos) e do check. */
const COR_TEXTO = "#1e1e1e";
const COR_CHECK = "#2f9e44";

export type OpcoesRequisito = {
  quadro: Quadro;
  cursor: ControleCursor | null;
  texto: string;
  /** Posição do item na lista (0 = primeiro, que também escreve o título). */
  indice: number;
  /** Leva a vista até o item antes de escrever (a mudança no problema: ele precisa ver o que mudou). */
  focar?: boolean;
};

/** Espaço que a lista de requisitos reserva: título e alguns itens. */
const LARGURA_DOS_REQUISITOS = 560;
const ALTURA_DE_UM_REQUISITO = 30;

function seCruzam(a: Caixa, b: Caixa): boolean {
  return a.x < b.x + b.largura && b.x < a.x + a.largura && a.y < b.y + b.altura && b.y < a.y + a.altura;
}

/**
 * Onde a linha de um requisito pode ser escrita sem cair em cima do desenho do candidato: no lugar de sempre
 * (abaixo do enunciado) se estiver livre; senão, na mesma altura, à direita de tudo o que ele desenhou ali.
 * Numa entrevista real a mudança no problema foi escrita por cima do desenho.
 */
export function lugarLivreParaALinha(linha: Caixa, doCandidato: readonly Caixa[]): Caixa {
  const noCaminho = doCandidato.filter((c) => seCruzam(linha, c));
  if (!noCaminho.length) return linha;
  // Tudo o que está na faixa horizontal da linha, mesmo mais à direita: a linha vai depois da última peça.
  const naFaixa = doCandidato.filter((c) => c.y < linha.y + linha.altura && linha.y < c.y + c.altura);
  const direita = Math.max(...naFaixa.map((c) => c.x + c.largura));
  return { ...linha, x: direita + 48 };
}

/**
 * Escreve um requisito combinado no quadro, abaixo do enunciado, e desenha um check ao lado.
 * Não move a tela do candidato: se a área estiver fora de vista, escreve sem o cursor.
 */
export function anotarRequisito(o: OpcoesRequisito) {
  return enfileirar(async () => {
    const { quadro, cursor, indice } = o;
    const grupo = "requisitos";
    const enunciado = quadro.api.getSceneElements().find((e) => e.id === "agente-enunciado-texto");
    let x = enunciado?.x ?? 40;
    const topo = enunciado ? enunciado.y + enunciado.height + 34 : 260;
    const linha = topo + 34 + indice * 30;
    let textoX = x + 30;

    // A linha desvia do desenho do candidato (o título e os itens anteriores ficam onde estão).
    const doCandidato = quadro.api.getSceneElements()
      .filter((e) => !e.isDeleted && e.customData?.autor !== "agente")
      .flatMap((e) => caixaDosElementos([e], 8) ?? []);
    const livre = lugarLivreParaALinha({ x, y: indice === 0 ? topo : linha, largura: LARGURA_DOS_REQUISITOS,
      altura: (indice === 0 ? linha - topo : 0) + ALTURA_DE_UM_REQUISITO }, doCandidato);
    const desvio = livre.x - x;
    x += desvio;
    textoX += desvio;

    const naTela = (p: Ponto) => cenaParaTela(p, vistaDe(quadro));
    const area = { x, y: topo, largura: 320, altura: linha - topo + 30 };
    if (o.focar && !estaVisivel(area, vistaDe(quadro), 60)) {
      const inicial = vistaDe(quadro);
      const para = scrollParaCentralizar({ x, y: linha - 60, largura: LARGURA_DOS_REQUISITOS, altura: 120 }, inicial);
      await quadro.agente.esperarCandidatoLivre();
      await animar(420, (p) => {
        const k = suavizar(p);
        quadro.agente.rolar(inicial.scrollX + (para.scrollX - inicial.scrollX) * k, inicial.scrollY + (para.scrollY - inicial.scrollY) * k);
      });
    }
    const visivel = estaVisivel(area, vistaDe(quadro), 0);
    const mover = async (para: Ponto, semente: number) => {
      if (!cursor || !visivel) return;
      const de = cursor.posicao() ?? { x: innerWidth - 180, y: innerHeight - 160 };
      const movimento = planejarMovimento(de, naTela(para), semente);
      await animar(movimento.duracaoMs, (p) => cursor.mover(movimento.pontoEm(p)));
    };

    try {
      await quadro.agente.esperarCandidatoLivre();
      if (visivel) cursor?.mostrar();

      if (indice === 0) {
        await mover({ x, y: topo + 20 }, 11);
        await quadro.agente.escrever({
          id: "agente-requisitos-titulo",
          grupo,
          texto: "Requisitos combinados",
          x,
          y: topo,
          tamanho: 18,
          cor: "#868e96",
          velocidade: 40,
        });
      }

      // O item, escrito à mão.
      await mover({ x: textoX, y: linha + 20 }, 23 + indice);
      await quadro.agente.escrever({
        id: `agente-requisito-${indice}`,
        grupo,
        texto: o.texto,
        x: textoX,
        y: linha,
        tamanho: 18,
        largura: 60,
        cor: COR_TEXTO,
        velocidade: 45,
      });

      // O check, desenhado de uma vez só, como um traço de caneta.
      const check: Traco = { origem: { x: x + 2, y: linha + 10 }, pontos: [[0, 0], [6, 7], [18, -6]] };
      await mover({ x: x + 2, y: linha + 10 }, 31 + indice);
      await esperar(80);
      await animar(260, (p) => {
        const parte = parteDoTraco(check, suavizar(p));
        quadro.agente.tracar({
          id: `agente-requisito-${indice}-check`,
          grupo,
          origem: parte.origem,
          pontos: parte.pontos,
          espessura: 2.5,
          semente: 101 + indice,
          cor: COR_CHECK,
        });
        if (visivel) cursor?.mover(naTela(pontaDoTraco(parte)));
      });
      await esperar(300);
    } finally {
      cursor?.esconder();
    }
  });
}


/**
 * A parte da vista onde dá para escrever: sem a barra de ferramentas (em cima), os controles (embaixo)
 * e a janela de chamada (no canto em que ela estiver).
 */
function areaLivre(v: Vista): Caixa {
  const area = areaVisivel(v);
  const topo = 84 / v.zoom;
  const base = 72 / v.zoom;
  let { x, largura } = area;
  const janela = document.querySelector("[data-janela-chamada]")?.getBoundingClientRect();
  if (janela && janela.width > 0) {
    if (janela.left + janela.width / 2 > v.largura / 2) {
      largura -= (v.largura - janela.left + 16) / v.zoom;
    } else {
      x += (janela.right + 16) / v.zoom;
      largura -= (janela.right + 16) / v.zoom;
    }
  }
  return { x, y: area.y + topo, largura: Math.max(120, largura), altura: Math.max(80, area.altura - topo - base) };
}

/**
 * Destaques (contorno, apontar, realce) são marca de quem comenta: mais finos e translúcidos que o desenho do
 * candidato, e somem sozinhos depois de DESTAQUE_DURA_MS. Ficam num subgrupo (`<grupo>:destaque`), que também sai
 * quando o grupo da pergunta é apagado. Notas e letras do comparar ficam até lá.
 */
export const DESTAQUE_DURA_MS = 9_000;
export const DESTAQUE_TETO_MS = 45_000;

/** Acrescenta rastro sem ultrapassar o teto de cinco ações da fala. */
export function incluirAnotacoesComLimite(acoesOriginais: AcaoVisual[], alvos: readonly string[], texto: string): AcaoVisual[] {
  const acoes = [...acoesOriginais];
  for (const [indice, alvo] of alvos.entries()) {
    if (acoes.some((a) => a.tipo === "anotar" && (a.alvo ?? alvo) === alvo) || acoes.some((a) => a.tipo === "interrogar" && a.alvo === alvo)) continue;
    const anotacao: AcaoVisual = { tipo: "anotar", alvo, texto: texto.slice(0, 40) };
    if (acoes.length < 5) acoes.push(anotacao);
    else {
      // Substitui primeiro uma ação redundante, preservando a única ação que cobre cada peça citada.
      const substituivel = acoes.findLastIndex((acao, indiceAcao) => alvos.every((id) => {
        const cobre = (candidata: AcaoVisual) => candidata.tipo !== "anotar" && alvosDaAcao(candidata).includes(id);
        return !cobre(acao) || acoes.some((outra, i) => i !== indiceAcao && cobre(outra));
      }));
      if (indice === 0 && substituivel >= 0) acoes[substituivel] = anotacao;
      else break;
    }
  }
  return acoes;
}
export const ESTILO_DO_DESTAQUE = { espessura: 1.5, opacidade: 65 } as const;
export const grupoDoDestaque = (grupo: string) => `${grupo}:destaque`;
export function notaCurtaDaFala(fala?: string) {
  return (fala ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 4).join(" ").slice(0, 40);
}

/** Agenda remoção depois que a fala terminou: com sinal, espera a resposta ou o teto; sem sinal, espera 9 s. */
export function agendarRemocaoDestaque(apagar: () => void, sinalPodeApagar?: AbortSignal, semPergunta = false,
  relogio = { set: (cb: () => void, ms: number) => setTimeout(cb, ms), clear: (id?: ReturnType<typeof setTimeout>) => { if (id !== undefined) clearTimeout(id); } },
  fimDaFala?: Promise<void>) {
  let feito = false;
  let falaTerminou = !fimDaFala;
  let respostaTerminou = !!sinalPodeApagar?.aborted;
  let semResposta: ReturnType<typeof setTimeout> | undefined;
  let teto: ReturnType<typeof setTimeout> | undefined;
  const apagarUmaVez = () => {
    if (feito) return;
    feito = true;
    relogio.clear(teto);
    relogio.clear(semResposta);
    sinalPodeApagar?.removeEventListener("abort", respostaAcabou);
    apagar();
  };
  const iniciarPrazo = () => {
    if (feito) return;
    falaTerminou = true;
    if (respostaTerminou && sinalPodeApagar && !semPergunta) return apagarUmaVez();
    teto = relogio.set(apagarUmaVez, DESTAQUE_TETO_MS);
    if (!sinalPodeApagar || semPergunta) semResposta = relogio.set(apagarUmaVez, DESTAQUE_DURA_MS);
  };
  const respostaAcabou = () => {
    respostaTerminou = true;
    if (falaTerminou && !semPergunta) apagarUmaVez();
  };
  if (sinalPodeApagar && !semPergunta) sinalPodeApagar.addEventListener("abort", respostaAcabou, { once: true });
  if (fimDaFala) void fimDaFala.then(iniciarPrazo, iniciarPrazo);
  else iniciarPrazo();
  return () => {
    feito = true;
    relogio.clear(teto);
    relogio.clear(semResposta);
    sinalPodeApagar?.removeEventListener("abort", respostaAcabou);
  };
}

async function coreografar(o: OpcoesApontar) {
  const { quadro, cursor, grupo, sinal } = o;
  const memoria = o.memoria ?? criarMemoriaVisual();
  const plano = garantirCoberturaVisual(o.visual, o.alvos);
  const acoes = escolherAcoesVisuais(plano, o.alvos, o.nota, memoria).map((acao) =>
    acao.tipo === "anotar" ? { ...acao, texto: acao.texto.slice(0, 40) } : acao);
  const textoNota = o.nota.trim() || notaCurtaDaFala(o.fala);
  const podeDeixarRastro = !!textoNota && (!!o.fala?.trim().endsWith("?") || !o.fala);
  if (podeDeixarRastro) acoes.splice(0, acoes.length, ...incluirAnotacoesComLimite(acoes, o.alvos, textoNota));
  if (!acoes.length || sinal?.aborted) return;
  await quadro.agente.esperarCandidatoLivre();
  if (quadro.agente.candidatoOcupado() || sinal?.aborted) return;
  const conferir = () => {
    if (sinal?.aborted || quadro.agente.candidatoOcupado()) throw new Cancelada();
  };
  const naTela = (p: Ponto) => cenaParaTela(p, vistaDe(quadro));
  const mover = async (para: Ponto, semente: number) => {
    conferir();
    if (!cursor) return;
    const de = cursor.posicao() ?? { x: innerWidth - 180, y: innerHeight - 160 };
    const movimento = planejarMovimento(de, naTela(para), semente);
    await animar(Math.min(450, movimento.duracaoMs), (p) => { conferir(); cursor.mover(movimento.pontoEm(p)); }, sinal);
  };
  const ids = [...new Set(acoes.flatMap(alvosDaAcao))];
  const elementosAlvo = quadro.api.getSceneElements().filter((e) => ids.includes(e.id) && !e.isDeleted);
  const caixasAlvo = elementosAlvo.flatMap((e) => caixaDosElementos([e], 12) ?? []);
  const foco = caixasAlvo.length ? {
    x: Math.min(...caixasAlvo.map((c) => c.x)), y: Math.min(...caixasAlvo.map((c) => c.y)),
    largura: Math.max(...caixasAlvo.map((c) => c.x + c.largura)) - Math.min(...caixasAlvo.map((c) => c.x)),
    altura: Math.max(...caixasAlvo.map((c) => c.y + c.altura)) - Math.min(...caixasAlvo.map((c) => c.y)),
  } : undefined;
  if (foco && !estaVisivel(foco, vistaDe(quadro), 60)) {
    await quadro.agente.esperarCandidatoLivre();
    conferir();
    if (precisaReduzirZoom(foco, vistaDe(quadro), 60)) {
      // O ajuste instantâneo evita uma animação interna impossível de cancelar se o candidato retomar o traço.
      conferir();
      await quadro.api.scrollToContent(elementosAlvo, { animate: false, fitToContent: true });
      conferir();
    }
    const inicial = vistaDe(quadro);
    if (estaVisivel(foco, inicial, 60)) {
      // O Excalidraw já ajustou o zoom/enquadramento do conjunto.
    } else {
    const para = scrollParaCentralizar(foco, inicial);
    await animar(420, (p) => {
      conferir();
      const k = suavizar(p);
      quadro.agente.rolar(inicial.scrollX + (para.scrollX - inicial.scrollX) * k, inicial.scrollY + (para.scrollY - inicial.scrollY) * k);
    }, sinal);
    }
  }
  if (ids.length) quadro.agente.ancorar(grupo, ids);
  cursor?.mostrar();
  let indice = 0;
  let destaquesDesenhados = false;
  for (const acao of acoes) {
    conferir();
    const caixas = new Map(quadro.api.getSceneElements().filter((e) => !e.isDeleted).flatMap((e) => {
      const caixa = caixaDosElementos([e], 0);
      if (!caixa) return [];
      // Setas e linhas levam a polilinha (relativa à caixa): os gestos miram o meio do traço, não a caixa.
      const pontos = (e.type === "arrow" || e.type === "line") && "points" in e
        ? (e.points as readonly (readonly [number, number])[]).map(([px, py]) => [e.x + px - caixa.x, e.y + py - caixa.y] as const)
        : undefined;
      // A forma decide o gesto de marcar (contorno numa elipse, canto num retângulo...).
      const forma = formaDoElemento(e.type);
      return [[e.id, pontos ? { ...caixa, pontos, forma, containerId: "containerId" in e ? e.containerId : null }
        : { ...caixa, forma, containerId: "containerId" in e ? e.containerId : null }] as const];
    }));
    for (const gesto of comporGestos(acao, caixas, areaLivre(vistaDe(quadro)), o.semente + indice, o.conexoes)) {
      conferir();
      const id = `agente-${grupo}-gesto-${indice++}`;
      if (gesto.tipo === "apontar") {
        await mover(gesto.ponto, o.semente + indice);
        await animar(220, () => conferir(), sinal);
      } else if (gesto.tipo === "texto") {
        await mover(gesto.ponto, o.semente + indice);
        const anotacao = acao.tipo === "anotar" ? acao.alvo : acao.tipo === "interrogar" ? acao.alvo : undefined;
        const escrita = { id, grupo, texto: gesto.texto, x: gesto.ponto.x, y: gesto.ponto.y,
          tamanho: 16, largura: 26, velocidade: 55, sinal };
        if (anotacao) await quadro.agente.anotarPergunta({ ...escrita, grupo: `rastro:${anotacao}`, alvoId: anotacao });
        else await quadro.agente.escrever(escrita);
      } else {
        const destaque = gesto.destaque ? grupoDoDestaque(grupo) : null;
        if (destaque && !destaquesDesenhados) {
          destaquesDesenhados = true;
          if (ids.length) quadro.agente.ancorar(destaque, ids);
        }
        await mover(gesto.traco.origem, o.semente + indice);
        await animar(450, (p) => {
          conferir();
          const parte = parteDoTraco(gesto.traco, suavizar(p));
          quadro.agente.tracar({
            id, grupo: destaque ?? grupo, origem: parte.origem, pontos: parte.pontos, semente: o.semente + indice,
            ...(destaque ? ESTILO_DO_DESTAQUE : {}),
          });
          cursor?.mover(naTela(pontaDoTraco(parte)));
        }, sinal);
      }
    }
  }
  if (destaquesDesenhados) {
    // Some sozinho: o quadro do candidato não acumula tinta do Totti. Se a pergunta acabar antes, o grupo dela leva
    // o destaque junto (apagarGrupo apaga os subgrupos).
    const destaque = grupoDoDestaque(grupo);
    agendarRemocaoDestaque(() => { void quadro.agente.apagarGrupo(destaque); }, o.sinalPodeApagar, o.semPergunta, undefined, o.fimDaFala);
  }
}
