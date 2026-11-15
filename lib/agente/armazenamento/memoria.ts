// Repositório em memória: serve para desenvolvimento e testes. Perde tudo ao reiniciar o servidor.
// Limites: no máximo 200 sessões (a menos usada sai primeiro, LRU), 2000 eventos por sessão (os mais
// antigos saem), 60 imagens intermediárias por sessão e 256 MB de imagens no total.
import { createHash, randomUUID } from "node:crypto";
import {
  ErroLimite,
  type EventoArmazenado,
  type EventoEntrada,
  type ImagemArmazenada,
  type RepositorioSessoes,
  type SessaoArmazenada,
} from "./repositorio";
import type { Scorecard } from "../scorecard";

export type LimitesMemoria = {
  maxSessoes: number;
  maxEventosPorSessao: number;
  maxImagensPorSessao: number;
  maxBytesImagens: number;
};

export const LIMITES_PADRAO: LimitesMemoria = {
  maxSessoes: 200,
  maxEventosPorSessao: 2000,
  maxImagensPorSessao: 60,
  maxBytesImagens: 256 * 1024 * 1024,
};

type Registro = {
  sessao: SessaoArmazenada;
  eventos: { evento: EventoArmazenado; chave: string }[];
  chaves: Set<string>;
  imagens: ImagemArmazenada[];
  scorecard?: Scorecard;
};

export function chaveDoEvento(e: EventoEntrada): string {
  const hash = createHash("sha1").update(JSON.stringify(e.dados ?? null)).digest("hex");
  return `${e.horario}|${e.tipo}|${hash}`;
}

export function criarRepositorioEmMemoria(limites: Partial<LimitesMemoria> = {}): RepositorioSessoes {
  const lim = { ...LIMITES_PADRAO, ...limites };
  // Map mantém a ordem de inserção: reinserir ao usar faz do primeiro item o menos usado.
  const registros = new Map<string, Registro>();
  let bytesImagens = 0;

  const bytesDe = (r: Registro) => r.imagens.reduce((s, i) => s + i.bytes.byteLength, 0);
  const remover = (id: string) => {
    const r = registros.get(id);
    if (r) bytesImagens -= bytesDe(r);
    registros.delete(id);
  };
  const usar = (id: string): Registro | undefined => {
    const r = registros.get(id);
    if (r) {
      registros.delete(id);
      registros.set(id, r);
    }
    return r;
  };
  const despejar = (protegido?: string) => {
    for (const id of [...registros.keys()]) {
      if (registros.size <= lim.maxSessoes && bytesImagens <= lim.maxBytesImagens) break;
      if (id !== protegido) remover(id);
    }
  };

  return {
    async criar({ avaliacaoId, candidatoId, estado }) {
      const sessao: SessaoArmazenada = {
        id: randomUUID(),
        avaliacaoId,
        candidatoId,
        criadaEm: Date.now(),
        estado: structuredClone(estado),
        analises: 0,
      };
      registros.set(sessao.id, { sessao, eventos: [], chaves: new Set(), imagens: [] });
      despejar(sessao.id);
      return structuredClone(sessao);
    },
    async obter(id) {
      const r = usar(id);
      return r ? structuredClone(r.sessao) : null;
    },
    async salvarEstado(id, estado) {
      const r = usar(id);
      if (r) r.sessao = { ...r.sessao, estado: structuredClone(estado) };
    },
    async contarAnalise(id) {
      const r = usar(id);
      if (!r) return 0;
      r.sessao.analises += 1;
      return r.sessao.analises;
    },
    async anexarEventos(id, eventos) {
      const r = usar(id);
      if (!r) return [];
      const novos: EventoArmazenado[] = [];
      for (const e of eventos) {
        const chave = chaveDoEvento(e);
        if (r.chaves.has(chave)) continue;
        const evento: EventoArmazenado = { ...structuredClone(e), recebidoEm: Date.now() };
        r.chaves.add(chave);
        r.eventos.push({ evento, chave });
        novos.push(evento);
        if (r.eventos.length > lim.maxEventosPorSessao) {
          const velho = r.eventos.shift();
          if (velho) r.chaves.delete(velho.chave);
        }
      }
      return novos;
    },
    async listarEventos(id) {
      const r = usar(id);
      return r ? r.eventos.map((x) => structuredClone(x.evento)) : [];
    },
    async salvarImagem(id, imagem, opcoes = {}) {
      const r = usar(id);
      if (!r) throw new ErroLimite("sessão inexistente");
      const final = opcoes.final ?? imagem.final ?? false;
      const indiceFinal = r.imagens.findIndex((i) => i.final);
      if (!final && r.imagens.filter((i) => !i.final).length >= lim.maxImagensPorSessao) throw new ErroLimite("limite de imagens da sessão");
      const gravada = { bytes: imagem.bytes.slice(), horario: imagem.horario, final };
      const anterior = final && indiceFinal >= 0 ? r.imagens[indiceFinal] : undefined;
      if (anterior) {
        bytesImagens -= anterior.bytes.byteLength;
        r.imagens[indiceFinal] = gravada;
      }
      else r.imagens.push(gravada);
      bytesImagens += imagem.bytes.byteLength;
      despejar(id);
      if (bytesImagens > lim.maxBytesImagens) {
        // Só esta sessão sobrou e mesmo assim estoura: desfaz.
        if (anterior) r.imagens[indiceFinal] = anterior;
        else r.imagens.pop();
        bytesImagens -= imagem.bytes.byteLength;
        if (anterior) bytesImagens += anterior.bytes.byteLength;
        throw new ErroLimite("limite de memória de imagens");
      }
      return r.imagens.indexOf(gravada) + 1;
    },
    async obterImagem(id, numero) {
      const r = usar(id);
      const img = r?.imagens[numero - 1];
      return img ? { bytes: img.bytes.slice(), horario: img.horario, final: img.final } : null;
    },
    async listarImagens(id) {
      const r = usar(id);
      return r ? r.imagens.map((i, k) => ({ imagem: i, numero: k + 1, horario: i.horario }))
        .sort((a, b) => Number(a.imagem.final) - Number(b.imagem.final) || a.numero - b.numero)
        .map(({ numero, horario }) => ({ numero, horario })) : [];
    },
    async salvarScorecard(id, scorecard) {
      const r = usar(id);
      if (r) r.scorecard = structuredClone(scorecard);
    },
    async obterScorecard(id) {
      const r = usar(id);
      return r?.scorecard ? structuredClone(r.scorecard) : null;
    },
  };
}

const CHAVE_GLOBAL = Symbol.for("convergechallenge.repositorioSessoes");

/** Singleton em memória do processo. Fica em globalThis para sobreviver ao HMR do `next dev`. */
export function repositorioEmMemoriaPadrao(): RepositorioSessoes {
  const g = globalThis as unknown as Record<symbol, RepositorioSessoes | undefined>;
  return (g[CHAVE_GLOBAL] ??= criarRepositorioEmMemoria());
}
