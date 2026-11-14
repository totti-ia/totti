// Único ponto de acesso da tela da pré-entrevista ao servidor.
// Usa as rotas reais (/api/pre-entrevista/...) por padrão. A demonstração roteirizada só entra com
// NEXT_PUBLIC_USAR_SERVIDOR=0: antes, sem a variável, a tela caía nela em silêncio e parecia estar no servidor.
//
// O servidor guarda a sessão na memória de uma instância; na Vercel a próxima requisição pode cair em outra.
// Por isso todo estado traz a `copia` da sessão: ela fica guardada aqui (e no navegador, para retomar um
// rascunho depois) e vai junto com cada fala e com a finalização. Se a instância não tiver a sessão, ela
// é reconstruída a partir da cópia em vez de responder "sessão não encontrada".
import type { InterviewConfig } from "@/lib/contracts";
import type { Vaga } from "../classificador";
import type { Rascunho } from "../rascunho";
import type { CopiaSessao, EstadoSessao } from "../sessoes";
import { estadoInicialDemo, responderDemo } from "./demo";

const API = "/api/pre-entrevista/sessoes";

export const usarServidor = () => process.env.NEXT_PUBLIC_USAR_SERVIDOR !== "0";

type CorpoErro = { erro?: string; detalhe?: string; erros?: string[] };

async function erroDe(r: Response) {
  const j = (await r.json().catch(() => ({}))) as CorpoErro;
  return [j.erro, j.detalhe, ...(j.erros ?? [])].filter(Boolean).join(" — ") || `HTTP ${r.status}`;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Na demonstração, as sessões ficam na memória da página.
const sessoesDemo = new Map<string, EstadoSessao>();

// A última cópia de cada sessão (ver o topo do arquivo). Memória primeiro; o navegador guarda para retomar.
const copias = new Map<string, CopiaSessao>();
const CHAVE_COPIA = (id: string) => `converge.sessao.${id}`;

function guardar(estado: EstadoSessao): EstadoSessao {
  if (!estado.copia) return estado;
  copias.set(estado.id, estado.copia);
  try {
    localStorage.setItem(CHAVE_COPIA(estado.id), JSON.stringify(estado.copia));
  } catch {
    // Sem espaço ou sem acesso: a cópia em memória basta para esta visita.
  }
  return estado;
}

function copiaDe(id: string): CopiaSessao | undefined {
  const emMemoria = copias.get(id);
  if (emMemoria) return emMemoria;
  try {
    const salva = localStorage.getItem(CHAVE_COPIA(id));
    return salva ? (JSON.parse(salva) as CopiaSessao) : undefined;
  } catch {
    return undefined;
  }
}

export async function criarSessao(vaga: Vaga): Promise<EstadoSessao> {
  if (!usarServidor()) {
    await esperar(2600); // o tempo do Totti "lendo" a vaga
    const estado = estadoInicialDemo(vaga);
    sessoesDemo.set(estado.id, estado);
    return estado;
  }
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(vaga),
  });
  if (!r.ok) throw new Error(await erroDe(r));
  return guardar((await r.json()) as EstadoSessao);
}

export async function enviarFala(sessaoId: string, texto: string): Promise<EstadoSessao> {
  if (!usarServidor()) {
    const anterior = sessoesDemo.get(sessaoId);
    if (!anterior) throw new Error("Sessão de demonstração não encontrada.");
    await esperar(1100 + Math.random() * 700);
    const estado = responderDemo(anterior, texto);
    sessoesDemo.set(sessaoId, estado);
    return estado;
  }
  const r = await fetch(`${API}/${sessaoId}/mensagem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpoDaFala(sessaoId, texto, false)),
  });
  if (!r.ok) throw new Error(await erroDe(r));
  return guardar((await r.json()) as EstadoSessao);
}

/** Corpo do POST de uma fala. O rascunho (resposta antecipada) manda o mesmo corpo com `rascunho: true` no fim. */
function corpoDaFala(sessaoId: string, texto: string, rascunho: boolean) {
  const corpo = { text: texto, copia: copiaDe(sessaoId) };
  return rascunho ? { ...corpo, rascunho: true } : corpo;
}

/**
 * Rascunho da resposta (resposta antecipada): o servidor prepara a resposta a este texto sem gravar a fala. Não muda
 * a sessão daqui: a resposta é ignorada, e o envio final, com o mesmo corpo, a reaproveita se ela ainda valer.
 */
export async function rascunharFala(sessaoId: string, texto: string, sinal: AbortSignal): Promise<void> {
  const r = await fetch(`${API}/${sessaoId}/mensagem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpoDaFala(sessaoId, texto, true)),
    signal: sinal,
  });
  if (!r.ok) throw new Error(await erroDe(r));
}

/** Estado mais recente (a extração do rascunho roda em segundo plano no servidor). */
export async function buscarSessao(sessaoId: string): Promise<EstadoSessao | null> {
  if (!usarServidor()) return sessoesDemo.get(sessaoId) ?? null;
  let r = await fetch(`${API}/${sessaoId}`, { cache: "no-store" });
  // Esta instância não tem a sessão: manda a cópia para ela reconstruir.
  const copia = r.status === 404 ? copiaDe(sessaoId) : undefined;
  if (copia) {
    r = await fetch(`${API}/${sessaoId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copia }),
    });
  }
  if (!r.ok) throw new Error(await erroDe(r));
  return guardar((await r.json()) as EstadoSessao);
}

/**
 * Guarda no servidor o que ela editou na revisão ao voltar à conversa (sem publicar). O que mudou fica fixado: só
 * muda de novo se ela falar daquilo com o Totti. `base` é o rascunho de que ela partiu ao editar (o servidor só fixa o
 * que mudou em relação a ele). Devolve o estado da sessão com o rascunho guardado.
 */
export async function salvarRascunho(sessaoId: string, rascunho: Rascunho, base?: Rascunho): Promise<EstadoSessao> {
  if (!usarServidor()) {
    const anterior = sessoesDemo.get(sessaoId);
    if (!anterior) throw new Error("Sessão de demonstração não encontrada.");
    const estado = { ...anterior, rascunho };
    sessoesDemo.set(sessaoId, estado);
    return estado;
  }
  const r = await fetch(`${API}/${sessaoId}/rascunho`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rascunho, ...(base ? { base } : {}), copia: copiaDe(sessaoId) }),
  });
  if (!r.ok) throw new Error(await erroDe(r));
  const j = (await r.json()) as { estado: EstadoSessao };
  return guardar(j.estado);
}

export type ResultadoFinal ={ config: InterviewConfig } | { erros: string[] };

export async function finalizar(sessaoId: string, rascunho: Rascunho): Promise<ResultadoFinal> {
  if (!usarServidor()) {
    await esperar(900);
    const config = {
      id: `config-${sessaoId}`,
      mode: rascunho.mode,
      roleTitle: rascunho.roleTitle,
      jobDescription: rascunho.jobDescription,
      seniority: rascunho.seniority,
      focus: rascunho.focus,
      recruiterNotes: rascunho.recruiterNotes,
      criteria: rascunho.criteria,
      problemId: rascunho.problemId ?? "encurtador-de-url",
      languages: ["python"],
      durationMin: rascunho.durationMin ?? 45,
    } as InterviewConfig;
    return { config };
  }
  const r = await fetch(`${API}/${sessaoId}/finalizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rascunho, copia: copiaDe(sessaoId) }),
  });
  const j = (await r.json().catch(() => ({}))) as CorpoErro & { ok?: boolean; config?: InterviewConfig };
  if (r.ok && j.ok && j.config) return { config: j.config };
  if (r.status === 422) return { erros: j.erros ?? ["configuração inválida"] };
  throw new Error([j.erro, j.detalhe].filter(Boolean).join(" — ") || `HTTP ${r.status}`);
}
