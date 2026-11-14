// O workspace do recrutador: as vagas da empresa e o que já aconteceu em cada uma.
//   Rascunho (com o Totti) → Vaga publicada: Plano · Entrevistas · Escores
// Uma vaga só existe (e só aparece no menu) depois que o plano da entrevista é confirmado com o Totti.
// Antes disso ela é um rascunho, que dá para retomar. As vagas e rascunhos de partida vêm das vagas de
// exemplo (fixtures), todas de tecnologia (engenharia, dados e produto); o que o recrutador faz fica salvo no navegador (localStorage).
import { useCallback, useEffect, useState } from "react";
import type { InterviewConfig } from "@/lib/contracts";
import type { Vaga } from "@/lib/pre-entrevista/classificador";
import { cargoDe, contextoDe, descricaoDe, INICIAIS, SINTETICAS } from "./vitrine";
import { FUNIL_VAZIO, type Funil } from "./candidatos";

export type Area = "engenharia" | "dados" | "produto";
export type Senioridade = InterviewConfig["seniority"] | "estagio";
export type Etapa = "entrevistas" | "encerrada";

/** O que ficou combinado na pré-entrevista (o essencial para mostrar na vaga). */
export type Resumo = {
  configId: string;
  formato: InterviewConfig["mode"];
  duracaoMin: number;
  foco: { area: InterviewConfig["focus"][number]["area"]; peso: number }[];
  criterios?: number;
};

/** Uma vaga publicada: o plano está combinado e o link já pode ir para os candidatos. */
export type VagaEmpresa = {
  id: string;
  cargo: string;
  area: Area;
  senioridade: Senioridade;
  time: string;
  local: string;
  descricao: string;
  contexto?: string;
  /** Há quantos dias a vaga foi aberta (relativo, para a demonstração não envelhecer). */
  abertaHaDias: number;
  /**
   * Quando a vaga mexeu por último (ms): criação, plano publicado, convite enviado, relatório pronto. Ordena o painel.
   * Sem valor (vagas de exemplo), vale "agora menos `abertaHaDias`".
   */
  atualizadaEm?: number;
  /** Vaga de exemplo (fixture): na ordem "mais recentes" vem depois das reais. */
  mockada?: boolean;
  etapa: Etapa;
  resumo?: Resumo;
  /** Quantos se inscreveram, foram convidados, estão fazendo e concluíram a entrevista. */
  funil: Funil;
  /** Recrutador(a) responsável pela vaga. */
  responsavel: string;
  encerradaHaDias?: number;
  /** Quantas pessoas foram contratadas por esta vaga. Com valor, a vaga ganha a aba Contratações (ciclo dos 90 dias). */
  contratados?: number;
};

/** Uma vaga ainda sendo combinada com o Totti. Não aparece no menu até ser publicada. */
export type RascunhoVaga = {
  id: string;
  cargo: string;
  descricao: string;
  contexto?: string;
  sessaoId?: string;
  combinados?: { feitos: number; total: number };
  /** Quando mexeu por último (ms). Os rascunhos de partida usam `haDias`. */
  atualizadoEm?: number;
  haDias?: number;
};

export { NOME_SENIORIDADE_VAGA } from "./vitrine";

export const NOME_AREA_VAGA: Record<Area, string> = {
  engenharia: "Engenharia",
  dados: "Dados",
  produto: "Produto",
};

/** Formato em palavras neutras (o quadro serve para qualquer área, não só system design). */
export const NOME_FORMATO_VAGA: Record<InterviewConfig["mode"], string> = {
  system_design: "Desenho no quadro",
  live_coding: "Código ao vivo",
};



const deExemplo = (id: string, haDias: number): RascunhoVaga => ({
  id,
  cargo: cargoDe(id),
  descricao: descricaoDe(id),
  contexto: contextoDe(id),
  haDias,
});

/** Os rascunhos no primeiro acesso: vagas abertas que ainda não têm o plano da entrevista. */
const RASCUNHOS_INICIAIS: RascunhoVaga[] = [
  deExemplo("estagio-dados", 0),
  deExemplo("backend-senior-pagamentos", 1),
  {
    id: "pm-growth",
    cargo: "Product Manager Pleno — Growth",
    descricao: `Buscamos uma pessoa de produto para o time de Growth, responsável pela ativação e retenção de novos clientes.

Responsabilidades:
- Definir e priorizar o roadmap de ativação a partir de dados de funil e entrevistas com clientes
- Desenhar experimentos (A/B) e decidir com base nos resultados
- Trabalhar junto com design, engenharia e dados do problema até a entrega

Requisitos:
- 3+ anos como PM em produto digital
- Conforto com métricas de funil, coortes e SQL básico
- Boa escrita e clareza para alinhar várias áreas`,
    haDias: 3,
  },
  deExemplo("tech-lead-mobile", 4),
];


// ---------------------------------------------------------------------------
// Persistência no navegador: as mudanças por vaga, as vagas publicadas aqui e os rascunhos.
// ---------------------------------------------------------------------------

const CHAVE = "converge.workspace.v2";
type Salvo = { mudancas: Record<string, Partial<VagaEmpresa>>; novas: VagaEmpresa[]; rascunhos: RascunhoVaga[] };

function ler(): Salvo {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto) return JSON.parse(bruto) as Salvo;
  } catch {
    // localStorage indisponível ou corrompido: começa do zero.
  }
  return { mudancas: {}, novas: [], rascunhos: RASCUNHOS_INICIAIS };
}

function gravar(s: Salvo) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(s));
  } catch {
    // Sem espaço ou sem permissão: segue só na memória.
  }
  window.dispatchEvent(new Event(CHAVE));
}

function todas(s: Salvo): VagaEmpresa[] {
  const mockadas = [...INICIAIS, ...SINTETICAS].map((v) => ({ ...v, mockada: true }));
  return [...s.novas, ...mockadas].map((v) => ({ ...v, ...s.mudancas[v.id] }));
}

/** As vagas e os rascunhos. `null` enquanto ainda não leu o navegador (evita piscar o estado de partida). */
export function useVagas() {
  const [estado, setEstado] = useState<{ vagas: VagaEmpresa[]; rascunhos: RascunhoVaga[] } | null>(null);
  useEffect(() => {
    const atualizar = () => {
      const s = ler();
      setEstado({ vagas: todas(s), rascunhos: s.rascunhos });
    };
    atualizar();
    window.addEventListener(CHAVE, atualizar);
    window.addEventListener("storage", atualizar);
    return () => {
      window.removeEventListener(CHAVE, atualizar);
      window.removeEventListener("storage", atualizar);
    };
  }, []);

  const atualizar = useCallback((id: string, mudanca: Partial<VagaEmpresa>) => {
    const s = ler();
    s.mudancas[id] = { ...s.mudancas[id], ...mudanca };
    gravar(s);
  }, []);

  return { vagas: estado?.vagas ?? null, rascunhos: estado?.rascunhos ?? null, atualizar };
}

/**
 * Marca a vaga como mexida agora (sobe no "mais recentes"). Chame quando o plano é publicado (já feito em
 * `publicarVaga`), um convite sai ou um relatório fica pronto. Só navegador (localStorage); fora dele não faz nada.
 */
export function tocarVaga(id: string, quando: number = Date.now()) {
  if (typeof localStorage === "undefined") return;
  const s = ler();
  s.mudancas[id] = { ...s.mudancas[id], atualizadaEm: quando };
  gravar(s);
}

/** Lê um rascunho direto do navegador (para abrir o Totti já na conversa salva). */
export function lerRascunho(id: string): RascunhoVaga | undefined {
  return ler().rascunhos.find((r) => r.id === id);
}

function idPara(cargo: string) {
  const base = cargo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "vaga"}-${Date.now().toString(36)}`;
}

/** Guarda a vaga como rascunho quando a conversa com o Totti começa. Devolve o id. */
export function criarRascunho(vaga: Vaga): string {
  const id = idPara(vaga.roleTitle);
  const s = ler();
  s.rascunhos.unshift({
    id,
    cargo: vaga.roleTitle,
    descricao: vaga.jobDescription,
    contexto: vaga.context,
    atualizadoEm: Date.now(),
  });
  gravar(s);
  return id;
}

export function atualizarRascunho(id: string, mudanca: Partial<RascunhoVaga>) {
  const s = ler();
  s.rascunhos = s.rascunhos.map((r) => (r.id === id ? { ...r, ...mudanca, atualizadoEm: Date.now(), haDias: undefined } : r));
  gravar(s);
}

export function descartarRascunho(id: string) {
  const s = ler();
  s.rascunhos = s.rascunhos.filter((r) => r.id !== id);
  gravar(s);
}

/** Palavras que indicam a área de uma vaga nova (dá para ajustar depois). */
function areaProvavel(texto: string): Area {
  const t = texto.toLowerCase();
  if (/product manager|\bpm\b|produto|product owner|roadmap/.test(t)) return "produto";
  if (/dados|data|analytics|bi\b|etl/.test(t)) return "dados";
  return "engenharia";
}

function senioridadeProvavel(cargo: string, config: InterviewConfig): Senioridade {
  if (/estágio|estagio|estagiári/.test(cargo.toLowerCase())) return "estagio";
  return config.seniority;
}

/**
 * O plano foi confirmado: a vaga nasce (com o resumo do que foi combinado) e o rascunho sai.
 * Se o rascunho não existir mais, a vaga é criada a partir do próprio config. Devolve o id da vaga.
 */
/** Inscritos (de demonstração) que uma vaga recém-publicada já traz, para o envio automático de convites ter quem chamar. */
const INSCRITOS_NOVA_VAGA = 6;

/** Publica o rascunho como vaga e devolve a vaga criada (o estúdio dispara os convites logo em seguida). */
export function publicarVaga(rascunhoId: string | null, config: InterviewConfig): VagaEmpresa {
  const s = ler();
  const r = rascunhoId ? s.rascunhos.find((x) => x.id === rascunhoId) : undefined;
  const cargo = config.roleTitle || r?.cargo || "Vaga";
  const descricao = r?.descricao ?? "";
  const id = idPara(cargo);
  const vaga: VagaEmpresa = {
    id,
    cargo,
    area: areaProvavel(`${cargo}\n${descricao}`),
    senioridade: senioridadeProvavel(cargo, config),
    time: "—",
    local: "—",
    descricao,
    contexto: r?.contexto,
    abertaHaDias: 0,
    atualizadaEm: Date.now(),
    etapa: "entrevistas",
    resumo: {
      configId: config.id,
      formato: config.mode,
      duracaoMin: config.durationMin,
      foco: config.focus.map((f) => ({ area: f.area, peso: f.weight })),
      criterios: config.criteria.length,
    },
    funil: { ...FUNIL_VAZIO, inscritos: INSCRITOS_NOVA_VAGA },
    responsavel: "Você",
  };
  s.novas.unshift(vaga);
  s.rascunhos = s.rascunhos.filter((x) => x.id !== rascunhoId);
  gravar(s);
  return vaga;
}

// ---------------------------------------------------------------------------
// Vagas abertas por último (o menu lateral mostra só estas: com centenas de vagas, a lista
// completa fica na tela inicial, com busca e filtros).
// ---------------------------------------------------------------------------

const CHAVE_RECENTES = "converge.recentes.v1";

export function marcarRecente(id: string) {
  try {
    const atual = JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]") as string[];
    localStorage.setItem(CHAVE_RECENTES, JSON.stringify([id, ...atual.filter((x) => x !== id)].slice(0, 6)));
    window.dispatchEvent(new Event(CHAVE_RECENTES));
  } catch {
    // Sem localStorage: o menu só não lembra.
  }
}

export function useRecentes(): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const ler = () => {
      try {
        setIds(JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]") as string[]);
      } catch {
        setIds([]);
      }
    };
    ler();
    window.addEventListener(CHAVE_RECENTES, ler);
    return () => window.removeEventListener(CHAVE_RECENTES, ler);
  }, []);
  return ids;
}

// ---------------------------------------------------------------------------
// Leitura para a tela: as etapas de uma vaga publicada e frases curtas sobre ela.
// ---------------------------------------------------------------------------

// Na ordem em que a recrutadora usa: o que decidir, quem está no processo, o plano e o resto.
export const ETAPAS_VAGA = ["escores", "entrevistas", "plano", "aprendizado", "contratacoes"] as const;
export type EtapaVaga = (typeof ETAPAS_VAGA)[number];

export const NOME_ETAPA: Record<EtapaVaga, string> = {
  plano: "Plano da entrevista",
  entrevistas: "Candidatos",
  escores: "Para decidir",
  aprendizado: "O que o Totti aprendeu",
  contratacoes: "Contratações",
};

/** As abas desta vaga: Contratações só aparece quando a vaga contratou alguém. */
export function etapasDa(v: Pick<VagaEmpresa, "contratados">): EtapaVaga[] {
  return ETAPAS_VAGA.filter((e) => e !== "contratacoes" || !!v.contratados);
}

/** Número com separador de milhar (70.412). */
export const numero = (n: number) => n.toLocaleString("pt-BR");

/** Número curto para espaços apertados (70,4 mil). */
export const numeroCurto = (n: number) =>
  n >= 10_000 ? `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : numero(n);

/** O número ao lado de cada etapa no menu (o plano não tem número). */
export function contagemDa(v: VagaEmpresa, etapa: EtapaVaga): number | null {
  if (etapa === "entrevistas") return v.funil.inscritos;
  // "Para decidir" conta quem espera decisão; numa vaga encerrada, quem concluiu.
  if (etapa === "escores") return v.etapa === "encerrada" ? v.funil.concluiram : v.funil.novos;
  if (etapa === "contratacoes") return v.contratados ?? null;
  return null;
}

/** Relatórios que acabaram de chegar: é o que o avaliador deve olhar primeiro. */
export const novosDa = (v: VagaEmpresa) => (v.etapa === "encerrada" ? 0 : v.funil.novos);

/** A partir de que fração dos convidados entrevistados a vaga sai de "Totti cuidando" e vai para a decisão. */
export const FRACAO_PARA_DECIDIR = 0.5;

/** Quanto dos convidados já fez a entrevista (0 a 1). Sem convidados ainda, conta como nada feito. */
export function fracaoEntrevistada(v: Pick<VagaEmpresa, "funil">): number {
  const f = v.funil;
  return f.convidados ? Math.min(1, f.concluiram / f.convidados) : 0;
}

/**
 * A vaga está pronta para a recrutadora decidir: tem relatório esperando e pelo menos metade dos convidados
 * já foi entrevistada. Antes disso, decidir é comparar poucos candidatos; a vaga segue com o Totti.
 */
export const prontaParaDecidir = (v: VagaEmpresa) => novosDa(v) > 0 && fracaoEntrevistada(v) >= FRACAO_PARA_DECIDIR;

const dias = (n: number) => (n === 0 ? "hoje" : n === 1 ? "ontem" : `há ${n} dias`);

export function diasDoRascunho(r: RascunhoVaga): number {
  if (r.atualizadoEm) return Math.max(0, Math.floor((Date.now() - r.atualizadoEm) / 86_400_000));
  return r.haDias ?? 0;
}

/** Uma frase curta sobre a situação da vaga. */
export function situacaoDa(v: VagaEmpresa): string {
  const f = v.funil;
  if (v.etapa === "encerrada") return `Encerrada ${dias(v.encerradaHaDias ?? 0)} · ${numero(f.concluiram)} entrevistas`;
  if (f.inscritos === 0) return "Link pronto · nenhum inscrito ainda";
  return `${numero(f.inscritos)} ${f.inscritos === 1 ? "inscrito" : "inscritos"} · ${numero(f.concluiram)} ${
    f.concluiram === 1 ? "entrevista feita" : "entrevistas feitas"
  }`;
}

/** Uma frase curta sobre o rascunho. */
export function situacaoDoRascunho(r: RascunhoVaga): string {
  if (!r.sessaoId) return "Ainda não começou com o Totti";
  if (r.combinados && r.combinados.feitos > 0) return `${r.combinados.feitos} de ${r.combinados.total} pontos combinados`;
  return "Conversa com o Totti começou";
}

export { dias as quandoFoi };

// ---------------------------------------------------------------------------
// Estágio de cada vaga na tela inicial, em ordem cronológica (a pipeline):
//   Definir escopo (rascunho com o Totti) → Aguardando entrevistas → Ver resultados
// Não há estágio de "enviar convites": ao publicar, os convites saem sozinhos (EnvioConvites).
// ---------------------------------------------------------------------------

export const ESTAGIOS = ["escopo", "aguardando", "resultados"] as const;
export type Estagio = (typeof ESTAGIOS)[number];

export const NOME_ESTAGIO: Record<Estagio, string> = {
  escopo: "Definir escopo",
  aguardando: "Aguardando entrevistas",
  resultados: "Ver resultados",
};

/** O que acontece em cada estágio, numa linha. */
export const DICA_ESTAGIO: Record<Estagio, string> = {
  escopo: "Termine o plano com o Totti",
  aguardando: "Os candidatos estão fazendo",
  resultados: "Relatórios para revisar",
};

/** O estágio de uma vaga publicada (encerradas ficam fora do quadro). Funil já com convites e entrevistas reais. */
export function estagioDa(v: VagaEmpresa): Exclude<Estagio, "escopo"> | "encerrada" {
  if (v.etapa === "encerrada") return "encerrada";
  const f = v.funil;
  if (f.novos > 0) return "resultados";
  // Publicada e sem convite ainda: os convites são automáticos, então a vaga já está esperando os candidatos.
  if (f.convidados === 0) return "aguardando";
  if (f.emAndamento === 0 && f.concluiram >= f.convidados) return "resultados";
  return "aguardando";
}

// ---------------------------------------------------------------------------
// Painel executivo da tela inicial: os grandes números somados das vagas abertas,
// os recortes rápidos da lista (com contagem) e a ordenação.
// ---------------------------------------------------------------------------

/** A partir de quantos inscritos a vaga conta como de alto volume. */
export const ALTO_VOLUME = 1_000;

/** Nome curto do formato, para etiquetas e filtros (o produto é de tecnologia). */
export const NOME_FORMATO_CURTO: Record<InterviewConfig["mode"], string> = {
  system_design: "System design",
  live_coding: "Live coding",
};

export type Totais = {
  /** Vagas abertas (encerradas ficam fora da soma). */
  vagas: number;
  inscritos: number;
  convidados: number;
  /** Entrevistas concluídas com o Totti. */
  entrevistados: number;
  emAndamento: number;
  /** Relatórios prontos esperando o parecer da recrutadora. */
  pendentes: number;
  vagasComPendentes: number;
};

/** Soma o funil das vagas abertas. */
export function totaisDas(vagas: VagaEmpresa[]): Totais {
  const abertas = vagas.filter((v) => v.etapa !== "encerrada");
  const soma = (f: (v: VagaEmpresa) => number) => abertas.reduce((t, v) => t + f(v), 0);
  return {
    vagas: abertas.length,
    inscritos: soma((v) => v.funil.inscritos),
    convidados: soma((v) => v.funil.convidados),
    entrevistados: soma((v) => v.funil.concluiram),
    emAndamento: soma((v) => v.funil.emAndamento),
    pendentes: soma(novosDa),
    vagasComPendentes: abertas.filter((v) => novosDa(v) > 0).length,
  };
}

/** Porcentagem para ler de relance: uma casa abaixo de 10% ("0,4%"), inteira acima ("31%"). */
export function porcento(parte: number, todo: number): string {
  if (!todo || !parte) return "0%";
  const p = (parte / todo) * 100;
  if (p < 0.1) return "<0,1%";
  return `${p.toLocaleString("pt-BR", { maximumFractionDigits: p < 10 ? 1 : 0 })}%`;
}

/** As abas da lista: o estado da vaga, na ordem em que ela pede a recrutadora. */
export const RECORTES_RAPIDOS = ["todas", "pendentes", "em_entrevista", "escopo"] as const;
/** Fora das abas: "encerradas" vem do link no fim da lista; os outros ainda abrem por link antigo (?recorte=). */
export type Recorte =
  | (typeof RECORTES_RAPIDOS)[number]
  | "com_relatorios"
  | "encerradas"
  | "alto_volume"
  | "live_coding"
  | "system_design";

export const NOME_RECORTE: Record<Recorte, string> = {
  todas: "Todas",
  pendentes: "Precisam de você",
  em_entrevista: "Em entrevista",
  alto_volume: `Alto volume (+${numero(ALTO_VOLUME)})`,
  live_coding: NOME_FORMATO_CURTO.live_coding,
  system_design: NOME_FORMATO_CURTO.system_design,
  escopo: "Em definição",
  com_relatorios: "Com entrevistas feitas",
  encerradas: "Encerradas",
};

/** Se a vaga entra no recorte. Escopos (rascunhos) não são vagas: o recorte "escopo" é tratado pela tela. */
export function noRecorte(v: VagaEmpresa, r: Recorte): boolean {
  if (r === "encerradas") return v.etapa === "encerrada";
  if (v.etapa === "encerrada") return false;
  switch (r) {
    case "todas":
      return true;
    case "pendentes":
      return novosDa(v) > 0;
    case "em_entrevista":
      return estagioDa(v) === "aguardando";
    case "com_relatorios":
      return v.funil.concluiram > 0;
    case "alto_volume":
      return v.funil.inscritos >= ALTO_VOLUME;
    case "live_coding":
    case "system_design":
      return v.resumo?.formato === r;
    case "escopo":
      return false;
  }
}

/** O estágio antigo da URL (?estagio=...) vira o recorte equivalente. */
export function recorteDaUrl(valor: string | null): Recorte {
  const antigos: Record<string, Recorte> = { escopo: "escopo", aguardando: "em_entrevista", resultados: "pendentes" };
  if (!valor) return "todas";
  if (valor in antigos) return antigos[valor];
  return valor in NOME_RECORTE ? (valor as Recorte) : "todas";
}

export const ORDENS = ["inscritos", "pendentes", "recentes", "az"] as const;
export type OrdemVagas = (typeof ORDENS)[number];

export const NOME_ORDEM: Record<OrdemVagas, string> = {
  inscritos: "Maior volume de inscritos",
  pendentes: "Mais decisões pendentes",
  recentes: "Mais recentes",
  az: "Ordem alfabética (A–Z)",
};

const DIA_MS = 86_400_000;

/** Quando a vaga mexeu por último; as de exemplo, sem registro, valem "agora menos os dias de abertas". */
export const atualizadaEmDe = (v: Pick<VagaEmpresa, "atualizadaEm" | "abertaHaDias">, agora = Date.now()) =>
  v.atualizadaEm ?? agora - v.abertaHaDias * DIA_MS;

/** Comparador da lista; o empate cai no volume de inscritos e depois no nome. */
export function compararVagas(ordem: OrdemVagas, agora = Date.now()): (a: VagaEmpresa, b: VagaEmpresa) => number {
  const porNome = (a: VagaEmpresa, b: VagaEmpresa) => a.cargo.localeCompare(b.cargo, "pt-BR");
  const porVolume = (a: VagaEmpresa, b: VagaEmpresa) => b.funil.inscritos - a.funil.inscritos || porNome(a, b);
  if (ordem === "az") return porNome;
  // Mais recentes: as reais antes das de exemplo; dentro de cada grupo, a que mexeu por último primeiro.
  if (ordem === "recentes")
    return (a, b) =>
      Number(!!a.mockada) - Number(!!b.mockada) || atualizadaEmDe(b, agora) - atualizadaEmDe(a, agora) || porVolume(a, b);
  if (ordem === "pendentes") return (a, b) => novosDa(b) - novosDa(a) || porVolume(a, b);
  return porVolume;
}
