// Repositório das sessões do cérebro em cima do `Kv` (Supabase em produção, memória nos testes) e do
// armazenamento de arquivos (desenhos). Cada coisa tem a sua chave, então as escritas concorrentes de
// partes diferentes (estado, contador de análises, eventos, imagens) não se sobrescrevem.
//
//   sessao / <id>            a sessão (id, avaliação, candidato, criação): não muda depois de criada
//   estado / <id>            o estado da máquina (muda a cada análise: uma só ida ao banco para salvar)
//   analises / <id>          { n } contador de análises (limite de abuso)
//   evento:<id> / <chave>    um evento por linha; a chave (horário|tipo|hash) dá a idempotência
//   imagem:<id> / <0001>     metadados do desenho; os bytes vão para o Storage (<id>/<n>.png)
//   scorecard / <id>         o scorecard
import { randomUUID } from "node:crypto";
import type { ArmazenamentoDeArquivos } from "@/lib/storage/arquivos";
import type { Kv } from "@/lib/storage/kv";
import type { Scorecard } from "../scorecard";
import { chaveDoEvento } from "./memoria";
import {
  ErroLimite,
  type EventoArmazenado,
  type RepositorioSessoes,
  type SessaoArmazenada,
} from "./repositorio";

const MAX_IMAGENS_POR_SESSAO = 60;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,80}$/;

type SessaoGravada = Omit<SessaoArmazenada, "analises" | "estado">;
type EventoGravado = { evento: EventoArmazenado; ordem: number };

/** Ordem dos eventos: crescente neste processo, mesmo para lotes no mesmo milissegundo (e ~1000 por ms entre processos). */
let ultimaOrdem = 0;
const proximaOrdem = () => (ultimaOrdem = Math.max(ultimaOrdem + 1, Date.now() * 1000));

const nsEvento = (id: string) => `evento:${id}`;
const nsImagem = (id: string) => `imagem:${id}`;
const numeroComoChave = (n: number) => String(n).padStart(4, "0");
const caminhoDaImagem = (id: string, n: number) => `${id}/${n}.png`;
// A chave e o caminho fixos tornam a substituição da foto final idempotente mesmo sob concorrência.
const CHAVE_FINAL = "final";
const NUMERO_FINAL = Number.MAX_SAFE_INTEGER;

export function criarRepositorioKv(kv: Kv, arquivos: ArmazenamentoDeArquivos): RepositorioSessoes {
  const sessaoExiste = async (id: string) => ID_VALIDO.test(id) && (await kv.get<SessaoGravada>("sessao", id)) !== null;

  return {
    async criar({ avaliacaoId, candidatoId, estado }) {
      const sessao: SessaoGravada = { id: randomUUID(), avaliacaoId, candidatoId, criadaEm: Date.now() };
      // O estado e o contador primeiro: quem enxerga a sessão já os encontra.
      await Promise.all([kv.set("estado", sessao.id, structuredClone(estado)), kv.set("analises", sessao.id, { n: 0 })]);
      await kv.set("sessao", sessao.id, sessao);
      return { ...sessao, estado: structuredClone(estado), analises: 0 };
    },

    // Uma ida ao banco (as três leituras vão juntas).
    async obter(id) {
      if (!ID_VALIDO.test(id)) return null;
      const [sessao, estado, analises] = await Promise.all([
        kv.get<SessaoGravada>("sessao", id),
        kv.get<SessaoArmazenada["estado"]>("estado", id),
        kv.get<{ n: number }>("analises", id),
      ]);
      return sessao && estado ? { ...sessao, estado, analises: analises?.n ?? 0 } : null;
    },

    // Uma ida ao banco. Quem chama só salva o estado de uma sessão que acabou de obter.
    async salvarEstado(id, estado) {
      if (ID_VALIDO.test(id)) await kv.set("estado", id, structuredClone(estado));
    },

    // Duas idas ao banco: o contador só existe para sessões criadas, então ler já diz se a sessão existe.
    async contarAnalise(id) {
      if (!ID_VALIDO.test(id)) return 0;
      const atual = await kv.get<{ n: number }>("analises", id);
      if (!atual) return 0;
      await kv.set("analises", id, { n: atual.n + 1 });
      return atual.n + 1;
    },

    async anexarEventos(id, eventos) {
      if (!(await sessaoExiste(id))) return [];
      const ordens = eventos.map(() => proximaOrdem());
      const resultados = await Promise.all(
        eventos.map(async (e, i) => {
          const evento: EventoArmazenado = { ...structuredClone(e), recebidoEm: Date.now() };
          const gravado: EventoGravado = { evento, ordem: ordens[i] };
          const novo = await kv.setIfAbsent(nsEvento(id), chaveDoEvento(e), gravado);
          return novo ? evento : null;
        }),
      );
      return resultados.filter((e): e is EventoArmazenado => e !== null);
    },

    async listarEventos(id) {
      if (!ID_VALIDO.test(id)) return [];
      const linhas = await kv.list<EventoGravado>(nsEvento(id));
      return linhas.sort((a, b) => a.value.ordem - b.value.ordem).map((l) => l.value.evento);
    },

    async salvarImagem(id, imagem, opcoes = {}) {
      if (!(await sessaoExiste(id))) throw new ErroLimite("sessão inexistente");
      const existentes = await kv.list(nsImagem(id));
      const final = opcoes.final ?? imagem.final ?? false;
      if (!final && existentes.filter((i) => (i.value as { final?: boolean }).final !== true).length >= MAX_IMAGENS_POR_SESSAO) throw new ErroLimite("limite de imagens da sessão");
      const numero = final ? NUMERO_FINAL : existentes.reduce((m, i) => {
        const meta = i.value as { numero: number; final?: boolean };
        return Math.max(m, meta.final ? 0 : meta.numero);
      }, 0) + 1;
      await arquivos.salvar(caminhoDaImagem(id, numero), imagem.bytes, "image/png");
      await kv.set(nsImagem(id), final ? CHAVE_FINAL : numeroComoChave(numero), { numero, horario: imagem.horario, bytes: imagem.bytes.byteLength, final });
      return numero;
    },

    async obterImagem(id, numero) {
      if (!ID_VALIDO.test(id) || !Number.isInteger(numero) || numero < 1) return null;
      const meta = await kv.get<{ horario: string; final?: boolean }>(nsImagem(id), numero === NUMERO_FINAL ? CHAVE_FINAL : numeroComoChave(numero));
      if (!meta) return null;
      const bytes = await arquivos.obter(caminhoDaImagem(id, numero));
      return bytes ? { bytes, horario: meta.horario, final: meta.final } : null;
    },

    async listarImagens(id) {
      if (!ID_VALIDO.test(id)) return [];
      const linhas = await kv.list<{ numero: number; horario: string; final?: boolean }>(nsImagem(id));
      return linhas.sort((a, b) => Number((a.value as { final?: boolean }).final) - Number((b.value as { final?: boolean }).final) || (a.value as { numero: number }).numero - (b.value as { numero: number }).numero)
        .map((l) => ({ numero: l.value.numero, horario: l.value.horario }));
    },

    async salvarScorecard(id, scorecard) {
      if (ID_VALIDO.test(id) && (await sessaoExiste(id))) await kv.set("scorecard", id, scorecard);
    },

    async obterScorecard(id) {
      return ID_VALIDO.test(id) ? kv.get<Scorecard>("scorecard", id) : null;
    },
  };
}
