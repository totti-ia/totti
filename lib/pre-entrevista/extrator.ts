/**
 * Extrator (GLM): lê a conversa de pré-entrevista e devolve um patch com o que
 * a recrutadora disse ou aceitou. O patch é validado campo a campo e aplicado
 * ao rascunho. O código, não o modelo, garante as invariantes (pesos, foco dos
 * critérios, unicidade de ids).
 *
 * Além do rascunho, devolve tudo o que foi preciso para reproduzir a rodada:
 * as mensagens enviadas, as respostas cruas, o patch lido e os avisos de validação.
 */
import { z } from "zod";
import { Criterion, FocusArea, InterviewMode } from "@/lib/contracts";
import { CATALOGO, criteriosIniciais, type CriterioModelo } from "./catalogo";
import { lerDuracao, perguntouSobreTempo } from "./duracao";
import { chat, ErroChat, extrairJson, type Alvo, type Mensagem, type Tentativa } from "./llm";
import { acharEvidencia } from "./pesos";
import { fraseComTrecho, normalizarTexto, RE_CONTEXTO, RE_LOGISTICA, RE_REQUISITO } from "./frases";
import { alinharPesos, mudarModo, Origem, Rascunho, type Turno } from "./rascunho";
import { aplicarProblemaDoExtrator, problemaTemEvidencia } from "./problema-pedido";
import { titulosDoBanco } from "@/lib/problems/selecao";

const TEMPERATURA = 0.2;
const MAX_TOKENS_EXTRATOR = 12000;

const GLM = "zai-org/GLM-5.2";
const GEMMA = "google/gemma-4-26B-A4B-it";

/**
 * Alvos do extrator, em ordem: as duas Featherless primeiro (plano fixo, sem cobrança por chamada) e a OpenRouter só
 * como última reserva. A extração roda a cada fala dela, em segundo plano, então a OpenRouter aqui era o custo
 * que mais pesava. `EXTRACTOR_MODEL` escolhe a primária (padrão: GLM, que deu a melhor configuração na medição);
 * a outra Featherless vem em seguida. O GLM vai com o raciocínio desligado: sem isso uma chamada levava ~170 s.
 */
export function alvosDoExtrator(): Alvo[] {
  const primario = process.env.EXTRACTOR_MODEL || GLM;
  const segundo = primario === GEMMA ? GLM : GEMMA;
  return [
    alvoFeatherless(primario, 20000),
    alvoFeatherless(segundo, 20000),
    // Reserva paga: só entra quando as duas Featherless falham.
    {
      provedor: "openrouter",
      model: process.env.EXTRACTOR_FALLBACK_MODEL || "google/gemini-2.5-flash-lite",
      timeoutMs: 15000,
    },
  ];
}

function alvoFeatherless(model: string, timeoutMs: number): Alvo {
  return {
    provedor: "featherless",
    model,
    ...(model.startsWith("zai-org/GLM") ? { extraBody: { chat_template_kwargs: { enable_thinking: false } } } : {}),
    timeoutMs,
  };
}

const ConfirmadoParcial = Rascunho.shape.confirmado.partial();
const Senioridade = Rascunho.shape.seniority;

/**
 * Campos que o modelo pode devolver. Todos opcionais; o que não vier fica como está.
 * O foco não vem do modelo: sai de `pesosPelaEnfase` (ver `pesos.ts`). As notas também não: saem de `montarGuia`.
 */
export interface Patch {
  mode?: InterviewMode;
  seniority?: z.infer<typeof Senioridade>;
  confirmado?: z.infer<typeof ConfirmadoParcial>;
  criteria?: Criterion[];
  /** Trecho literal de fala dela que justifica cada critério personalizado ou novo, por id. Validado antes de aplicar. */
  evidencias?: Record<string, string>;
  /** Origem de cada critério do patch, depois da validação (`validarEvidencias`). */
  origens?: Record<string, Origem>;
  /** Trechos literais em que ela disse que algo reprova o candidato sozinho. Validados antes de aplicar. */
  eliminatorios?: string[];
  /** Trecho literal sobre o time, a empresa ou o momento da contratação. Validado antes de aplicar. */
  contexto?: string;
  /** Instruções de condução da entrevista (comportamento do Totti), separadas dos critérios de nota. */
  conducao?: string[];
  durationMin?: number;
  problemId?: string;
}

const PROMPT_SISTEMA = `Você extrai, de uma conversa de pré-entrevista, a configuração de uma entrevista técnica.
A recrutadora conversa com um assistente de voz para descrever a vaga e o que quer avaliar.
Sua tarefa: ler a conversa e devolver SOMENTE um JSON com as mudanças em relação ao rascunho atual.

Regras:
1. Registre só o que a recrutadora disse ou aceitou. Nunca invente preferências.
   Se ela não falou de um campo, não o inclua no JSON.
2. Falas do assistente não são preferências. Só valem como aceite quando a recrutadora concordou
   ou corrigiu explicitamente ("pode ser", "isso mesmo", "na verdade são 60 minutos").
3. Se ela mudou de ideia no meio da conversa, vale a última posição dela.
4. criteria: devolva a lista COMPLETA e final de critérios, não só os que mudaram.
   - Parta dos critérios do catálogo que forem enviados. Personalize a description só com o que ela disse.
   - description sempre em comportamento observável, no formato "Bom: ... Ruim: ...", com 1 a 3 frases curtas em português.
     Evite termos vagos como "boa comunicação" ou "bom conhecimento"; diga o que se vê na entrevista.
   - Se ela descreveu só o lado bom (ou só o ruim), deduza o outro lado como o oposto razoável. Escreva sempre os dois lados.
   - Para cada critério personalizado ou novo, inclua "evidencia": um TRECHO LITERAL, copiado exatamente de uma fala da
     RECRUTADORA (até 20 palavras), que justifica a description. Se você não tem um trecho literal dela, não personalize:
     deixe a description do catálogo e não inclua evidencia.
   - Se ela pediu algo que o catálogo não cobre, adicione um critério novo com id em snake_case e evidencia.
   - Se ela tirou uma área, não inclua critérios dessa área.
   - Critério do catálogo sobre o qual ela não falou fica como está.
   - weight é maior que 0; use valores maiores para o que ela disse que pesa mais (base 1).
   - focus de cada critério deve ser uma das áreas do foco.
5. eliminatorios: lista de trechos LITERAIS (até 20 palavras) de falas da RECRUTADORA em que ela disse que algo reprova
   o candidato sozinho. Lista completa. Se ela não disse nenhum, lista vazia.
6. contexto: um trecho LITERAL (até 20 palavras) de uma fala da RECRUTADORA sobre o time, a empresa ou o momento da
   contratação. Se ela não falou disso, omita o campo.
7. confirmado: marque true só para mode, seniority ou focus que ela confirmou ou corrigiu explicitamente nesta conversa.
   Um "sim" a uma proposta que cobre formato, senioridade e foco de uma vez conta para os três.
8. conducao: instruções sobre COMO o Totti se comporta durante a entrevista, em frases curtas e imperativas, na voz dela
   ("redirecione o candidato se errar o escopo", "não dê a resposta", "pergunte sobre testes", "deixe ele pensar em silêncio").
   Isso NUNCA vai em criteria: critério é o que se observa no candidato para dar nota; conducao é o que o Totti faz.
   Exemplos: "redirecione ele se errar o escopo" -> conducao. "Ruim é não perceber que errou o escopo" -> critério.
   "Quero que pergunte sobre complexidade" -> conducao. "Tem que saber explicar a complexidade" -> critério.
   Lista completa e final (inclua as que já estavam no rascunho e que ela não retirou). Se ela não deu nenhuma, omita o campo.
   Tom e dicas continuam fora daqui: são preferências à parte.
9. durationMin: inteiro, em minutos, só se ela disse.
10. problemId: só se ela pediu uma questão específica pelo nome ("usa o two sum"). Devolva o id da lista QUESTÕES DO BANCO
   (por exemplo "two-sum"), nunca o nome que ela falou. Se ela pediu uma que não está na lista, devolva o nome que ela
   disse, curto. Se ela não pediu, não envie.

Áreas válidas: tecnico, pressao, escala_produto, uso_ia.
Modos válidos: live_coding (código ao vivo, codar, programar, construir um algoritmo, IDE), system_design (quadro, Excalidraw, desenhar a arquitetura ou o sistema).
Senioridades válidas: junior, pleno, senior.

Dentro dos textos (description, eliminatorios, contexto, conducao), não use aspas duplas: se precisar citar, use aspas simples.
Use o JSON válido: strings em uma linha só, sem vírgula sobrando.

Formato de saída (apenas o JSON, sem texto antes ou depois, sem cercas de código):
{
  "mode": "...", "seniority": "...",
  "confirmado": {"mode": true, "seniority": true, "focus": true},
  "criteria": [{"id": "...", "name": "...", "focus": "...", "weight": 1, "description": "Bom: ... Ruim: ...", "evidencia": "..."}],
  "eliminatorios": ["..."], "contexto": "...", "conducao": ["..."],
  "durationMin": 40, "problemId": "..."
}
Inclua apenas as chaves que mudaram.`;

/** Acumula avisos de validação: vão para o console e para o retorno de `extrair` (e de lá para o log). */
type Avisos = string[];

/**
 * Só aceita `durationMin` se alguma fala da recrutadora, lida com `lerDuracao`, devolve exatamente esse valor
 * (com `perguntouTempo` calculado pela fala anterior do Totti). Caso contrário, a duração veio do modelo sem
 * base na fala, e descarta com aviso. "3 milhões de transações" não libera nada. Função pura quanto ao patch.
 */
export function checarDuracao(patch: Patch, transcricao: Turno[], avisos: Avisos): Patch {
  if (patch.durationMin === undefined) return patch;
  let ultimaAgente: string | undefined;
  for (const t of transcricao) {
    if (t.role === "agente") {
      ultimaAgente = t.text;
      continue;
    }
    if (lerDuracao(t.text, { perguntouTempo: perguntouSobreTempo(ultimaAgente) }) === patch.durationMin) return patch;
  }
  avisar(avisos, `durationMin=${patch.durationMin} descartado: nenhuma fala da recrutadora diz essa duração`);
  return { ...patch, durationMin: undefined };
}

function avisar(avisos: Avisos, msg: string): void {
  avisos.push(msg);
  console.warn(`[extrator] ${msg}`);
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Valida um campo. Se for inválido, descarta com aviso e segue. */
function campo<T>(nome: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, valor: unknown, avisos: Avisos): T | undefined {
  if (valor === undefined || valor === null) return undefined;
  const r = schema.safeParse(valor);
  if (r.success) return r.data;
  avisar(avisos, `campo "${nome}" descartado: ${r.error.issues[0]?.message ?? "inválido"}`);
  return undefined;
}

/** Valida uma lista item a item: itens inválidos saem, os válidos ficam. */
function lista<T>(nome: string, item: z.ZodType<T, z.ZodTypeDef, unknown>, valor: unknown, avisos: Avisos): T[] | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (!Array.isArray(valor)) {
    avisar(avisos, `campo "${nome}" não é uma lista; descartado`);
    return undefined;
  }
  const itens: T[] = [];
  valor.forEach((bruto, i) => {
    const r = item.safeParse(bruto);
    if (r.success) itens.push(r.data);
    else avisar(avisos, `${nome}[${i}] descartado: ${r.error.issues[0]?.message ?? "inválido"}`);
  });
  return itens;
}

/** Critério como o modelo devolve: o de `Criterion` mais a evidência (trecho dela), que não faz parte do critério. */
const CriterioComEvidencia = Criterion.extend({ evidencia: z.string().optional() });

function lerPatch(bruto: unknown, avisos: Avisos): Patch {
  if (!ehObjeto(bruto)) {
    avisar(avisos, "resposta não é um objeto JSON; nada aplicado");
    return {};
  }
  const criterios = lista("criteria", CriterioComEvidencia, bruto.criteria, avisos);
  return {
    mode: campo("mode", InterviewMode, bruto.mode, avisos),
    seniority: campo("seniority", Senioridade, bruto.seniority, avisos),
    confirmado: campo("confirmado", ConfirmadoParcial, bruto.confirmado, avisos),
    criteria: criterios?.map((c) => ({ id: c.id, name: c.name, description: c.description, weight: c.weight, focus: c.focus })),
    evidencias: criterios && Object.fromEntries(criterios.flatMap((c) => (c.evidencia ? [[c.id, c.evidencia]] : []))),
    eliminatorios: lista("eliminatorios", z.string().min(1), bruto.eliminatorios, avisos),
    contexto: campo("contexto", z.string().min(1), bruto.contexto, avisos),
    conducao: lista("conducao", z.string().trim().min(1), bruto.conducao, avisos),
    durationMin: campo("durationMin", z.number().int().positive(), bruto.durationMin, avisos),
    problemId: campo("problemId", z.string().min(1), bruto.problemId, avisos),
  };
}

/** Garante ids únicos e focus dentro das áreas. Se nada sobrar, volta ao catálogo. */
function ajustarCriterios(criterios: Criterion[], areas: Set<FocusArea>, mode: InterviewMode, avisos: Avisos): CriterioModelo[] {
  const porId = new Map<string, Criterion>();
  for (const c of criterios) {
    if (!areas.has(c.focus)) {
      avisar(avisos, `critério "${c.id}" descartado: foco "${c.focus}" fora das áreas de foco`);
      continue;
    }
    if (porId.has(c.id)) avisar(avisos, `id de critério repetido "${c.id}"; mantido o último`);
    porId.set(c.id, c);
  }
  if (porId.size === 0) {
    avisar(avisos, "nenhum critério válido; voltando aos critérios do catálogo");
    return criteriosIniciais(mode, [...areas]);
  }
  return [...porId.values()];
}

/**
 * Confere cada critério com a fala dela que o justifica. Critério cujo trecho aparece numa fala da recrutadora
 * fica com a origem nessa fala. Critério do catálogo sem trecho válido volta à name e à description do catálogo,
 * com origem "catalogo". Critério novo sem trecho válido sai. Eliminatórios e contexto só valem se o trecho aparece.
 * Função pura quanto ao patch.
 */
export function validarEvidencias(p: Patch, transcricao: Turno[], modo: InterviewMode, avisos: Avisos): Patch {
  const origens: Record<string, Origem> = {};
  const criteria = p.criteria?.flatMap((c) => {
    const trecho = p.evidencias?.[c.id];
    let ev = trecho !== undefined ? acharEvidencia(trecho, transcricao) : undefined;
    // Frase de logística (minutos, tom, dicas) não prova critério de competência, a menos que cite o critério.
    if (ev && trecho !== undefined) {
      const frase = normalizarTexto(fraseComTrecho(transcricao[ev.turno - 1].text, trecho));
      const palavrasDoCriterio = normalizarTexto(`${c.name} ${c.description}`)
        .split(" ")
        .filter((w) => w.length >= 5);
      if (RE_LOGISTICA.test(frase) && !palavrasDoCriterio.some((w) => ` ${frase} `.includes(` ${w} `))) {
        avisar(avisos, `evidência de "${c.id}" descartada: a frase é de logística (minutos, tom, dicas), não de competência`);
        ev = undefined;
      }
    }
    if (ev) {
      origens[c.id] = ev;
      return [c];
    }
    const base = CATALOGO[modo].find((x) => x.id === c.id);
    if (!base) {
      avisar(avisos, `critério novo "${c.id}" descartado: sem trecho dela que o justifique`);
      return [];
    }
    if (c.name !== base.name || c.description !== base.description) {
      avisar(avisos, `critério "${c.id}" volta à descrição do catálogo: sem trecho dela que o justifique`);
    }
    origens[c.id] = "catalogo";
    return [{ ...c, name: base.name, description: base.description }];
  });
  const eliminatorios = p.eliminatorios?.flatMap((trecho) => {
    const ev = acharEvidencia(trecho, transcricao);
    if (ev) return [fraseComTrecho(transcricao[ev.turno - 1].text, trecho)];
    avisar(avisos, `eliminatório descartado: o trecho não aparece nas falas dela`);
    return [];
  });
  // Contexto: a frase tem de falar do time ou da empresa, e não descrever o candidato ideal ("ele", "tem que ter").
  const evContexto = p.contexto === undefined ? undefined : acharEvidencia(p.contexto, transcricao);
  const fraseContexto = evContexto && p.contexto !== undefined ? fraseComTrecho(transcricao[evContexto.turno - 1].text, p.contexto) : "";
  const contexto =
    p.contexto === undefined
      ? undefined
      : evContexto && RE_CONTEXTO.test(fraseContexto) && !RE_REQUISITO.test(fraseContexto)
        ? fraseContexto
        : (avisar(avisos, "contexto descartado: não é frase do time ou da empresa, ou descreve o candidato"), "");
  return { ...p, criteria, origens: p.criteria ? origens : undefined, eliminatorios, contexto };
}

/** A lista sem repetições, na ordem (ignora maiúsculas, acento e pontuação). */
function semRepetir(lista: string[]): string[] {
  const vistas = new Set<string>();
  return lista.filter((s) => {
    const k = normalizarTexto(s);
    if (!k || vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

/**
 * Aplica o patch ao rascunho. Não muta o rascunho original. O foco não muda aqui: quem decide é `pesosPelaEnfase`.
 * Critério que ganha fala dela nesta leitura pesa 1,5×; o que perde a fala volta ao normal. Assim, repetir a leitura
 * com a mesma fala não acumula o fator.
 */
export function aplicarPatch(r: Rascunho, p: Patch, avisos: Avisos = []): Rascunho {
  const modeMudou = p.mode !== undefined && p.mode !== r.mode;
  const mode = p.mode ?? r.mode;
  const areas = new Set(r.focus.map((f) => f.area));

  // Critérios: a lista do patch é a final. Se o modo mudou sem lista nova, parte do catálogo do novo modo.
  const base = p.criteria ?? (modeMudou ? criteriosIniciais(mode, [...areas]) : r.criteria);
  const origensDoPatch: Record<string, Origem> = p.criteria ? (p.origens ?? {}) : modeMudou ? {} : r.origens;
  const fala = (o: Origem | undefined) => o !== undefined && o !== "catalogo";
  const comFator = p.criteria
    ? base.map((c) => ({ ...c, weight: c.weight * ((fala(origensDoPatch[c.id]) ? 1.5 : 1) / (fala(r.origens[c.id]) ? 1.5 : 1)) }))
    : base;
  const criteria = alinharPesos(ajustarCriterios(comFator, areas, mode, avisos), r.focus);
  const ids = new Set(criteria.map((c) => c.id));

  const aplicado: Rascunho = {
    ...r,
    mode,
    seniority: p.seniority ?? r.seniority,
    criteria,
    origens: Object.fromEntries(Object.entries(origensDoPatch).filter(([id]) => ids.has(id))),
    eliminatorios: p.eliminatorios ?? r.eliminatorios,
    contexto: p.contexto ?? r.contexto,
    // O patch traz a lista completa (ver regra 8 do prompt): substitui, para que ela consiga retirar uma instrução.
    conducao: p.conducao ? semRepetir(p.conducao) : r.conducao,
    durationMin: p.durationMin ?? r.durationMin,
    // Problema escolhido para o modo antigo não serve para o novo; volta ao padrão do modo.
    problemId: modeMudou ? undefined : r.problemId,
    pedidoProblema: modeMudou ? undefined : r.pedidoProblema,
    // Confirmação é irreversível: uma vez que ela confirmou, não volta para falso.
    confirmado: {
      mode: r.confirmado.mode || p.confirmado?.mode === true,
      seniority: r.confirmado.seniority || p.confirmado?.seniority === true,
      focus: r.confirmado.focus || p.confirmado?.focus === true,
    },
  };
  // O valor do modelo passa pelo banco: id, título ou apelido viram o id; nome que não existe não vira questão.
  return aplicarProblemaDoExtrator(aplicado, p.problemId, avisos);
}

function formatarTranscricao(turnos: Turno[]): string {
  return turnos.map((t, i) => `${i + 1}. ${t.role}: ${t.text}`).join("\n");
}

/** Mensagens enviadas ao modelo: prompt de sistema + rascunho, catálogo do modo e transcrição. */
export function montarMensagens(r: Rascunho, transcricao: Turno[]): Mensagem[] {
  // A vaga fica de fora: o extrator só registra o que foi dito na conversa.
  const semVaga = { ...r, jobDescription: undefined, conducaoVista: undefined, regraDeIa: undefined, fixados: r.fixados.filter((c) => c !== "regraDeIa") };
  const entrada = [
    `RASCUNHO ATUAL:\n${JSON.stringify(semVaga, null, 2)}`,
    `CRITÉRIOS DO CATÁLOGO PARA O MODO ATUAL (${r.mode}):\n${JSON.stringify(CATALOGO[r.mode], null, 2)}`,
    `QUESTÕES DO BANCO (id: título):\n${titulosDoBanco().join("\n")}`,
    `TRANSCRIÇÃO:\n${formatarTranscricao(transcricao)}`,
  ].join("\n\n");
  return [
    { role: "system", content: PROMPT_SISTEMA },
    { role: "user", content: entrada },
  ];
}

/** Uma resposta do modelo que não virou patch válido (JSON quebrado), para o log. */
export interface TentativaJson {
  resposta: string;
  erro?: string;
}

/** Falha da extração depois de esgotar as tentativas de JSON. Carrega o que foi enviado e recebido. */
export class ErroExtracao extends Error {
  constructor(
    mensagem: string,
    readonly detalhes: { mensagens: Mensagem[]; tentativasJson: TentativaJson[]; tentativas: Tentativa[]; avisos: Avisos },
  ) {
    super(mensagem);
    this.name = "ErroExtracao";
  }
}

export interface ResultadoExtracao {
  rascunho: Rascunho;
  /** Tempo somado de todas as chamadas ao modelo. */
  ms: number;
  provedor: string;
  model: string;
  /** Mensagens da última chamada enviada ao modelo (prompt completo, incluindo correção de JSON se houve). */
  mensagens: Mensagem[];
  /** Resposta crua da última chamada, a que originou o patch. */
  respostaCrua: string;
  /** Cada resposta lida ao tentar extrair o JSON, com o erro de parse quando houve. */
  tentativasJson: TentativaJson[];
  /** Patch já validado, como foi aplicado (só as chaves que vieram e passaram na validação). */
  patch: Patch;
  /** Avisos de validação (campos descartados, critérios ajustados). Os mesmos que foram ao console. */
  avisos: Avisos;
  /** Tentativas HTTP de todas as chamadas, na ordem. Mostra quando houve fallback de provedor. */
  tentativas: Tentativa[];
}

/** O que o extrator sabe além da conversa: o formato escolhido na troca, que prevalece sobre o que o patch trouxe. */
export interface ContextoExtracao {
  modoEscolhido?: InterviewMode;
}

/**
 * Extrai o patch da conversa e aplica no rascunho. Antes de aplicar, cada trecho que o modelo citou é conferido
 * com as falas dela (`validarEvidencias`). O foco e as notas não passam por aqui: ver `pesos.ts` e `guia.ts`.
 */
export async function extrair(r: Rascunho, transcricao: Turno[], contexto: ContextoExtracao = {}): Promise<ResultadoExtracao> {
  const modoEscolhido = contexto.modoEscolhido;
  const avisos: Avisos = [];
  const tentativas: Tentativa[] = [];
  const tentativasJson: TentativaJson[] = [];
  const mensagens: Mensagem[] = montarMensagens(r, transcricao);

  // Modelo às vezes erra o JSON (aspas não escapadas nos textos). Pede a correção uma vez.
  let ms = 0;
  let provedor = "";
  let modelo = "";
  for (let rodada = 1; ; rodada++) {
    const enviadas = mensagens.map((m) => ({ ...m }));
    let resposta: Awaited<ReturnType<typeof chat>>;
    try {
      resposta = await chat({
        alvos: alvosDoExtrator(),
        messages: enviadas,
        temperature: TEMPERATURA,
        // Raciocínio consome tokens e segundos antes do JSON. Com ele desligado a chamada cai para poucos segundos.
        maxTokens: MAX_TOKENS_EXTRATOR,
        // Segundo plano: a fila da Featherless deixa a vaga livre para a fala da recrutadora.
        prioridade: "fundo",
      });
    } catch (err) {
      if (err instanceof ErroChat) tentativas.push(...err.tentativas);
      throw err;
    }
    tentativas.push(...resposta.tentativas);
    ms += resposta.ms;
    if (resposta.provedor !== "featherless") avisar(avisos, `respondeu ${resposta.provedor}/${resposta.model}`);
    provedor = resposta.provedor;
    modelo = resposta.model;

    let patch: Patch;
    try {
      patch = lerPatch(extrairJson(resposta.content), avisos);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      tentativasJson.push({ resposta: resposta.content, erro: motivo });
      if (rodada >= 2) {
        throw new ErroExtracao(motivo, { mensagens: enviadas, tentativasJson, tentativas, avisos });
      }
      avisar(avisos, `JSON inválido na tentativa ${rodada}; pedindo correção (${motivo.slice(0, 120)})`);
      mensagens.push(
        { role: "assistant", content: resposta.content },
        {
          role: "user",
          content:
            `Seu JSON não é válido (${motivo.slice(0, 200)}). Devolva o JSON completo de novo, corrigido. ` +
            "Não use aspas duplas dentro dos textos e não quebre linhas dentro das strings.",
        },
      );
      continue;
    }

    tentativasJson.push({ resposta: resposta.content });
    const checado = checarDuracao(patch, transcricao, avisos);
    const aceito = validarEvidencias(checado, transcricao, checado.mode ?? r.mode, avisos);
    // O modelo só fixa questão que a recrutadora citou; sem a citação é palpite.
    if (aceito.problemId !== undefined && !problemaTemEvidencia(aceito.problemId, transcricao)) {
      avisar(avisos, `problemId "${aceito.problemId}" descartado: a recrutadora não citou essa questão`);
      aceito.problemId = undefined;
    }
    const aplicado = aplicarPatch(r, aceito, avisos);
    return {
      rascunho: modoEscolhido ? mudarModo(aplicado, modoEscolhido) : aplicado,
      ms,
      provedor,
      model: modelo,
      mensagens: enviadas,
      respostaCrua: resposta.content,
      tentativasJson,
      patch: aceito,
      avisos,
      tentativas,
    };
  }
}
