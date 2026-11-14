// Rascunho da resposta do Totti (resposta antecipada). Só servidor.
//
// Enquanto o candidato ainda fala, a cada trecho confirmado pelo Scribe a tela pede um rascunho: o servidor prepara a
// resposta com o texto acumulado, sem gravar nada na sessão, e guarda o resultado aqui sob uma chave que resume tudo o
// que entrou nele (texto, estado da sessão, código, quadro). Quando o turno fecha (lib/audio/fimDoTurno.ts), a tela
// manda a fala pelo caminho normal; o caminho normal procura um rascunho com a mesma chave e, achando, usa o resultado
// em vez de chamar o modelo de novo. Entrada diferente (ele continuou falando, o código mudou) é outra chave: o
// rascunho não serve e a resposta sai do jeito de sempre.
//
// O valor guardado é a promessa: a confirmação que chega com o rascunho ainda em preparo espera ele terminar, em vez de
// pedir outro. Rascunho que falhou não é erro: quem toma volta ao caminho normal.
import { createHash } from "node:crypto";

export const VALIDADE_DO_RASCUNHO_MS = 60_000; // depois disso o rascunho é velho demais para valer
export const RASCUNHOS_POR_SESSAO = 4; // trechos recentes de uma mesma fala; o mais antigo sai
// Quanto a confirmação espera um rascunho ainda em preparo. O rascunho começou ~2,6 s antes do fechamento: se nem assim
// ficou pronto, o provedor travou (medido: rascunho preso até o timeout de 8 s, e a fala saindo em 12 s). Ao vivo é melhor.
export const ESPERA_MAXIMA_PELO_RASCUNHO_MS = 1500;

type Guardado<T> = { chave: string; valor: Promise<T>; criadoEm: number };

export type CacheDeRascunho<T> = {
  guardar(sessao: string, chave: string, valor: Promise<T>): void;
  /** O rascunho com esta chave, uma vez só: tomado, sai do cache (o mesmo rascunho nunca confirma duas falas). */
  tomar(sessao: string, chave: string): Promise<T> | undefined;
  /** Há um rascunho com esta chave? Não consome. */
  tem(sessao: string, chave: string): boolean;
  descartar(sessao: string): void;
};

export function criarCacheDeRascunho<T>(
  opcoes: { validadeMs?: number; porSessao?: number; agora?: () => number } = {},
): CacheDeRascunho<T> {
  const validadeMs = opcoes.validadeMs ?? VALIDADE_DO_RASCUNHO_MS;
  const porSessao = opcoes.porSessao ?? RASCUNHOS_POR_SESSAO;
  const agora = opcoes.agora ?? Date.now;
  const porId = new Map<string, Guardado<T>[]>();

  function vivos(sessao: string): Guardado<T>[] {
    const lista = (porId.get(sessao) ?? []).filter((g) => agora() - g.criadoEm < validadeMs);
    if (lista.length) porId.set(sessao, lista);
    else porId.delete(sessao);
    return lista;
  }

  // Sessões abandonadas não ficam para sempre: cada escrita limpa as vencidas de todas.
  function limparVencidos() {
    for (const id of [...porId.keys()]) vivos(id);
  }

  return {
    guardar(sessao, chave, valor) {
      valor.catch(() => {}); // falha do rascunho é tratada por quem toma; aqui não vira rejeição solta
      limparVencidos();
      const lista = vivos(sessao).filter((g) => g.chave !== chave);
      lista.push({ chave, valor, criadoEm: agora() });
      porId.set(sessao, lista.slice(-porSessao));
    },
    tomar(sessao, chave) {
      const lista = vivos(sessao);
      const i = lista.findIndex((g) => g.chave === chave);
      if (i < 0) return undefined;
      const [achado] = lista.splice(i, 1);
      if (lista.length) porId.set(sessao, lista);
      else porId.delete(sessao);
      return achado.valor;
    },
    tem(sessao, chave) {
      return vivos(sessao).some((g) => g.chave === chave);
    },
    descartar(sessao) {
      porId.delete(sessao);
    },
  };
}

/** Um cache por nome, no `globalThis` (sobrevive ao recarregamento do módulo no dev, como o store da pré-entrevista). */
export function cacheGlobalDeRascunho<T>(nome: string): CacheDeRascunho<T> {
  const g = globalThis as typeof globalThis & { __rascunhosDoTotti?: Map<string, CacheDeRascunho<unknown>> };
  g.__rascunhosDoTotti ??= new Map();
  let cache = g.__rascunhosDoTotti.get(nome);
  if (!cache) {
    cache = criarCacheDeRascunho<unknown>();
    g.__rascunhosDoTotti.set(nome, cache);
  }
  return cache as CacheDeRascunho<T>;
}

/**
 * Usa o rascunho com esta chave, se houver e tiver dado certo; senão, `aoVivo()`. Rascunho ainda em preparo é esperado
 * até `esperaMaximaMs`; depois disso é abandonado (nunca corre junto com o ao vivo: na IDE os dois mexeriam na sessão).
 * `doRascunho` diz de onde veio, para o log e para a medição do ganho.
 */
export async function comRascunho<T>(
  cache: CacheDeRascunho<T>,
  sessao: string,
  chave: string,
  aoVivo: () => Promise<T>,
  esperaMaximaMs = ESPERA_MAXIMA_PELO_RASCUNHO_MS,
): Promise<{ valor: T; doRascunho: boolean }> {
  const guardado = cache.tomar(sessao, chave);
  if (guardado) {
    let prazo: ReturnType<typeof setTimeout> | undefined;
    const tarde = new Promise<{ tarde: true }>((r) => { prazo = setTimeout(() => r({ tarde: true }), esperaMaximaMs); });
    try {
      const r = await Promise.race([guardado.then((valor) => ({ valor })), tarde]);
      if ("valor" in r) return { valor: r.valor, doRascunho: true };
      // Passou do prazo: o rascunho fica para trás e a fala sai ao vivo.
    } catch {
      // O rascunho falhou: a fala sai do jeito de sempre.
    } finally {
      clearTimeout(prazo);
    }
  }
  return { valor: await aoVivo(), doRascunho: false };
}

/** JSON com as chaves dos objetos em ordem: a mesma entrada dá sempre o mesmo texto. */
function jsonEstavel(valor: unknown): string {
  return JSON.stringify(valor, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

/** Chave curta de uma entrada qualquer (sha256 do JSON estável). `undefined` e campo ausente dão a mesma chave. */
export function chaveDoRascunho(entrada: unknown): string {
  return createHash("sha256").update(jsonEstavel(entrada) ?? "").digest("hex");
}

/** Pedido de rascunho no corpo da rota: `{ ..., rascunho: true }`. */
export function pedeRascunho(corpo: unknown): boolean {
  return !!corpo && typeof corpo === "object" && (corpo as { rascunho?: unknown }).rascunho === true;
}
