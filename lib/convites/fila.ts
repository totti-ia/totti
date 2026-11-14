/**
 * Fila de convites no servidor. Só servidor.
 *
 * O recrutador não espera cada e-mail: `POST /api/convites` grava um lote (no `kvPadrao`: Supabase quando configurado,
 * memória caso contrário) e devolve na hora `{ lote, total }`. Quem manda de fato é `processarLote`, chamado a cada
 * consulta de progresso (`GET /api/convites/lote/<id>`, que o painel faz por polling) ou por um cron: processa um
 * bloco por vez e respeita um limite de envios por minuto, então 5 mil inscritos saem aos poucos sem estourar o provedor.
 * Falhas ficam no lote e podem ser reenviadas (`reenviarFalhas`).
 */
import { randomBytes } from "node:crypto";
import { kvPadrao } from "@/lib/storage/kv";

const NAMESPACE = "convites-lote";
const ID_VALIDO = /^[a-f0-9]{24}$/;

/** Quantos convites saem por minuto (e-mail de verdade e simulados contam igual: o gargalo é o servidor). */
export const limitePorMinuto = () => (Number(process.env.CONVITES_POR_MINUTO) > 0 ? Number(process.env.CONVITES_POR_MINUTO) : 120);
/** Quantos convites cada passada do worker processa, no máximo. */
export const TAMANHO_DO_BLOCO = 25;
/** Uma passada travada (instância que caiu) é liberada depois disso. */
const TRAVA_MS = 30_000;

export type StatusItem = "pendente" | "enviado" | "simulado" | "erro";

export type ItemDoLote = {
  nome: string;
  email: string;
  testador?: boolean;
  /** Recebe e-mail de verdade (decidido ao enfileirar, porque a cota do testador só pode ser gasta uma vez). */
  real: boolean;
  /** Token do convite, fixo desde o início para o link não mudar no reenvio. */
  token: string;
  status: StatusItem;
  motivo?: string;
  link?: string;
  tentativas: number;
};

export type Lote = {
  id: string;
  vagaId: string;
  cargo: string;
  configId: string;
  mode: "live_coding" | "system_design";
  durationMin: number;
  languages: string[];
  /** Endereço público para montar os links de agendamento. */
  base: string;
  criadoEm: number;
  itens: ItemDoLote[];
  /** Janela do limite por minuto. */
  janela: { inicio: number; usados: number };
  /** Enquanto houver uma passada em andamento, até quando ela vale. */
  travadoAte?: number;
};

export type Progresso = {
  lote: string;
  total: number;
  /** Convites que já saíram (e-mail ou demonstração). */
  enviados: number;
  falharam: number;
  pendentes: number;
  concluido: boolean;
  /** E-mails dos que falharam (até 100), para o painel não marcar esses como convidados. */
  falhas: string[];
};

export type DadosDoLote = Omit<Lote, "id" | "criadoEm" | "itens" | "janela" | "travadoAte">;
export type NovoItem = Pick<ItemDoLote, "nome" | "email" | "real"> & { testador?: boolean };

/** Manda um convite. Injetável: os testes não enviam e-mail de verdade. Lança em caso de falha. */
export type Enviador = (lote: Lote, item: ItemDoLote) => Promise<{ status: "enviado" | "simulado"; motivo?: string }>;

export const loteIdValido = (id: string) => ID_VALIDO.test(id);

export async function lerLote(id: string): Promise<Lote | null> {
  if (!ID_VALIDO.test(id)) return null;
  return kvPadrao().get<Lote>(NAMESPACE, id);
}

const gravar = (l: Lote) => kvPadrao().set(NAMESPACE, l.id, l);

/** Grava o lote com todos os itens pendentes. Não envia nada. */
export async function enfileirar(dados: DadosDoLote, itens: NovoItem[], agora = Date.now()): Promise<{ lote: string; total: number }> {
  const lote: Lote = {
    ...dados,
    id: randomBytes(12).toString("hex"),
    criadoEm: agora,
    janela: { inicio: agora, usados: 0 },
    itens: itens.map((i) => ({
      ...i,
      email: i.email.toLowerCase(),
      token: randomBytes(16).toString("hex"),
      status: "pendente",
      tentativas: 0,
    })),
  };
  await gravar(lote);
  return { lote: lote.id, total: lote.itens.length };
}

export function progressoDe(l: Lote): Progresso {
  const enviados = l.itens.filter((i) => i.status === "enviado" || i.status === "simulado").length;
  const falhas = l.itens.filter((i) => i.status === "erro");
  const pendentes = l.itens.filter((i) => i.status === "pendente").length;
  return {
    lote: l.id,
    total: l.itens.length,
    enviados,
    falharam: falhas.length,
    pendentes,
    concluido: pendentes === 0,
    falhas: falhas.slice(0, 100).map((i) => i.email),
  };
}

/** Quantos ainda cabem na janela de um minuto (e abre outra quando a anterior passou). */
function cota(l: Lote, agora: number): number {
  if (agora - l.janela.inicio >= 60_000) l.janela = { inicio: agora, usados: 0 };
  return Math.max(0, limitePorMinuto() - l.janela.usados);
}

/**
 * Processa um bloco de pendentes: no máximo `TAMANHO_DO_BLOCO`, e nunca mais que a cota do minuto.
 * Duas passadas ao mesmo tempo não se atropelam (trava curta); a segunda só devolve o progresso.
 * Com `soEstes`, processa apenas esses e-mails (o testador, que recebe na hora), sem gastar a cota.
 */
export async function processarLote(
  id: string,
  enviar: Enviador,
  opcoes: { agora?: () => number; bloco?: number; soEstes?: (i: ItemDoLote) => boolean } = {},
): Promise<Progresso | null> {
  const agora = opcoes.agora ?? Date.now;
  const lote = await lerLote(id);
  if (!lote) return null;
  const t0 = agora();
  if (lote.travadoAte && lote.travadoAte > t0) return progressoDe(lote);

  const pendentes = lote.itens.filter((i) => i.status === "pendente");
  const alvo = opcoes.soEstes
    ? pendentes.filter(opcoes.soEstes)
    : pendentes.slice(0, Math.min(opcoes.bloco ?? TAMANHO_DO_BLOCO, cota(lote, t0)));
  if (alvo.length === 0) return progressoDe(lote);

  lote.travadoAte = t0 + TRAVA_MS;
  if (!opcoes.soEstes) lote.janela.usados += alvo.length;
  await gravar(lote);

  for (const item of alvo) {
    item.tentativas += 1;
    try {
      const r = await enviar(lote, item);
      item.status = r.status;
      item.motivo = r.motivo;
    } catch (err) {
      item.status = "erro";
      item.motivo = err instanceof Error ? err.message.slice(0, 160) : "falha desconhecida";
    }
    item.link = `${lote.base}/agendar/${item.token}`;
  }
  delete lote.travadoAte;
  await gravar(lote);
  return progressoDe(lote);
}

/** Põe de volta na fila os convites que falharam. Devolve quantos voltaram. */
export async function reenviarFalhas(id: string): Promise<{ reenfileirados: number; progresso: Progresso } | null> {
  const lote = await lerLote(id);
  if (!lote) return null;
  let n = 0;
  for (const i of lote.itens) {
    if (i.status !== "erro") continue;
    i.status = "pendente";
    delete i.motivo;
    n += 1;
  }
  if (n > 0) await gravar(lote);
  return { reenfileirados: n, progresso: progressoDe(lote) };
}
