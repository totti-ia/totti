// Camada do agente no quadro: tudo que o agente escreve ou desenha passa por aqui.
//
// Regras:
// - todo elemento do agente leva customData.autor = "agente" e um grupo (ex.: "enunciado", "pergunta:3");
// - entra travado (locked) e fora do histórico (Ctrl+Z do candidato não desfaz);
// - só o agente apaga: se o candidato conseguir apagar ou mudar algo do agente
//   (ex.: "Limpar tela"), a camada restaura na hora.
//
// Usa o runtime do Excalidraw, então só pode ser importado por código que roda no navegador
// (o Canvas é carregado com ssr: false). Fora dele, importe só os tipos.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  FONT_FAMILY,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawImperativeAPI } from "@/lib/excalidraw/tipos";
import { quebrarLinhas } from "@/lib/excalidraw/texto";
import { atualizarRastro } from "@/lib/presenca/acoesVisuais";

export const AUTOR_AGENTE = "agente";

export function ehDoAgente(elemento: ExcalidrawElement) {
  return elemento.customData?.autor === AUTOR_AGENTE;
}

export type OpcoesEscrita = {
  id: string;
  grupo: string;
  texto: string;
  x: number;
  y: number;
  tamanho?: number;
  /** Máximo de caracteres por linha antes de quebrar. */
  largura?: number;
  /** Caracteres por segundo. */
  velocidade?: number;
  /** Para de escrever no meio (ex.: o candidato já respondeu). */
  sinal?: AbortSignal;
  /** Cor do texto. Padrão: a cor do agente. */
  cor?: string;
};

export type OpcoesTraco = {
  id: string;
  grupo: string;
  /** Origem absoluta na cena e pontos relativos a ela (formato do Excalidraw). */
  origem: { x: number; y: number };
  pontos: [number, number][];
  /** "seta" desenha a ponta no fim. */
  tipo?: "linha" | "seta";
  espessura?: number;
  /** Fixa o "jeito" do traço entre um quadro e outro da animação. */
  semente: number;
  /** Cor do traço. Padrão: a cor do agente. */
  cor?: string;
  /** 0 a 100. Padrão: 100. Os destaques do Totti usam menos, para parecer marca de caneta de quem comenta. */
  opacidade?: number;
};

export type CamadaAgente = {
  /** Escreve um texto letra a letra, com ritmo humano. Resolve quando termina. */
  escrever(opcoes: OpcoesEscrita): Promise<void>;
  /** Registra uma nota curta de pergunta junto à peça; uma por peça, no máximo oito no quadro. */
  anotarPergunta(opcoes: OpcoesEscrita & { alvoId: string }): Promise<void>;
  /** Coloca (ou atualiza) um traço do agente: chamar a cada quadro para desenhar aos poucos. */
  tracar(opcoes: OpcoesTraco): void;
  /** Move a vista do quadro (fora do histórico). */
  rolar(scrollX: number, scrollY: number): void;
  /** Moldura da nota (um "post-it" na cor do agente), que aparece com fade. */
  emoldurar(opcoes: { id: string; grupo: string; x: number; y: number; largura: number; altura: number }): Promise<void>;
  /** Faz o grupo acompanhar os elementos do candidato: se ele arrastar o alvo, a anotação vai junto. */
  ancorar(grupo: string, idsAlvo: string[]): void;
  /** O candidato está no meio de um traço, arraste ou digitação? */
  candidatoOcupado(): boolean;
  /** Espera o candidato terminar o que está fazendo (até `limiteMs`). */
  esperarCandidatoLivre(limiteMs?: number): Promise<void>;
  /** Apaga (com esmaecer) todos os elementos de um grupo e dos subgrupos dele (`<grupo>:...`). */
  apagarGrupo(grupo: string): Promise<void>;
  /** Chamar a cada onChange: restaura o que o candidato tiver mexido e reposiciona as anotações ancoradas. */
  proteger(cena: readonly ExcalidrawElement[]): void;
};

function corDoAgente() {
  const cor = getComputedStyle(document.documentElement).getPropertyValue("--agente").trim();
  return cor || "#0071e3";
}

/** Mistura uma cor hexadecimal com branco (0 = a cor, 1 = branco). */
function clarear(hex: string, quanto: number) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#eef5fd";
  const canal = (c: string) => Math.round(parseInt(c, 16) + (255 - parseInt(c, 16)) * quanto);
  return `#${[m[1], m[2], m[3]].map((c) => canal(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Canto superior esquerdo dos elementos (ou null se nenhum estiver na cena). */
function cantoDe(cena: readonly ExcalidrawElement[], ids: string[]) {
  const vivos = cena.filter((e) => ids.includes(e.id) && !e.isDeleted);
  if (vivos.length === 0) return null;
  return { x: Math.min(...vivos.map((e) => e.x)), y: Math.min(...vivos.map((e) => e.y)) };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O candidato apagou, destravou, moveu ou alterou um elemento do agente? */
function foiMexido(oficial: ExcalidrawElement, atual: ExcalidrawElement) {
  return (
    atual.isDeleted !== oficial.isDeleted ||
    atual.locked !== oficial.locked ||
    Math.round(atual.x) !== Math.round(oficial.x) ||
    Math.round(atual.y) !== Math.round(oficial.y) ||
    atual.angle !== oficial.angle ||
    atual.opacity !== oficial.opacity ||
    atual.strokeColor !== oficial.strokeColor ||
    ("text" in atual && "text" in oficial && atual.text !== oficial.text)
  );
}

export function criarCamadaAgente(api: ExcalidrawImperativeAPI): CamadaAgente {
  // Cópia oficial dos elementos do agente: é ela que vale se a cena divergir.
  const oficiais = new Map<string, ExcalidrawElement>();
  /** Grupo → elementos do candidato que ele anota e onde eles estavam. */
  const ancoras = new Map<string, { ids: string[]; canto: { x: number; y: number } }>();
  /** Quanto cada grupo já foi deslocado (para o que ainda está sendo desenhado ir junto). */
  const deslocamento = new Map<string, { dx: number; dy: number }>();
  const desloc = (grupo: string) => deslocamento.get(grupo) ?? { dx: 0, dy: 0 };
  let restaurando = false;
  const reconstruirRastro = () => {
    const mapa = new Map<string, { id: string; grupo: string }>();
    for (const elemento of api.getSceneElements().filter((e) => !e.isDeleted && ehDoAgente(e))) {
      const grupo = elemento.customData?.grupo;
      if (typeof grupo !== "string" || !grupo.startsWith("rastro:")) continue;
      const alvo = grupo.slice("rastro:".length);
      mapa.set(alvo, { id: elemento.id, grupo });
    }
    return mapa;
  };
  let notasPorAlvo = reconstruirRastro();

  function candidatoOcupado() {
    const s = api.getAppState();
    return !!(
      s.newElement ||
      s.multiElement ||
      s.resizingElement ||
      s.editingTextElement ||
      s.selectedElementsAreBeingDragged ||
      s.isResizing ||
      s.isRotating ||
      s.cursorButton === "down"
    );
  }

  function aplicar(novos: ExcalidrawElement[], removidos: string[] = []) {
    const porId = new Map(novos.map((e) => [e.id, e]));
    const cena = api.getSceneElementsIncludingDeleted();
    const resultado = cena
      .filter((e) => !removidos.includes(e.id))
      .map((e) => porId.get(e.id) ?? e);
    for (const e of novos) if (!cena.some((c) => c.id === e.id)) resultado.push(e);

    api.updateScene({ elements: resultado, captureUpdate: CaptureUpdateAction.NEVER });

    // Guarda a versão que ficou na cena, para comparar no proteger().
    for (const id of removidos) oficiais.delete(id);
    const depois = api.getSceneElementsIncludingDeleted();
    for (const e of depois) if (porId.has(e.id)) oficiais.set(e.id, e);
  }

  function criarTexto(o: OpcoesEscrita, texto: string, versao: number) {
    const [el] = convertToExcalidrawElements(
      [
        {
          type: "text",
          id: o.id,
          x: o.x + desloc(o.grupo).dx,
          y: o.y + desloc(o.grupo).dy,
          text: texto,
          fontSize: o.tamanho ?? 20,
          fontFamily: FONT_FAMILY.Excalifont,
          strokeColor: o.cor ?? corDoAgente(),
          locked: true,
          version: versao,
          customData: { autor: AUTOR_AGENTE, grupo: o.grupo },
        },
      ],
      { regenerateIds: false },
    );
    return el;
  }

  return {
    async anotarPergunta(o) {
      notasPorAlvo = reconstruirRastro();
      const atualizado = atualizarRastro(notasPorAlvo, o.alvoId, { id: o.id, grupo: o.grupo });
      notasPorAlvo = atualizado.rastro;
      for (const removida of atualizado.removidos) await this.apagarGrupo(removida.grupo);
      await this.escrever({ ...o, texto: o.texto.trim().slice(0, 40) });
      this.ancorar(o.grupo, [o.alvoId]);
    },
    async escrever(o) {
      const completo = quebrarLinhas(o.texto, o.largura ?? 48);
      const cps = o.velocidade ?? 38;
      let versao = (oficiais.get(o.id)?.version ?? 0) + 1;
      for (let i = 1; i <= completo.length; i++) {
        if (o.sinal?.aborted) return;
        aplicar([criarTexto(o, completo.slice(0, i), versao++)]);
        const letra = completo[i - 1];
        // Ritmo humano: variação pequena e pausas em pontuação e quebra de linha.
        let pausa = (1000 / cps) * (0.6 + Math.random() * 0.8);
        if (/[.,:;!?]/.test(letra)) pausa += 140;
        if (letra === "\n") pausa += 90;
        await esperar(pausa);
      }
      // A largura do texto é medida a cada letra. Se a fonte ainda estava carregando (o primeiro texto do quadro,
      // o título do enunciado), a medida sai curta e o fim aparece cortado ("Chat em tempo re"): mede de novo
      // quando a fonte chegar.
      const fonte = `${o.tamanho ?? 20}px Excalifont`;
      void (typeof document !== "undefined" && document.fonts ? document.fonts.load(fonte) : Promise.resolve())
        .then(() => {
          const atual = oficiais.get(o.id);
          if (!o.sinal?.aborted && atual && !atual.isDeleted) aplicar([criarTexto(o, completo, atual.version + 1)]);
        })
        .catch(() => {});
    },

    tracar(o) {
      // O Excalidraw precisa de pelo menos dois pontos num traço.
      const brutos = o.pontos.length >= 2 ? o.pontos : [[0, 0] as [number, number], [0.1, 0] as [number, number]];
      // O Excalidraw mede e recorta a linha a partir do primeiro ponto: ele precisa ser [0, 0].
      const [x0, y0] = brutos[0];
      const pontos = brutos.map(([x, y]) => [x - x0, y - y0] as [number, number]);
      const xs = pontos.map((p) => p[0]);
      const ys = pontos.map((p) => p[1]);
      const comum = {
        id: o.id,
        x: o.origem.x + x0 + desloc(o.grupo).dx,
        y: o.origem.y + y0 + desloc(o.grupo).dy,
        // Largura e altura pelos pontos (o conversor do Excalidraw não calcula sozinho).
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        points: pontos,
        strokeColor: o.cor ?? corDoAgente(),
        strokeWidth: o.espessura ?? 2,
        opacity: o.opacidade ?? 100,
        roughness: 0,
        roundness: null,
        seed: o.semente,
        locked: true,
        version: (oficiais.get(o.id)?.version ?? 0) + 1,
        customData: { autor: AUTOR_AGENTE, grupo: o.grupo },
      };
      const esqueleto =
        o.tipo === "seta"
          ? { ...comum, type: "arrow" as const, startArrowhead: null, endArrowhead: "arrow" as const }
          : { ...comum, type: "line" as const };
      const [el] = convertToExcalidrawElements([esqueleto], { regenerateIds: false });
      aplicar([el]);
    },

    rolar(scrollX, scrollY) {
      api.updateScene({ appState: { scrollX, scrollY }, captureUpdate: CaptureUpdateAction.NEVER });
    },

    async emoldurar(o) {
      const cor = corDoAgente();
      const criar = (opacidade: number) => {
        const [el] = convertToExcalidrawElements(
          [
            {
              type: "rectangle",
              id: o.id,
              x: o.x + desloc(o.grupo).dx,
              y: o.y + desloc(o.grupo).dy,
              width: o.largura,
              height: o.altura,
              strokeColor: cor,
              backgroundColor: clarear(cor, 0.9),
              fillStyle: "solid",
              strokeWidth: 1,
              roughness: 1,
              roundness: { type: 3 },
              opacity: opacidade,
              seed: 7,
              locked: true,
              version: (oficiais.get(o.id)?.version ?? 0) + 1,
              customData: { autor: AUTOR_AGENTE, grupo: o.grupo },
            },
          ],
          { regenerateIds: false },
        );
        return el;
      };
      for (const opacidade of [20, 45, 70, 90, 100]) {
        aplicar([criar(opacidade)]);
        await esperar(35);
      }
    },

    ancorar(grupo, idsAlvo) {
      const canto = cantoDe(api.getSceneElements(), idsAlvo);
      if (canto) ancoras.set(grupo, { ids: idsAlvo, canto });
    },

    candidatoOcupado,

    async esperarCandidatoLivre(limiteMs = 4000) {
      const inicio = Date.now();
      while (candidatoOcupado() && Date.now() - inicio < limiteMs) await esperar(120);
    },

    async apagarGrupo(grupo) {
      const pertence = (g: unknown) => typeof g === "string" && (g === grupo || g.startsWith(`${grupo}:`));
      const doGrupo = [...oficiais.values()].filter((e) => pertence(e.customData?.grupo));
      for (const g of [...ancoras.keys()]) if (pertence(g)) ancoras.delete(g);
      if (doGrupo.length === 0) return;
      const passos = 8;
      for (let p = passos - 1; p >= 0; p--) {
        // Esmaece a partir da opacidade de cada um (o destaque já é translúcido).
        aplicar(doGrupo.map((e) => newElementWith(e, { opacity: Math.round((e.opacity * p) / passos) })));
        await esperar(30);
      }
      aplicar([], doGrupo.map((e) => e.id));
      for (const g of [...deslocamento.keys()]) if (pertence(g)) deslocamento.delete(g);
    },

    proteger(cena) {
      if (restaurando || oficiais.size === 0) return;

      // O candidato arrastou um elemento anotado: a anotação acompanha.
      const deslocados: ExcalidrawElement[] = [];
      for (const [grupo, ancora] of ancoras) {
        const canto = cantoDe(cena, ancora.ids);
        if (!canto) continue;
        const dx = canto.x - ancora.canto.x;
        const dy = canto.y - ancora.canto.y;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        ancora.canto = canto;
        const atual = desloc(grupo);
        deslocamento.set(grupo, { dx: atual.dx + dx, dy: atual.dy + dy });
        for (const e of oficiais.values()) {
          if (e.customData?.grupo === grupo) deslocados.push(newElementWith(e, { x: e.x + dx, y: e.y + dy }));
        }
      }
      if (deslocados.length > 0) {
        restaurando = true;
        queueMicrotask(() => {
          aplicar(deslocados);
          restaurando = false;
        });
        return;
      }

      const atuais = new Map(cena.map((e) => [e.id, e]));
      const mexidos: ExcalidrawElement[] = [];
      for (const oficial of oficiais.values()) {
        const atual = atuais.get(oficial.id);
        if (!atual || foiMexido(oficial, atual)) mexidos.push(oficial);
        // Mudança interna do Excalidraw (ex.: remedir o texto quando a fonte carrega): aceita.
        else if (atual.version !== oficial.version) oficiais.set(atual.id, atual);
      }
      if (mexidos.length === 0) return;

      // Fora do ciclo do onChange, para não atualizar a cena no meio de outra atualização.
      restaurando = true;
      queueMicrotask(() => {
        aplicar(mexidos.map((e) => newElementWith(e, { isDeleted: false, locked: true })));
        restaurando = false;
      });
    },
  };
}
