// Linha do tempo das interrupções no quadro (System Design): quantas vezes o Totti toma a vez sem ser chamado,
// em que fase, em que momento (pausa depois de desenhar, silêncio, fim de resposta) e se o candidato estava no meio
// de um desenho ou de uma fala. Relógio virtual: uma entrevista inteira leva só o tempo das chamadas ao LLM.
// Reproduz o navegador (gatilho de pausa e de silêncio, máquina de estados do quadro, tomada de turno) e chama a
// análise de verdade do servidor (`lib/agente/analisar.ts`), com o LLM real ou com um modelo que sempre pergunta.
//
//   npx tsx --env-file-if-exists=.env.local scripts/linha-do-tempo-quadro.ts [--llm real|sempre] [--persona normal,fluente,travado] [--duracao 35]
//
// --llm sempre: sem créditos; mostra o teto da política (o modelo quer perguntar em toda análise).
// --llm real (padrão): usa créditos (papel "quadro", ~US$ 0,0005 por análise).
import "./_gasto";
import { analisar, refiltrarComEstadoAtual } from "../lib/agente/analisar";
import { eventosDaMaquina } from "../lib/agente/rotas/handlers";
import { KIT_SYSTEM_DESIGN as kit } from "../lib/agente/kits/system-design";
import type { LlmCliente } from "../lib/agente/llm/cliente";
import { criarClientePrincipal } from "../lib/agente/llm/principal";
import { escalarTempos } from "../lib/agente/plano";
import { duracaoEfetivaDaFaseS } from "../lib/totti/fechamento";
import {
  estadoInicial as estadoServidorInicial,
  TEMPOS_PADRAO,
  transicionar as transicionarServidor,
  type EstadoSessao,
  type EventoSessao,
} from "../lib/agente/sessao/estado";
import type { PedidoAnalise, RespostaAnalise as RespostaDoAgente } from "../lib/agente/sessao/tipos";
import { podeTomarTurno } from "../lib/conversa/turnos";
import type { Fase, RespostaAnalise } from "../lib/sessao/cliente";
import { contarComponentes, emGarantiaDoEmpecilho, esperaDoEmpecilho } from "../lib/sessao/empecilho";
import { interrupcaoAtrasada, motivoDoMomento, RITMO } from "../lib/interrupcao/politica";
import { aceitaPlin, estadoInicial, marcoDeFase, podeAnalisar, ritmoDoCliente, transicionar, type EstadoEntrevista, type EventoEntrevista } from "../lib/sessao/estados";
import { LIMITE_PADRAO_MS, PAUSA_PADRAO_MS } from "../lib/sessao/gatilho";
import { deveForcarAnalise } from "../lib/sessao/silencio";
import { motivoBloqueioPlin, motivoDoConteudo as motivoDoConteudoDoQuadro } from "../lib/agente/sessao/politica";
import { montarPromptAvaliador } from "../lib/agente/prompts/avaliador";
import { instantaneo, resumoDoCusto } from "./custo";

const TICK_MS = 500;
/** Tempo que o Totti leva falando uma pergunta. */
const FALA_DA_PERGUNTA_MS = 6_000;
/** O quadro dá a resposta por terminada depois desse silêncio (SILENCIO_FIM_DA_RESPOSTA_MS em useEntrevista.ts). */
const FIM_DA_RESPOSTA_MS = 7_000;
/** Chance de o Totti comentar (sem pergunta) uma fala solta do candidato, o que dispara uma análise. */
const COMENTA_DEPOIS_DA_FALA = 0.3;

const LINHAS = [
  "- [r1] Cliente (retângulo)",
  "- [r2] Load balancer (retângulo)",
  "- [s1] Cliente → Load balancer",
  "- [r3] API de encurtamento (retângulo)",
  "- [s2] Load balancer → API de encurtamento",
  "- [e1] Postgres primário (elipse)",
  "- [s3] API de encurtamento → Postgres primário \"escreve\"",
  "- [r4] Gerador de IDs (base62) (retângulo)",
  "- [s4] API de encurtamento → Gerador de IDs",
  "- [r5] Cache Redis (retângulo)",
  "- [s5] API de encurtamento → Cache Redis \"lê primeiro\"",
  "- [e2] Réplica de leitura (elipse)",
  "- [s6] Postgres primário → Réplica de leitura \"replica\"",
  "- [s7] Cache Redis → Réplica de leitura \"miss\"",
  "- [r6] Fila Kafka de cliques (retângulo)",
  "- [s8] API de encurtamento → Fila Kafka de cliques",
  "- [r7] Worker de analytics (retângulo)",
  "- [s9] Fila Kafka de cliques → Worker de analytics",
];

type Passo = { tipo: "desenha" | "fala" | "pausa"; ms: number };
interface Persona {
  nome: string;
  /** Pesos e faixas de duração (s) de cada tipo de passo. */
  passos: Record<Passo["tipo"], { peso: number; s: [number, number] }>;
  /** Quanto tempo ele fala ao responder uma pergunta. */
  respostaS: number;
}

const PERSONAS: Persona[] = [
  {
    nome: "normal",
    passos: { desenha: { peso: 0.4, s: [6, 14] }, fala: { peso: 0.3, s: [6, 15] }, pausa: { peso: 0.3, s: [4, 18] } },
    respostaS: 20,
  },
  {
    nome: "fluente",
    passos: { desenha: { peso: 0.4, s: [6, 16] }, fala: { peso: 0.5, s: [8, 20] }, pausa: { peso: 0.1, s: [2, 4] } },
    respostaS: 30,
  },
  {
    nome: "travado",
    passos: { desenha: { peso: 0.25, s: [4, 8] }, fala: { peso: 0.2, s: [4, 8] }, pausa: { peso: 0.55, s: [10, 45] } },
    respostaS: 8,
  },
];

/** Gerador determinístico (mulberry32): a mesma persona faz sempre a mesma entrevista. */
function rng(semente: number) {
  let a = semente;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Modelo que quer perguntar em toda análise (perguntas sempre diferentes, para a guarda de repetição não barrar). */
function llmSempre(): LlmCliente {
  const temas = ["consistência", "latência", "particionamento", "colisão", "expiração", "replicação", "observabilidade", "custo", "segurança", "falhas", "picos", "migração"];
  let n = 0;
  return {
    async completarJson<T>() {
      const tema = temas[n++ % temas.length];
      const dados = {
        status: "duvida",
        pergunta: `Pergunta ${n} sobre ${tema}: o que você ${["prioriza", "decide", "escolhe", "considera"][n % 4]} ${tema} ${n}?`,
        nota: tema,
        elementos: [],
        degrau: 1,
        observacoes: [],
        avancar_fase: false,
        // Sempre "parte fechada": o piso entre perguntas (RITMO_QUADRO) é o que segura o modelo que quer perguntar sempre.
        parteFechada: true,
      };
      return { dados: dados as T, ms: 3_500 };
    },
  };
}

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export interface Interrupcao {
  t: number;
  fase: string;
  tipo: string;
  motivo: string;
  desenhando: boolean;
  texto: string;
}

export interface ResultadoMedicao140 {
  sala: string;
  perguntas: number[];
  ganchos: string[];
  criterios: string[];
  feitasAntesDoTerminei: number;
  maiorIntervaloComLacunaS: number;
  percentualAntesDoFechamento: number;
  criteriosAte70: number;
  totalCriterios: number;
  naoExploradosNoFim: number;
  menorIntervaloS: number;
  duranteFalaOuTraco: number;
  ganchosIguaisSeguidos: number;
  motivosDaEspera?: string[];
}

/** Percurso offline com o filtro de conteúdo e os portões de ritmo de produção do quadro. */
export function medirOfflineQuadro(): ResultadoMedicao140 {
  const duracao = 30 * 60_000;
  const criterios = ["escala", "consistencia", "latencia", "falhas"];
  const estado = estadoServidorInicial({
    tempos: { REQUISITOS: 300, ALTO_NIVEL: 600, APROFUNDAMENTO: 900, FECHAMENTO: 300 },
    criterios,
    plano: { cargo: "Desenvolvedor Backend", senioridade: "pleno", tom: "amigavel", dicas: "leves", foco: [{ area: "tecnico", peso: 1 }], notas: "", duracaoMin: 30 },
  });
  estado.fase = "ALTO_NIVEL";
  estado.faseIniciadaEm = 0;
  estado.iniciadaEm = 0;
  const tempos: number[] = [];
  const ganchos: string[] = [];
  const criteriosPerguntados: string[] = [];
  const motivosDaEspera: string[] = [];
  const contagemDeBloqueios = new Map<string, number>();
  const provocados = new Set<string>();
  let falaAte = -1;
  let maiorIntervaloComLacunaS = 0;
  let duranteFalaOuTraco = 0;
  // Cada análise acompanha uma escolha visível do desenho contínuo; os testes de política cobrem o caso sem gancho.
  const opcoes = ["decisao", "raciocinio", "parte_fechada"] as const;
  let analisesDoModelo = 0;
  let motivoAnterior = "a análise ainda não pediu uma pergunta";
  // Candidato desenha em sequência, age depois de cada fala e faz pausas reais de 4 s. Diz "terminei" aos 80%.
  for (let t = 1_000, passo = 0; t < duracao * 0.8; t += 1_000, passo++) {
    const ciclo = t % 14_000;
    const desenhando = ciclo < 9_000;
    const paradoHaS = desenhando ? 0 : Math.floor((ciclo - 9_000) / 1_000);
    const falandoCandidato = t % 71_000 >= 30_000 && t % 71_000 < 36_000;
    const deveAnalisar = paradoHaS >= 3 || (desenhando && t % RITMO.analiseMaximaSemPausaMs === 0);
    if (!deveAnalisar) continue;
    const gancho = opcoes[analisesDoModelo++ % opcoes.length];
    const pedido: PedidoAnalise = {
      sessao_id: "medicao-140-quadro", fase: estado.fase,
      grafo: `COMPONENTES E CONEXÕES\n${LINHAS.slice(0, Math.min(LINHAS.length, passo + 1)).join("\n")}`,
      mudancas: `Novo: ${LINHAS[passo % LINHAS.length]}`, conversa_recente: [], perguntas_feitas: tempos.length,
      imagem_url: null, parado_ha_s: paradoHaS,
    };
    const prompt = montarPromptAvaliador(kit, kit.problemas[0], estado, pedido, t);
    const agenda = `${prompt.sistema.estatico}\n${prompt.sistema.dinamico}`;
    const pendentes = criterios.filter((c) => !provocados.has(c));
    const criterio = pendentes.find((c) => agenda.includes(c)) ?? pendentes[0] ?? criterios[passo % criterios.length];
    if (gancho === null) {
      // A política ainda é consultada nos passos sem gancho, como ocorre quando o Analyst devolve uma análise vazia.
      motivoAnterior = motivoDoConteudoDoQuadro(estado, { status: "duvida", gancho: null, parteFechada: false }, t, { paradoHaS, pecas: [`p${passo}`] }) ?? "sem bloqueio de conteúdo; modelo falso não escolheu gancho";
      contagemDeBloqueios.set(motivoAnterior, (contagemDeBloqueios.get(motivoAnterior) ?? 0) + 1);
      continue;
    }
    const resposta = { status: "duvida" as const, gancho, parteFechada: gancho === "parte_fechada" };
    const bloqueioConteudo = motivoDoConteudoDoQuadro(estado, resposta, t, { paradoHaS, pecas: [`p${passo}`] });
    if (bloqueioConteudo) { motivoAnterior = bloqueioConteudo; contagemDeBloqueios.set(motivoAnterior, (contagemDeBloqueios.get(motivoAnterior) ?? 0) + 1); continue; }
    const bloqueioRitmo = motivoBloqueioPlin(estado, t, undefined, { paradoHaS, temDesenho: true });
    if (bloqueioRitmo) { motivoAnterior = bloqueioRitmo; contagemDeBloqueios.set(motivoAnterior, (contagemDeBloqueios.get(motivoAnterior) ?? 0) + 1); continue; }
    if (passo % 11 === 0) falaAte = t + 2_000; // fala ocasional com duração explícita.
    if (falandoCandidato || t < falaAte) { motivoAnterior = "fala do candidato em andamento"; contagemDeBloqueios.set(motivoAnterior, (contagemDeBloqueios.get(motivoAnterior) ?? 0) + 1); continue; }
    if (ganchos.at(-1) === gancho) { motivoAnterior = "gancho igual ao da pergunta anterior"; contagemDeBloqueios.set(motivoAnterior, (contagemDeBloqueios.get(motivoAnterior) ?? 0) + 1); continue; }
    if (desenhando || falandoCandidato) duranteFalaOuTraco++;
    motivosDaEspera.push(`${mmss(t)} · intervalo ${tempos.length ? Math.round((t - tempos.at(-1)!) / 1000) : Math.round(t / 1000)} s; bloqueios desde a anterior: ${[...contagemDeBloqueios].map(([m, n]) => `${m} × ${n}`).join(", ") || "nenhum"}`);
    contagemDeBloqueios.clear();
    motivoAnterior = "sem bloqueio anterior";
    tempos.push(t);
    ganchos.push(gancho);
    criteriosPerguntados.push(criterio);
    provocados.add(criterio);
    estado.ultimaPerguntaEm = t;
    estado.ultimaFalaDoAgenteEm = t;
    estado.perguntasFeitas = tempos.length;
    estado.perguntas.push({ numero: tempos.length, status: "duvida", gancho, pergunta: "Por que escolheu isso?", nota: null, elementos: [], degrau: null, fase: "ALTO_NIVEL", feitaEm: t });
  }
  const fechamento = duracao * 0.8;
  const ate70 = new Set(criteriosPerguntados.filter((_, i) => tempos[i] <= duracao * 0.7));
  const intervals = tempos.slice(1).map((t, i) => (t - tempos[i]) / 1000);
  maiorIntervaloComLacunaS = intervals.length ? Math.max(...intervals) : (tempos[0] ?? 0) / 1000;
  // O fim da cobertura é modelado pelo conjunto de critérios que o modelo falso provocou.
  const finalizados = new Set(criteriosPerguntados);
  return {
    sala: "quadro", perguntas: tempos, ganchos, criterios, feitasAntesDoTerminei: tempos.filter((t) => t < duracao * 0.8).length,
    maiorIntervaloComLacunaS, percentualAntesDoFechamento: tempos.length ? Math.round(100 * tempos.filter((t) => t < fechamento).length / tempos.length) : 0,
    criteriosAte70: ate70.size, totalCriterios: criterios.length, naoExploradosNoFim: criterios.length - finalizados.size,
    menorIntervaloS: intervals.length ? Math.min(...intervals) : 0, duranteFalaOuTraco,
    ganchosIguaisSeguidos: ganchos.slice(1).filter((g, i) => g === ganchos[i]).length,
    motivosDaEspera,
  };
}

export function imprimirMedicao140(r: ResultadoMedicao140): boolean {
  const checks: [string, number, string, boolean][] = [
    ["perguntas da análise antes de terminei", r.feitasAntesDoTerminei, "≥ 6", r.feitasAntesDoTerminei >= 6],
    ["maior intervalo com critério/decisão pendente (s)", r.maiorIntervaloComLacunaS, "≤ 120", r.maiorIntervaloComLacunaS <= 120],
    ["perguntas antes do fechamento (%)", r.percentualAntesDoFechamento, "≥ 70", r.percentualAntesDoFechamento >= 70],
    ["critérios provocados até 70%", r.criteriosAte70, `= ${r.totalCriterios}`, r.criteriosAte70 === r.totalCriterios],
    ["critérios não explorados no fim", r.naoExploradosNoFim, "≤ 1", r.naoExploradosNoFim <= 1],
    ["menor intervalo entre perguntas (s)", r.menorIntervaloS, "≥ 45", r.menorIntervaloS >= 45],
    ["perguntas durante fala ou traço", r.duranteFalaOuTraco, "= 0", r.duranteFalaOuTraco === 0],
    ["ganchos iguais consecutivos", r.ganchosIguaisSeguidos, "= 0", r.ganchosIguaisSeguidos === 0],
  ];
  console.log(`# Medição determinística #140 — ${r.sala} (30 min, sem rede)`);
  console.log(`Perguntas: ${r.perguntas.length} · ganchos: ${r.ganchos.join(", ")}`);
  for (const motivo of r.motivosDaEspera ?? []) console.log(`  ${motivo}`);
  for (const [nome, valor, limite, ok] of checks) console.log(`${ok ? "OK" : "FALHA"} ${nome}: ${valor} (limite ${limite})`);
  return checks.every(([, , , ok]) => ok);
}

export function medicao140Passou(r: ResultadoMedicao140): boolean {
  return r.feitasAntesDoTerminei >= 6
    && r.maiorIntervaloComLacunaS <= 120
    && r.percentualAntesDoFechamento >= 70
    && r.criteriosAte70 === r.totalCriterios
    && r.naoExploradosNoFim <= 1
    && r.menorIntervaloS >= 45
    && r.duranteFalaOuTraco === 0
    && r.ganchosIguaisSeguidos === 0;
}

export async function simularQuadro(persona: Persona, opcoes: { llm: LlmCliente; duracaoMin: number; silencioso?: boolean }) {
  const log = opcoes.silencioso ? () => {} : (l: string) => console.log(l);
  const sortear = rng(persona.nome.length * 7919);
  const tempos = escalarTempos(TEMPOS_PADRAO, opcoes.duracaoMin);
  const problema = kit.problemas[0];
  const deps = { llm: opcoes.llm, kit, problema, log: () => {} };

  let t = 0;
  let cliente: EstadoEntrevista = estadoInicial();
  let servidor: EstadoSessao = estadoServidorInicial({
    tempos,
    criterios: kit.criterios.map((c) => c.id),
    plano: { cargo: "Desenvolvedor Backend Pleno", senioridade: "pleno", tom: "amigavel", dicas: "leves", foco: [{ area: "tecnico", peso: 1 }], notas: "", duracaoMin: opcoes.duracaoMin },
  });
  // Mesma conta do navegador (useEntrevista.ts): a duração total é a da simulação, como o COMECAR a manda.
  const duracaoDaFaseSim = (c: EstadoEntrevista) => duracaoEfetivaDaFaseS(c.fase, {
    faseIniciadaEm: c.faseIniciadaEm, iniciadaEm: c.iniciadaEm ?? null, duracaoTotalS: opcoes.duracaoMin * 60,
    duracaoFaseS: tempos[c.fase as keyof typeof tempos],
  });
  const cli = (ev: EventoEntrevista) => {
    const antes = cliente.fase;
    cliente = transicionar(cliente, ev, t);
    if (cliente.fase !== antes) {
      servidor = transicionarServidor(servidor, { tipo: "SINCRONIZAR_FASE", fase: cliente.fase }, t).estado;
      log(`[${mmss(t)}] — fase ${cliente.fase}`);
      if (cliente.fase === "APROFUNDAMENTO") agendado.push({ em: t + 500, motivo: "início do aprofundamento", forcar: true });
      if (cliente.fase === "REQUISITOS") {
        ultimaAtividade = t;
        ultimoDisparoParado = 0;
      }
    }
  };
  const srv = (ev: EventoSessao) => {
    servidor = transicionarServidor(servidor, ev, t).estado;
  };

  // Navegador
  let ultimaAtividade = 0;
  let ultimaFalaEm = -10_000;
  let ultimoDesenhoEm = -10_000;
  let ultimoDisparoParado = 0;
  let falando = false;
  let agenteFalandoAte = 0;
  let ultimaFalaDoAgenteEm: number | null = null;
  let pausaEm: number | null = null;
  let versao = 0;
  let versaoAnalisada = -1;
  let desenhadas = 0;
  let desenhadasAnalisadas = 0;
  let mudancaDesde: number | null = null;
  let empecilhoFeito = false;
  let empecilhoEm = -Infinity;
  let licencaDeNovoEm = 0;
  let ultimoPedidoEmpecilho = -Infinity;
  type Rodando = { fimEm: number; resposta: RespostaDoAgente; pedido: PedidoAnalise; inicio: number; valeu: boolean; falaAoAnalisar: number; motivo: string; ajustes: string[] };
  const voo: { rodando: Rodando | null } = { rodando: null };
  let esperando: { forcar: boolean; motivo: string } | null = null;
  const agendado: { em: number; motivo: string; forcar: boolean }[] = [];
  let motivoDaPendente = "";

  // Candidato
  let passo: (Passo & { fimEm: number; proximoTraco?: number }) | null = null;
  let respondendo: { falaAte: number } | null = null;

  const interrupcoes: Interrupcao[] = [];
  const contagem = { analises: 0, querPerguntar: 0, barradasServidor: 0, barradasConteudo: 0, barradasQuadro: 0, descartadasPorFala: 0, lentas: 0, canceladasPorFala: 0, licencas: 0, brechasDaMudanca: 0 };

  const grafo = () => `COMPONENTES E CONEXÕES\n${LINHAS.slice(0, desenhadas).join("\n")}`;

  async function disparar(forcar: boolean, motivo: string): Promise<void> {
    const ocupado = !podeAnalisar(cliente) || falando || t < agenteFalandoAte;
    if (ocupado) {
      agendado.push({ em: t + 1_000, motivo, forcar });
      return;
    }
    if (voo.rodando) {
      esperando = { forcar: (esperando?.forcar ?? false) || forcar, motivo };
      return;
    }
    if (!forcar && versao === versaoAnalisada) return;
    versaoAnalisada = versao;
    mudancaDesde = null;
    const novas = LINHAS.slice(desenhadasAnalisadas, desenhadas);
    desenhadasAnalisadas = desenhadas;
    const pedido: PedidoAnalise = {
      sessao_id: `linha-${persona.nome}`,
      fase: servidor.fase,
      grafo: grafo(),
      mudancas: novas.length ? `Novo: ${novas.join("; ")}` : "(nada mudou no desenho)",
      conversa_recente: servidor.conversa.slice(-6).map(({ quem, texto }) => ({ quem, texto })),
      perguntas_feitas: cliente.perguntasFeitas,
      imagem_url: null,
      parado_ha_s: Math.round((t - ultimaAtividade) / 1000),
    };
    contagem.analises++;
    const r = await analisar(deps, servidor, pedido, t);
    const ms = r.diagnostico.ms ?? 0;
    voo.rodando = {
      fimEm: t + Math.min(ms, LIMITE_PADRAO_MS),
      resposta: r.resposta,
      pedido,
      inicio: t,
      valeu: ms <= LIMITE_PADRAO_MS && r.diagnostico.origem !== "erro",
      falaAoAnalisar: ultimaFalaEm,
      motivo,
      ajustes: r.diagnostico.ajustes,
    };
    if (r.diagnostico.ajustes.includes("abre_brecha_empecilho")) contagem.brechasDaMudanca++;
    if (r.diagnostico.ajustes.includes("rebaixada_pela_politica")) contagem.barradasServidor++;
    if (r.diagnostico.ajustes.some((a) => a === "piso_entre_perguntas" || a === "sem_parte_fechada")) contagem.barradasConteudo++;
    if (r.resposta.status !== "ok" || r.diagnostico.ajustes.includes("rebaixada_pela_politica")) contagem.querPerguntar++;
    servidor = r.estado;
  }

  const fimDaEntrevista = Object.values(tempos).reduce<number>((s, x) => s + (x ?? 0), 0) * 1000 + 60_000;
  cli({ tipo: "COMECAR", duracaoMin: opcoes.duracaoMin });
  srv({ tipo: "COMECAR" });
  t += 20_000; // apresentação
  cli({ tipo: "APRESENTACAO_TERMINOU" });
  srv({ tipo: "APRESENTACAO_TERMINOU" });

  while (cliente.fase !== "ENCERRADA" && t < fimDaEntrevista) {
    t += TICK_MS;
    // Tempo da fase, como o navegador (useEntrevista.ts): a duração efetiva (o APROFUNDAMENTO vai até 85% do tempo total,
    // #129) e nenhum timer no FECHAMENTO ou com o fechamento em andamento: a entrevista acaba pela duração total.
    const dur = cliente.faseIniciadaEm !== null && cliente.fase !== "FECHAMENTO" && !cliente.fechamento ? duracaoDaFaseSim(cliente) : undefined;
    if (dur !== undefined && cliente.faseIniciadaEm !== null && t - cliente.faseIniciadaEm >= dur * 1000) cli({ tipo: "TEMPO_DA_FASE_ACABOU" });
    if ((cliente.fase as Fase) === "ENCERRADA") break;

    // Candidato.
    if (cliente.plin === "PERGUNTA_ATIVA") {
      if (!respondendo && t >= agenteFalandoAte) respondendo = { falaAte: t + persona.respostaS * 1000 };
      if (respondendo) {
        if (t < respondendo.falaAte) {
          falando = true;
          ultimaFalaEm = t;
          ultimaAtividade = t;
        } else {
          falando = false;
          if (t - ultimaFalaEm >= FIM_DA_RESPOSTA_MS) {
            srv({ tipo: "CANDIDATO_FALOU", texto: "resposta", fimDeResposta: true });
            cli({ tipo: "RESPOSTA_TERMINOU" });
            respondendo = null;
            agendado.push({ em: t, motivo: "fim de resposta", forcar: true });
          }
        }
      }
    } else if (t >= agenteFalandoAte) {
      if (!passo || t >= passo.fimEm) {
        if (passo?.tipo === "fala") {
          falando = false;
          srv({ tipo: "CANDIDATO_FALOU", texto: "explicação", fimDeResposta: false });
          // A fala vai ao /perguntar; às vezes o Totti comenta sem perguntar e o quadro reanalisa logo depois.
          if (sortear() < COMENTA_DEPOIS_DA_FALA) {
            agenteFalandoAte = t + 3_000;
            ultimaFalaDoAgenteEm = t;
            cli({ tipo: "AGENTE_RESPONDEU" });
            agendado.push({ em: t + 3_000, motivo: "depois de um comentário do Totti", forcar: true });
          }
        }
        const pesos = { ...persona.passos };
        const fracao = cliente.faseIniciadaEm !== null && dur ? (t - cliente.faseIniciadaEm) / (dur * 1000) : 0;
        // Requisitos: conversa primeiro, desenha só na segunda metade. Fechamento: só conversa.
        if ((cliente.fase === "REQUISITOS" && fracao < 0.5) || cliente.fase === "FECHAMENTO") pesos.desenha = { ...pesos.desenha, peso: 0 };
        const total = pesos.desenha.peso + pesos.fala.peso + pesos.pausa.peso;
        let x = sortear() * total;
        const tipo = (["desenha", "fala", "pausa"] as const).find((k) => (x -= pesos[k].peso) < 0) ?? "pausa";
        const [a, b] = pesos[tipo].s;
        const ms = Math.round((a + sortear() * (b - a)) * 1000);
        passo = { tipo, ms, fimEm: t + ms, proximoTraco: t };
      }
      if (passo.tipo === "fala") {
        falando = true;
        ultimaFalaEm = t;
        ultimaAtividade = t;
        // Fala do candidato cancela a dúvida pendente (CANDIDATO_CONTINUOU no quadro).
        if (cliente.plin === "PLIN_PENDENTE") {
          cli({ tipo: "CANDIDATO_CONTINUOU" });
          if ((cliente.plin as string) === "LIVRE") contagem.canceladasPorFala++;
        }
      } else if (passo.tipo === "desenha" && passo.proximoTraco !== undefined && t >= passo.proximoTraco) {
        passo.proximoTraco = t + 2_500;
        if (desenhadas < LINHAS.length) desenhadas++;
        versao++;
        ultimaAtividade = t;
        ultimoDesenhoEm = t;
        if (cliente.fase !== "REQUISITOS" || desenhadas >= 2) {
          cli({ tipo: "CANDIDATO_DESENHOU" });
          srv({ tipo: "CANDIDATO_DESENHOU" });
        }
        pausaEm = t + PAUSA_PADRAO_MS;
        // Como o gatilho: desenhando sem parar, analisa mesmo assim depois da espera máxima.
        mudancaDesde ??= t;
        if (t - mudancaDesde >= RITMO.analiseMaximaSemPausaMs) {
          pausaEm = null;
          await disparar(false, "trabalho contínuo");
        }
      }
    }

    // Gatilho: pausa depois de desenhar, silêncio, pedidos agendados.
    if (pausaEm !== null && t >= pausaEm) {
      pausaEm = null;
      await disparar(false, "pausa depois de desenhar");
    }
    // A mesma regra do navegador (lib/sessao/silencio.ts, deveForcarAnalise): depois de uma fala do Totti, espera
    // SILENCIO_SEM_ACAO_S e quebra uma vez por período de silêncio.
    if (cliente.plin === "LIVRE" && deveForcarAnalise({ agora: t, fase: cliente.fase, ultimaAtividade, ultimaFalaDoAgente: ultimaFalaDoAgenteEm, ultimoDisparo: ultimoDisparoParado })) {
      ultimoDisparoParado = t;
      await disparar(true, `silêncio de ${Math.round((t - ultimaAtividade) / 1000)} s`);
    }
    const vencidos = agendado.filter((x) => x.em <= t);
    agendado.splice(0, agendado.length, ...agendado.filter((x) => x.em > t));
    // Como no gatilho: vários pedidos juntos viram um só (o último vence, forçado se algum era).
    if (vencidos.length) {
      const ultimo = vencidos[vencidos.length - 1];
      await disparar(vencidos.some((v) => v.forcar), ultimo.motivo);
    }

    // Resultado da análise em voo.
    if (voo.rodando && t >= voo.rodando.fimEm) {
      const r: Rodando = voo.rodando;
      voo.rodando = null;
      if (!r.valeu) contagem.lentas++;
      else if (ultimaFalaEm > r.falaAoAnalisar) {
        if (r.resposta.status !== "ok") contagem.descartadasPorFala++;
      } else {
        // Como a rota (lib/agente/rotas/handlers.ts): a resposta é refiltrada com o estado de agora, para o piso e o
        // ritmo valerem contra o que o candidato ouviu durante a análise.
        const resposta = refiltrarComEstadoAtual(servidor, r.resposta, r.pedido, r.inicio, t) as unknown as RespostaAnalise;
        const antes = cliente.plin;
        if (resposta.status !== "ok" && resposta.pergunta && !aceitaPlin(cliente, resposta, t)) contagem.barradasQuadro++;
        cli({ tipo: "ANALISE_RECEBIDA", resposta });
        if (cliente.plin === "PLIN_PENDENTE" && antes !== "PLIN_PENDENTE") motivoDaPendente = r.motivo;
      }
      if (esperando) {
        const e: { forcar: boolean; motivo: string } = esperando;
        esperando = null;
        await disparar(e.forcar, e.motivo);
      }
    }

    // Tomada de turno: a dúvida pendente entra na primeira pausa da fala.
    const podeFalar = podeTomarTurno({ agora: t, ultimaFalaEm, falaParcial: falando, agenteFalando: t < agenteFalandoAte, aguardandoResposta: false });
    // Como no useEntrevista: só numa pausa real (sem desenhar nem falar), ou logo depois de um marco de fase.
    const parado = { maosParadasHaMs: t - ultimoDesenhoEm, falaHaMs: t - ultimaFalaEm };
    const momentoOk = motivoDoMomento({ ...parado, marco: marcoDeFase(cliente, t), esperandoHaMs: t - (cliente.pendenteDesde ?? t),
      atrasada: interrupcaoAtrasada(ritmoDoCliente(cliente, t)) }) === null;
    const respiroDaMudanca = t - empecilhoEm >= RITMO.respiroMs;
    // Como o useEntrevista: no meio do desenho, numa pausa curta, o Totti pede licença antes de perguntar.
    const desenhando = t - ultimoDesenhoEm < 12_000;
    const pausaCurta = motivoDoMomento({ ...parado, marco: true }) === null;
    let liberou = false;
    if (cliente.plin === "PLIN_PENDENTE" && podeFalar && respiroDaMudanca && desenhando && (momentoOk || pausaCurta) && t >= licencaDeNovoEm) {
      agenteFalandoAte = t + 3_000;
      contagem.licencas++;
      // Ele responde: "pode" (70%) ou "espera".
      if (sortear() < 0.7) liberou = true;
      else licencaDeNovoEm = t + 45_000;
    }
    if (cliente.plin === "PLIN_PENDENTE" && (liberou || (podeFalar && momentoOk && !desenhando && respiroDaMudanca)) && cliente.perguntaPendente) {
      const p = cliente.perguntaPendente;
      const fase = cliente.fase;
      cli({ tipo: "PLIN_CLICADO" });
      // O mesmo caminho da linha do tempo (POST de eventos): o quadro manda o texto da pergunta que falou.
      for (const ev of eventosDaMaquina("pergunta", { numero: cliente.perguntasFeitas, pergunta: p.pergunta, nota: p.nota, elementos: p.elementos, status: p.status })) {
        servidor = transicionarServidor(servidor, ev, t).estado;
      }
      agenteFalandoAte = t + FALA_DA_PERGUNTA_MS;
      ultimaFalaDoAgenteEm = t;
      passo = null;
      const i: Interrupcao = { t, fase, tipo: p.status, motivo: liberou ? `${motivoDaPendente}; com licença` : motivoDaPendente, desenhando: t - ultimoDesenhoEm < 2_000, texto: p.pergunta ?? "" };
      interrupcoes.push(i);
      log(`[${mmss(t)}] ${fase.padEnd(14)} INTERRUPÇÃO ${interrupcoes.length} (${i.tipo}; ${i.motivo}${i.desenhando ? "; NO MEIO DO DESENHO" : ""}) ${i.texto.slice(0, 90)}`);
    }

    // Mudança no problema (empecilho): uma vez, numa pausa, sem pergunta no ar.
    // Mesma regra do navegador (useEntrevista.ts): depois da garantia dos 60% (GARANTIA_A_PARTIR_DA_FRACAO), sai com
    // pausa curta e sem pergunta ativa; antes, com o quadro livre e a pausa de sempre.
    const garantia = emGarantiaDoEmpecilho({ agora: t, iniciadaEm: cliente.iniciadaEm ?? null, duracaoTotalS: opcoes.duracaoMin * 60 });
    const plinOk = garantia ? cliente.plin !== "PERGUNTA_ATIVA" : cliente.plin === "LIVRE";
    const pausaOk = motivoDoMomento(garantia ? { ...parado, marco: true } : parado) === null;
    if (!empecilhoFeito && plinOk && podeFalar && pausaOk && t - ultimoPedidoEmpecilho >= 15_000) {
      ultimoPedidoEmpecilho = t;
      const espera = esperaDoEmpecilho({
        agora: t, fase: cliente.fase, faseIniciadaEm: cliente.faseIniciadaEm, duracaoDaFaseS: duracaoDaFaseSim(cliente),
        jaAnunciado: false, respondendoPergunta: false, componentes: contarComponentes(grafo()), ultimaFalaDoAgenteEm,
        iniciadaEm: cliente.iniciadaEm ?? null, duracaoTotalS: opcoes.duracaoMin * 60, ultimaPerguntaEm: cliente.ultimaPerguntaEm ?? null,
      });
      if (espera === null) {
        empecilhoFeito = true;
        empecilhoEm = t;
        agenteFalandoAte = t + 10_000;
        ultimaFalaDoAgenteEm = t;
        ultimaAtividade = t;
        passo = null;
        interrupcoes.push({ t, fase: cliente.fase, tipo: "empecilho", motivo: "mudança no problema", desenhando: t - ultimoDesenhoEm < 2_000, texto: "mudança no problema" });
        log(`[${mmss(t)}] ${cliente.fase.padEnd(14)} INTERRUPÇÃO ${interrupcoes.length} (mudança no problema)`);
      }
    }
  }
  return { persona: persona.nome, duracaoMin: opcoes.duracaoMin, interrupcoes, contagem, fim: t };
}

export function resumo(r: Awaited<ReturnType<typeof simularQuadro>>): string {
  const mudanca = r.interrupcoes.find((i) => i.tipo === "empecilho");
  const porFase = new Map<string, number>();
  for (const i of r.interrupcoes) porFase.set(i.fase, (porFase.get(i.fase) ?? 0) + 1);
  const gaps = r.interrupcoes.slice(1).map((i, k) => (i.t - r.interrupcoes[k].t) / 1000).sort((a, b) => a - b);
  const mediana = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  return [
    `${r.persona} (${r.duracaoMin} min): ${r.interrupcoes.length} interrupções · ${[...porFase].map(([f, n]) => `${f} ${n}`).join(", ")}`,
    `  intervalo entre elas: mín ${gaps[0] ?? "–"} s, mediana ${mediana ?? "–"} s · no meio do desenho: ${r.interrupcoes.filter((i) => i.desenhando).length}`,
    `  mudança no problema: ${mudanca ? `entrou aos ${mmss(mudanca.t)} (${mudanca.fase}, ${Math.round((mudanca.t / (r.duracaoMin * 60_000)) * 100)}% do tempo)` : "não entrou"} · brechas abertas pela análise ${r.contagem.brechasDaMudanca}`,
    `  análises ${r.contagem.analises}, quis perguntar ${r.contagem.querPerguntar}, barradas no servidor ${r.contagem.barradasServidor}, pelo conteúdo (sem parte fechada ou piso) ${r.contagem.barradasConteudo}, no quadro ${r.contagem.barradasQuadro}, descartadas por fala ${r.contagem.descartadasPorFala}, canceladas por fala ${r.contagem.canceladasPorFala}, lentas ${r.contagem.lentas}, licenças pedidas ${r.contagem.licencas}`,
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--offline")) {
    if (!imprimirMedicao140(medirOfflineQuadro())) process.exitCode = 1;
    return;
  }
  const valor = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const modo = valor("--llm") ?? "real";
  const duracaoMin = Number(valor("--duracao")) || 35;
  const nomes = valor("--persona")?.split(",");
  const resumos: string[] = [];
  for (const p of PERSONAS.filter((x) => !nomes || nomes.includes(x.nome))) {
    console.log(`\n# ${p.nome} (${modo})`);
    const antes = instantaneo();
    const r = await simularQuadro(p, { llm: modo === "sempre" ? llmSempre() : criarClientePrincipal(), duracaoMin });
    resumos.push(`${resumo(r)}\n  custo de LLM (análise do quadro; sem a fala e o relatório):\n${resumoDoCusto(antes)}`);
  }
  console.log(`\n${resumos.join("\n")}`);
}

if (process.argv[1]?.endsWith("linha-do-tempo-quadro.ts")) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => process.exit());
}
