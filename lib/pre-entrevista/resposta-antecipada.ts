// Resposta antecipada do Totti: o rascunho que a tela pede enquanto a recrutadora ainda fala. Só servidor.
//
// O rascunho roda o turno inteiro (`conduzirTurno`) numa CÓPIA da sessão, e guarda cada chamada lenta (LLM e Jev) no
// cache comum (lib/conversa/rascunho.ts), sob a chave da entrada. Quando o turno fecha, o turno real roda igual a
// sempre, e cada chamada cuja entrada é idêntica à de um rascunho reaproveita o resultado guardado. Entrada diferente
// é chamada ao vivo. A sessão original só muda no turno real, então rascunho nunca duplica fala nem efeito.
import { cacheGlobalDeRascunho, chaveDoRascunho, comRascunho } from "@/lib/conversa/rascunho";
import { avaliarCobertura, avaliarEnfaseDaFala } from "./cobertura";
import { chat, type ChatOpcoes, type ChatResposta } from "./llm";
import type { Sessao } from "./sessoes";
import { conduzirTurno, type DepsDoTurno } from "./turno";

type Funcao = "chat" | "cobertura" | "enfase";

const cache = cacheGlobalDeRascunho<unknown>("pre-entrevista");

// Opções de transporte que não mudam o que o modelo responde: ficam fora da chave, para o rascunho e a confirmação
// casarem mesmo com prazos ou sinais diferentes.
const FORA_DA_CHAVE = new Set(["signal", "timeoutMs", "prazo"]);

/** Só o que é dado: sem sinal, sem prazo e sem funções. */
function argumentosDaChave(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  return Object.fromEntries(
    Object.entries(args).filter(([k, v]) => !FORA_DA_CHAVE.has(k) && typeof v !== "function" && !(v instanceof AbortSignal)),
  );
}

function chaveDe(fn: Funcao, args: unknown): string {
  return chaveDoRascunho({ fn, args: argumentosDaChave(args) });
}

/**
 * Chamada do rascunho: guarda a promessa no cache. O cache guarda uma CÓPIA do valor (`structuredClone`), feita na
 * hora em que a chamada termina; quem recebe o original é o próprio rascunho. Assim o turno do rascunho e o turno real
 * nunca dividem o mesmo objeto. Valor que não se clona vira falha da promessa, e a confirmação chama ao vivo.
 */
function guardar<T>(id: string, fn: Funcao, args: unknown, aoVivo: () => Promise<T>): Promise<T> {
  const chamada = aoVivo();
  cache.guardar(id, chaveDe(fn, args), chamada.then((valor) => structuredClone(valor)));
  return chamada;
}

/** Dependências do turno do rascunho: cada chamada lenta roda (ou roda `base`) e fica guardada para a confirmação. */
export function depsQueGuardam(id: string, base: DepsDoTurno = {}): DepsDoTurno {
  return {
    chat: (opcoes: ChatOpcoes): Promise<ChatResposta> =>
      guardar(id, "chat", opcoes, () => (base.chat ?? chat)(opcoes)),
    avaliarCobertura: (r, transcricao, contexto) =>
      guardar(id, "cobertura", { r, transcricao, contexto }, () =>
        (base.avaliarCobertura ?? avaliarCobertura)(r, transcricao, contexto),
      ),
    avaliarEnfaseDaFala: (transcricao) =>
      guardar(id, "enfase", { transcricao }, () => (base.avaliarEnfaseDaFala ?? avaliarEnfaseDaFala)(transcricao)),
  };
}

/** Uma chamada do turno real: usa o rascunho com a mesma entrada, se houver, ou chama ao vivo (ou `base`). */
function reaproveitar<T>(
  id: string,
  fn: Funcao,
  args: unknown,
  contagem: Contagem,
  aoVivo: () => Promise<T>,
): Promise<T> {
  return comRascunho<unknown>(cache, id, chaveDe(fn, args), () => aoVivo()).then(({ valor, doRascunho }) => {
    if (doRascunho) contagem.doRascunho += 1;
    else contagem.aoVivo += 1;
    return valor as T;
  });
}

export interface Contagem {
  doRascunho: number;
  aoVivo: number;
}

/** Dependências do turno real: cada chamada usa o rascunho com a mesma entrada, ou roda ao vivo. */
export function depsQueReaproveitam(
  id: string,
  base: DepsDoTurno = {},
): { deps: DepsDoTurno; contagem: Contagem } {
  const contagem: Contagem = { doRascunho: 0, aoVivo: 0 };
  const deps: DepsDoTurno = {
    chat: (opcoes: ChatOpcoes): Promise<ChatResposta> =>
      reaproveitar(id, "chat", opcoes, contagem, () => (base.chat ?? chat)(opcoes)),
    avaliarCobertura: (r, transcricao, contexto) =>
      reaproveitar(id, "cobertura", { r, transcricao, contexto }, contagem, () =>
        (base.avaliarCobertura ?? avaliarCobertura)(r, transcricao, contexto),
      ),
    avaliarEnfaseDaFala: (transcricao) =>
      reaproveitar(id, "enfase", { transcricao }, contagem, () =>
        (base.avaliarEnfaseDaFala ?? avaliarEnfaseDaFala)(transcricao),
      ),
  };
  return { deps, contagem };
}

/**
 * Prepara a fala do Totti para o texto que ela ainda está dizendo. Roda o turno numa cópia da sessão, sem gravar nada
 * na original, sem `ocupar` e sem agendar a extração. Erro vira `{ fala: null }`: o rascunho é opcional.
 */
export async function prepararRascunho(
  sessao: Sessao,
  texto: string,
  base?: DepsDoTurno,
): Promise<{ fala: string | null }> {
  try {
    // A cópia não leva o log da sessão: os eventos do rascunho não são da conversa.
    const copia = structuredClone({ ...sessao, logs: [] }) as Sessao;
    const { fala } = await conduzirTurno(copia, texto, depsQueGuardam(sessao.id, base));
    return { fala };
  } catch {
    return { fala: null };
  }
}
