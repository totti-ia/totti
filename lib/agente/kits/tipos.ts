/**
 * Kit de avaliação: o que muda de uma área para outra (dados, não código).
 * Só existe no servidor: a ficha de requisitos e a rubrica NUNCA vão ao navegador.
 */
import { z } from "zod";

/** Um critério da rubrica, com a descrição fixa de cada nota (1 a 4). */
export const Criterio = z.object({
  id: z.string(), // ex.: "escalabilidade" (é o `criterio` das observações)
  nome: z.string(),
  /** Descrição de cada nota; dá consistência ao agente e explica a nota ao recrutador. */
  niveis: z.object({ 1: z.string(), 2: z.string(), 3: z.string(), 4: z.string() }),
});
/**
 * `provaSoPorFala` fica fora do schema Zod de propósito (como o empecilho do problema): o gerador de kits roda
 * em modo estrito e não deve ser forçado a preenchê-lo. Quando true, o critério só se prova com fala do
 * candidato (desenho não vale) e não tem pergunta própria: aparece nas respostas aos outros critérios.
 */
export type Criterio = z.infer<typeof Criterio> & {
  provaSoPorFala?: boolean;
  /** O que a recrutadora escreveu sobre o critério (só critérios do plano da vaga). Dado, não instrução. */
  descricao?: string;
  /** Peso dado pela recrutadora (só critérios do plano). Informa o prompt; a nota geral segue a média simples. */
  peso?: number;
  /** O critério é do plano da vaga (o `id` é o nome exato dele). Falso/ausente: rubrica fixa do kit. */
  doPlano?: boolean;
  /** O critério só tem o que avaliar se o Totti puxou o assunto: sem a provocação na linha do tempo, não há nota. */
  provocadoPor?: Provocacao;
};

/** O que o Totti precisa puxar para o critério poder ser avaliado (o candidato não é julgado por só responder quando perguntado). */
export type Provocacao = "escopo" | "mudanca" | "falhas";

/** Pergunta provável do candidato e a resposta oficial (a "ficha de requisitos ocultos"). */
export const ItemFicha = z.object({ pergunta: z.string(), resposta: z.string() });

export const Problema = z.object({
  id: z.string(), // ex.: "encurtador_url"
  titulo: z.string(),
  /** Vago de propósito: perguntar antes de desenhar é o primeiro sinal avaliado. */
  enunciado: z.string(),
  /**
   * O que o entrevistador FALA ao abrir a sessão: uma apresentação natural do tema, em pt-BR falado
   * (não a leitura do enunciado). Público como o enunciado: sem números da ficha. Opcional: sem ele
   * o quadro monta uma fala simples a partir do título e do enunciado.
   */
  falaDoDesafio: z.string().optional(),
  ficha: z.array(ItemFicha),
  sinaisEsperados: z.array(z.string()),
  /** O que uma solução fraca costuma ter; vira pergunta. */
  armadilhas: z.array(z.string()),
  perguntasSugeridas: z.array(z.string()),
});
/**
 * Empecilho do quadro: no meio da entrevista o entrevistador traz UMA mudança no problema (um requisito muda,
 * entra uma restrição nova ou cai uma parte do sistema). Vem de três lugares: escrito à mão no kit (problemas
 * fixos); criado pelo gerador da questão da vaga (regras em `validar.ts`, `empecilhoGerado`); ou uma das genéricas
 * do kit de system design (`empecilhos-genericos.ts`) quando o problema não tem um. Fica fora do schema Zod de
 * propósito: o gerador de kits (modo estrito, todo campo obrigatório) não deve ser forçado a criar um. Só servidor
 * até ser anunciado.
 */
export type Empecilho = {
  id: string;
  tipo: "requisito_muda" | "restricao_nova" | "parte_cai";
  /** O que o entrevistador fala, em pt-BR falado. Termina deixando a bola com o candidato. */
  fala: string;
  /** O que ele escreve no quadro, como requisito novo (até 50 caracteres). */
  requisito: string;
  /** O que a mudança pede do desenho (para a análise e o scorecard; nunca falado). */
  exige: string;
};

export type Problema = z.infer<typeof Problema> & { empecilho?: Empecilho };

export const TipoPergunta = z.object({ nome: z.string(), exemplo: z.string(), revela: z.string() });

export const Kit = z.object({
  id: z.string(), // ex.: "system_design"
  /** Aparece no cartão de início: "Entrevista de {area}". */
  area: z.string(),
  /** Quem o entrevistador "é". */
  persona: z.string(),
  tipoEntrevista: z.string(),
  /** Como o quadro é lido (2.5.1 do planejamento). */
  modoLeitura: z.enum(["grafo", "visual", "misto"]),
  criterios: z.array(Criterio).min(1),
  tiposPergunta: z.array(TipoPergunta),
  termosTranscricao: z.array(z.string()),
  problemas: z.array(Problema).min(1),
});
export type Kit = Omit<z.infer<typeof Kit>, "problemas" | "criterios"> & { problemas: Problema[]; criterios: Criterio[] };

/** Minúsculas e sem acento ("Comunicação" -> "comunicacao"). */
export function semAcento(texto: string): string {
  let out = "";
  for (const ch of texto.normalize("NFD")) {
    const cod = ch.codePointAt(0) ?? 0;
    if (cod >= 0x300 && cod <= 0x36f) continue;
    out += ch;
  }
  return out.toLowerCase();
}

/** Palavras de um texto (sequências de letras, em minúsculas e sem acento). */
export function palavrasSemAcento(texto: string): string[] {
  const palavras: string[] = [];
  let atual = "";
  for (const ch of semAcento(texto)) {
    if (ch >= "a" && ch <= "z") atual += ch;
    else if (atual) {
      palavras.push(atual);
      atual = "";
    }
  }
  if (atual) palavras.push(atual);
  return palavras;
}

/**
 * O critério só se prova por fala? Vale o campo do critério. Sem o campo (kits já salvos), o nome antigo (com o termo interno entre
 * parênteses) continua sendo reconhecido para esses kits não mudarem de comportamento. O id não muda.
 */
export function criterioSoPorFala(c: Pick<Criterio, "id"> & Partial<Pick<Criterio, "nome" | "provaSoPorFala">>): boolean {
  if (c.provaSoPorFala !== undefined) return c.provaSoPorFala;
  const nome = semAcento(c.nome ?? "");
  const palavras = palavrasSemAcento(nome);
  if (palavras.some((p) => p === "plins" || p === "oral" || p === "verbal")) return true;
  const ini = nome.indexOf("comunicacao");
  return ini >= 0 && palavrasSemAcento(nome.slice(ini + "comunicacao".length)).includes("respostas");
}

/** Critério sem pergunta própria: fica fora da cobertura e nunca vira alvo (o id "comunicacao" sempre foi assim). */
export function criterioIndireto(c: Pick<Criterio, "id"> & Partial<Pick<Criterio, "nome" | "provaSoPorFala">>): boolean {
  return c.provaSoPorFala ?? (c.id === "comunicacao" || criterioSoPorFala(c));
}

/**
 * Kit salvo antes da renomeação (vagas já criadas): o critério de comunicação guarda o nome antigo, com o termo
 * interno. Devolve o mesmo kit com o nome legível e o campo novo, sem mudar o id (o scorecard e as configs
 * guardam só o id). Kit sem o nome antigo volta intacto (o mesmo objeto).
 */
export function kitSemTermosInternos<K extends Pick<Kit, "criterios">>(kit: K): K {
  const temPlins = (texto: string) => palavrasSemAcento(texto).some((p) => p === "plin" || p === "plins");
  const antigo = (c: Criterio) => temPlins(c.nome);
  if (!kit.criterios.some(antigo)) return kit;
  return {
    ...kit,
    criterios: kit.criterios.map((c) => {
      if (!antigo(c)) return c;
      // Tira o último parêntese do nome quando é ele que traz o termo interno.
      let nome = c.nome.trim();
      const abre = nome.lastIndexOf("(");
      if (nome.endsWith(")") && abre >= 0 && temPlins(nome.slice(abre + 1, -1))) nome = nome.slice(0, abre).trim();
      return { ...c, nome: nome || "Comunicação", ...(criterioSoPorFala(c) ? { provaSoPorFala: true } : {}) };
    }),
  };
}


// ---------------------------------------------------------------------------------------------
// Rubrica da vaga: os critérios do plano da recrutadora (a rubrica fixa do kit é só a reserva)
// ---------------------------------------------------------------------------------------------

/** O que o scorecard lê do plano da sessão (`PlanoDaSessao`, lib/agente/plano.ts). Campos que ainda não existem lá são opcionais. */
export type PlanoParaRubrica = {
  criterios?: { nome: string; descricao?: string; peso?: number; niveis?: Criterio["niveis"] }[];
  /** Regras de reprovação ("cobrar duas vezes") que a recrutadora disse na pré-entrevista. */
  eliminatorios?: string[];
};

/** Escala padrão quando o plano não traz níveis gerados: vale para qualquer critério, sem inventar conteúdo. */
export const NIVEIS_PADRAO_DO_PLANO: Criterio["niveis"] = {
  1: "Não mostrou o comportamento esperado neste critério",
  2: "Mostrou em parte, com lacunas ou só de forma vaga",
  3: "Mostrou com clareza e justificou o que fez",
  4: "Mostrou com profundidade: comparou alternativas e antecipou os pontos de atenção",
};

const sem = (t: string) => semAcento(t);

/** Que provocação do Totti o critério do plano exige, lida do nome e da descrição. */
export function provocacaoDoCriterio(c: { id?: string; nome: string; descricao?: string; provocadoPor?: Provocacao }): Provocacao | undefined {
  if (c.provocadoPor) return c.provocadoPor;
  const t = sem(c.nome); // só o nome: a descrição cita falhas e escala em critérios que não dependem de provocação
  if (/(escopo|requisit)/.test(t)) return "escopo";
  if (/(falha|idempot|resilien|confiab|gargalo|tolerancia a|disponibilid|reprocess)/.test(t)) return "falhas";
  if (/(escalab|mudanc|adapta|pressao|evolu[ci])/.test(t)) return "mudanca";
  return undefined;
}

/** Os critérios do plano como critérios do scorecard. O `id` é o nome exato (é o `criterio` das observações do quadro). */
export function criteriosDoPlano(plano: PlanoParaRubrica | null | undefined): Criterio[] {
  const vistos = new Set<string>();
  const saida: Criterio[] = [];
  for (const c of plano?.criterios ?? []) {
    const nome = c.nome.trim();
    if (!nome || vistos.has(nome)) continue;
    vistos.add(nome);
    const descricao = c.descricao?.trim() || undefined;
    const provocadoPor = provocacaoDoCriterio({ nome, descricao });
    saida.push({
      id: nome,
      nome,
      niveis: c.niveis ?? NIVEIS_PADRAO_DO_PLANO,
      doPlano: true,
      ...(descricao ? { descricao } : {}),
      ...(c.peso !== undefined ? { peso: c.peso } : {}),
      ...(provocadoPor ? { provocadoPor } : {}),
    });
  }
  return saida;
}

/**
 * O kit com a rubrica DA VAGA: com plano, `criterios` são os do plano; sem plano (ou sem critérios nele), o kit volta
 * como veio (a rubrica fixa é a reserva). Idempotente. Só servidor.
 */
export function kitComRubricaDaVaga<K extends Pick<Kit, "criterios">>(kit: K, plano: PlanoParaRubrica | null | undefined): K {
  const doPlano = criteriosDoPlano(plano);
  return doPlano.length ? { ...kit, criterios: doPlano } : kit;
}

/** As regras de reprovação do plano (sem vazias nem repetidas). */
export function eliminatoriosDoPlano(plano: PlanoParaRubrica | null | undefined): string[] {
  return [...new Set((plano?.eliminatorios ?? []).map((r) => r.trim()).filter(Boolean))];
}
