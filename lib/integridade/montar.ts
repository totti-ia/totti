import type { SessionEvent } from "@/lib/contracts";
import type { EventoEntrada } from "@/lib/agente/armazenamento/repositorio";
import { colagemDeFora } from "@/lib/agents/colagem";
import { tentativasEmTextos } from "@/lib/seguranca/injecao";
import { canarioApareceu, nomeDoCanario } from "./canario";
import type { BlocoDeIntegridade, SinalDeIntegridade, TipoDeSinal } from "./tipos";

const minuto = (t: number) => `no minuto ${Math.floor(t / 60_000)}`;
const segundos = (ms: number) => `${Math.round(ms / 100) / 10} s`;
type Texto = { t: number; onde: string; texto: string };
type Saida = { t: number; duracaoMs: number; motivo: "aba" | "janela" };

/** Limiares conservadores, só para o relatório; não decidem conduta, nota ou recomendação. */
export const LIMITES = { digitados: 200, trechoSemPausa: 120, janelaEscritaMs: 60_000, depoisDaSaidaMs: 30_000 } as const;

function coletor() {
  const sinais: SinalDeIntegridade[] = [];
  const adicionar = (tipo: TipoDeSinal, t: number, texto: string, extras: { fim?: number; detalhe?: string } = {}) => {
    sinais.push({ id: `${tipo}-${sinais.length + 1}`, tipo, t, texto, ...extras });
  };
  return { sinais, adicionar };
}

/** blur e visibilitychange podem descrever a mesma ausência: um único intervalo de evidência. */
function saidasUnicas(saidas: Saida[]): Saida[] {
  const lista: Saida[] = [];
  for (const s of [...saidas].filter((s) => Number.isFinite(s.t) && s.t >= 0 && Number.isFinite(s.duracaoMs) && s.duracaoMs > 0).sort((a, b) => a.t - b.t)) {
    const ultima = lista.at(-1);
    if (ultima && s.t <= ultima.t + ultima.duracaoMs) {
      ultima.duracaoMs = Math.max(ultima.t + ultima.duracaoMs, s.t + s.duracaoMs) - ultima.t;
    } else lista.push({ ...s });
  }
  return lista;
}

function registrarSaidas(c: ReturnType<typeof coletor>, saidas: Saida[]) {
  for (const s of saidas) c.adicionar("saida_de_foco", s.t, `saiu da ${s.motivo === "aba" ? "aba" : "janela"} por ${segundos(s.duracaoMs)} ${minuto(s.t)}`, { fim: s.t + s.duracaoMs });
}

function registrarTextos(c: ReturnType<typeof coletor>, sessaoId: string, textos: Texto[]) {
  const nome = nomeDoCanario(sessaoId);
  const primeiro = [...textos].sort((a, b) => a.t - b.t).find((x) => x.onde !== "na fala" && canarioApareceu(nome, x.texto));
  if (primeiro) c.adicionar("canario", primeiro.t, `o identificador do enunciado copiado apareceu ${primeiro.onde} ${minuto(primeiro.t)}`, { detalhe: nome });
  for (const i of tentativasEmTextos(textos)) c.adicionar("injecao", i.t, `apareceu texto dirigido à IA ${i.onde} ${minuto(i.t)}`, { detalhe: i.trecho });
}

/** Só foco + atividade posterior são independentes aqui. Dois derivados da mesma escrita nunca convergem. */
function concluir(sinais: SinalDeIntegridade[], dadosPresentes: boolean): BlocoDeIntegridade | null {
  if (!dadosPresentes && !sinais.length) return null;
  sinais.sort((a, b) => a.t - b.t);
  const destaques: BlocoDeIntegridade["destaques"] = sinais.filter((s) => s.tipo === "canario").map((s) => ({ texto: s.texto, t: s.t, sinais: [s.id] }));
  for (const foco of sinais.filter((s) => s.tipo === "saida_de_foco")) {
    const fim = foco.fim!;
    const perto = sinais.filter((s) => ["colagem_de_fora", "escrita_linear", "bloco_apos_saida"].includes(s.tipo) && s.t >= fim && s.t - fim <= LIMITES.depoisDaSaidaMs);
    const atividade = perto.find((s) => s.tipo === "bloco_apos_saida") ?? perto[0];
    if (atividade) destaques.push({ texto: `${foco.texto} e, ao voltar, ${atividade.texto}`, t: foco.t, sinais: [foco.id, atividade.id] });
  }
  return { sinais, destaques: destaques.sort((a, b) => a.t - b.t) };
}

export function integridadeDaIde(sessaoId: string, eventos: readonly SessionEvent[], starter = ""): BlocoDeIntegridade | null {
  const c = coletor();
  const ordenados = [...eventos].sort((a, b) => a.t - b.t);
  const saidas = saidasUnicas(ordenados.flatMap((e) => e.type === "foco" ? e.saidas : []));
  registrarSaidas(c, saidas);
  const textos: Texto[] = [];
  let codigo = starter;
  let anteriorDiferente = starter;
  let ultimaFoto = 0;
  let janela: { inicio: number; digitados: number; apagados: number; maior: number; linhas: number } | undefined;
  let dadosPresentes = false;
  for (const e of ordenados) {
    if (e.type === "foco") dadosPresentes = true;
    if (e.type === "paste") {
      dadosPresentes ||= e.origem !== undefined;
      if (colagemDeFora(e, codigo, anteriorDiferente)) c.adicionar("colagem_de_fora", e.t, `colou ${e.lines} ${e.lines === 1 ? "linha" : "linhas"} de fora ${minuto(e.t)}`);
      janela = undefined;
    }
    if (e.type === "speech" && e.role === "candidate") textos.push({ t: e.t, onde: "na fala", texto: e.text });
    if (e.type !== "snapshot") continue;
    textos.push({ t: e.t, onde: "no código", texto: e.code });
    const escrita = e.escrita;
    dadosPresentes ||= escrita !== undefined;
    const linhasNovas = Math.max(0, e.code.split("\n").length - codigo.split("\n").length);
    if (escrita && !escrita.voltouParaCima && escrita.digitados > 0 && escrita.apagados <= escrita.digitados * 0.05) {
      // Intervalo que atravessa uma saída não prova que a escrita ocorreu depois da volta.
      const atravessou = saidas.some((s) => s.t < e.t && s.t + s.duracaoMs > ultimaFoto);
      if (atravessou || (janela && e.t - janela.inicio > LIMITES.janelaEscritaMs)) janela = undefined;
      if (!atravessou) {
        janela ??= { inicio: ultimaFoto, digitados: 0, apagados: 0, maior: 0, linhas: 0 };
        janela.digitados += escrita.digitados;
        janela.apagados += escrita.apagados;
        janela.maior = Math.max(janela.maior, escrita.maiorTrechoSemPausa);
        janela.linhas += linhasNovas;
        if (janela.digitados >= LIMITES.digitados && janela.maior >= LIMITES.trechoSemPausa) {
          c.adicionar("escrita_linear", janela.inicio, `entraram ${janela.digitados} caracteres digitados de cima a baixo, com ${janela.apagados} apagados e sem voltar a linhas anteriores ${minuto(janela.inicio)}`, { fim: e.t });
          const foco = saidas.findLast((s) => s.t + s.duracaoMs <= janela!.inicio && janela!.inicio - s.t - s.duracaoMs <= LIMITES.depoisDaSaidaMs);
          if (foco) c.adicionar("bloco_apos_saida", janela.inicio, `entraram ${janela.linhas} linhas (${janela.digitados} caracteres digitados) em ${segundos(e.t - janela.inicio)} ${minuto(janela.inicio)}`, { fim: e.t });
          janela = undefined;
        }
      }
    } else janela = undefined;
    if (e.code !== codigo) anteriorDiferente = codigo;
    codigo = e.code;
    ultimaFoto = e.t;
  }
  registrarTextos(c, sessaoId, textos);
  return concluir(c.sinais, dadosPresentes);
}

/** Fallback das gravações antigas: só fatos ainda verificáveis no código e nas falas. */
export function integridadeDosTextos(sessaoId: string, textos: Texto[]): BlocoDeIntegridade | null {
  const c = coletor();
  registrarTextos(c, sessaoId, textos);
  return concluir(c.sinais, false);
}

function objeto(dados: unknown): Record<string, unknown> {
  return dados !== null && typeof dados === "object" ? dados as Record<string, unknown> : {};
}

export function integridadeDoQuadro(sessaoId: string, eventos: readonly EventoEntrada[], criadaEm: number): BlocoDeIntegridade | null {
  const c = coletor();
  const ordenados = [...eventos].sort((a, b) => Date.parse(a.horario) - Date.parse(b.horario));
  // Mesma régua de montarRelatorio: primeira mudança de fase, com criação como reserva.
  const inicio = Date.parse(ordenados.find((e) => e.tipo === "fase")?.horario ?? "") || criadaEm;
  const saidas: Saida[] = [];
  const textos: Texto[] = [];
  let dadosPresentes = false;
  for (const e of ordenados) {
    const d = objeto(e.dados);
    const t = Date.parse(e.horario) - inicio;
    if (!Number.isFinite(t) || t < 0) continue;
    if (e.tipo === "foco") {
      dadosPresentes = true;
      for (const item of Array.isArray(d.saidas) ? d.saidas : []) {
        const s = objeto(item);
        if (typeof s.inicio === "string" && typeof s.duracaoMs === "number" && (s.motivo === "aba" || s.motivo === "janela")) saidas.push({ t: Date.parse(s.inicio) - inicio, duracaoMs: s.duracaoMs, motivo: s.motivo });
      }
    }
    // O conversor do Excalidraw guarda textos das caixas e anotações em dados.grafo.
    if (e.tipo === "desenho" && typeof d.grafo === "string") textos.push({ t, onde: "numa caixa do quadro", texto: d.grafo });
    const falaDoCandidato = (e.tipo === "fala" && d.quem === "candidato") || (e.tipo === "resposta" && (d.quem === undefined || d.quem === "candidato"));
    if (falaDoCandidato && typeof d.texto === "string") textos.push({ t, onde: "na fala", texto: d.texto });
  }
  registrarSaidas(c, saidasUnicas(saidas));
  registrarTextos(c, sessaoId, textos);
  return concluir(c.sinais, dadosPresentes);
}
