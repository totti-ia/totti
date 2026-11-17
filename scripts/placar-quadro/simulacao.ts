// Entrevista simulada no quadro: um LLM faz o candidato (com persona e um roteiro de intenções) e o Totti responde
// pelas mesmas funções do servidor (perguntar e analisar), com o relógio simulado. O fluxo imita o quadro:
//   - cada fala do candidato vai para o /perguntar;
//   - se o Totti não devolveu uma pergunta, roda a análise (como o quadro faz depois de uma resposta sem "?");
//   - pergunta da análise que vira plin é clicada na hora e a próxima fala do candidato responde a ela.
import "../_gasto";
import { z } from "zod";
import { analisar } from "../../lib/agente/analisar";
import type { LlmCliente } from "../../lib/agente/llm/cliente";
import { perguntar } from "../../lib/agente/perguntar";
import { estadoInicial, transicionar, type EstadoSessao } from "../../lib/agente/sessao/estado";
import type { Fase, PedidoAnalise } from "../../lib/agente/sessao/tipos";
import { chatJsonVia } from "../../lib/llm/openaiCompat";
import { openrouter } from "../../lib/llm/openrouter";
import { kit, problema } from "./casos";
import { PROVEDOR_PLACAR } from "./juiz";
import { repetirRespostaIncompleta } from "./tentativas";

/** Quem faz o candidato: de outra família que o Totti e o juiz, para não se espelharem. */
export const MODELO_CANDIDATO =
  process.env.PLACAR_MODELO_CANDIDATO || (PROVEDOR_PLACAR === openrouter ? "openai/gpt-5.4-mini" : "deepseek-ai/DeepSeek-V3.2");

const PASSO_DO_RELOGIO_MS = 50_000;

/** Fase de cada fala do candidato, na ordem do roteiro. */
const FASES_DO_ROTEIRO: Fase[] = [
  "REQUISITOS", "REQUISITOS", "REQUISITOS",
  "ALTO_NIVEL", "ALTO_NIVEL", "ALTO_NIVEL", "ALTO_NIVEL",
  "APROFUNDAMENTO", "APROFUNDAMENTO", "APROFUNDAMENTO", "APROFUNDAMENTO",
];

const DESENHO_PEQUENO = `COMPONENTES
- [r1] Cliente (retângulo)
- [r2] API (retângulo)
- [e1] Banco (elipse)
CONEXÕES
- [s1] Cliente → API
- [s2] API → Banco`;

const DESENHO_MEDIO = `COMPONENTES
- [r1] Cliente (retângulo)
- [r2] API de encurtamento (retângulo)
- [r3] Cache Redis (retângulo)
- [e1] Postgres (elipse)
CONEXÕES
- [s1] Cliente → API de encurtamento
- [s2] API de encurtamento → Cache Redis "lê primeiro"
- [s3] Cache Redis → Postgres "se não achar"`;

const DESENHO_COMPLETO = `COMPONENTES
- [r1] Cliente (retângulo)
- [r2] Load balancer (retângulo)
- [r3] API de encurtamento (retângulo)
- [r4] Gerador de IDs (base62) (retângulo)
- [r5] Cache Redis (retângulo)
- [e1] Postgres primário (elipse)
- [e2] Réplica de leitura (elipse)
- [r6] Fila Kafka de cliques (retângulo)
- [r7] Worker de analytics (retângulo)
CONEXÕES
- [s1] Cliente → Load balancer
- [s2] Load balancer → API de encurtamento
- [s3] API de encurtamento → Gerador de IDs
- [s4] API de encurtamento → Cache Redis "lê primeiro"
- [s5] Cache Redis → Réplica de leitura "miss"
- [s6] API de encurtamento → Postgres primário "escreve"
- [s7] Postgres primário → Réplica de leitura "replica"
- [s8] API de encurtamento → Fila Kafka de cliques
- [s9] Fila Kafka de cliques → Worker de analytics`;

export type Persona = {
  id: string;
  descricao: string;
  /** Uma intenção por fala do candidato (mesmo tamanho de FASES_DO_ROTEIRO). */
  intencoes: string[];
  /** O desenho em cada fala. */
  desenhos: string[];
};

const SEM = "";
export const PERSONAS: Persona[] = [
  {
    id: "senior_claro",
    descricao: "Engenheira sênior, 9 anos de backend. Segura, objetiva, justifica as escolhas com números. Fala de forma natural, às vezes com 'tipo', 'então'.",
    intencoes: [
      "Cumprimente rápido e pergunte o volume de URLs novas.",
      "Pergunte por quanto tempo precisa guardar os links e se precisa de estatística de clique.",
      "Diga que já tem o suficiente e que vai começar a desenhar.",
      "Explique a API e o cache na frente do banco, com o porquê (leitura muito maior que escrita).",
      "Explique como gera o código curto (base62 de 7 caracteres a partir de um contador) e por quê.",
      "Pergunte quanto tempo ainda falta de entrevista.",
      "Diga que terminou a visão geral.",
      "Se o entrevistador fez uma pergunta, responda com um motivo concreto; senão comente a réplica de leitura.",
      "Se houver pergunta no ar, responda bem justificado; senão fale da fila de cliques e por que ela não atrasa o redirecionamento.",
      "Explique o que acontece se o Postgres primário cair.",
      "Peça um comentário sobre o desenho até aqui.",
    ],
    desenhos: [SEM, SEM, SEM, DESENHO_MEDIO, DESENHO_MEDIO, DESENHO_COMPLETO, DESENHO_COMPLETO, DESENHO_COMPLETO, DESENHO_COMPLETO, DESENHO_COMPLETO, DESENHO_COMPLETO],
  },
  {
    id: "junior_nervoso",
    descricao: "Desenvolvedor júnior, primeira entrevista de system design. Nervoso, se desculpa, hesita ('é...', 'acho que'), às vezes não sabe e diz isso.",
    intencoes: [
      "Diga que está nervoso e pergunte se pode fazer perguntas antes de começar.",
      "Pergunte quantos acessos o sistema tem.",
      "Diga que não sabe bem por onde começar.",
      "Conte que desenhou cliente, API e banco, sem muito porquê.",
      "Pergunte se pode usar qualquer banco.",
      "Pense em voz alta, sem perguntar nada ('deixa eu ver aqui...').",
      "Diga, inseguro, que acha que terminou.",
      "Se houver pergunta no ar, diga que não sabe; senão diga que não sabe o que mais colocar.",
      "Se houver pergunta no ar, responda de forma vaga ('acho que fica melhor assim'); senão faça um comentário vago sobre o banco.",
      "Peça para pular essa parte.",
      "Diga que se perdeu e peça desculpa.",
    ],
    desenhos: [SEM, SEM, SEM, DESENHO_PEQUENO, DESENHO_PEQUENO, DESENHO_PEQUENO, DESENHO_PEQUENO, DESENHO_PEQUENO, DESENHO_PEQUENO, DESENHO_PEQUENO, DESENHO_PEQUENO],
  },
  {
    id: "vago_testador",
    descricao: "Pleno que tenta atalhos: pede a resposta pronta, os critérios, se está certo. Responde vago ('é o padrão', 'todo mundo faz assim'), mas não é rude.",
    intencoes: [
      "Pergunte qual seria a arquitetura ideal para esse problema.",
      "Faça uma pergunta vaga de requisito ('é muito acesso?').",
      "Diga que vai começar e que no começo já decidiu que o código curto vai ter 7 caracteres.",
      "Diga que colocou um cache porque é o padrão.",
      "Pergunte se o entrevistador lembra quantos caracteres você disse no começo.",
      "Pergunte quais critérios estão sendo avaliados.",
      "Diga que terminou.",
      "Se houver pergunta no ar, responda vago ('todo mundo faz assim'); senão pergunte se o desenho está certo.",
      "Se houver pergunta no ar, tente mudar de assunto; senão pergunte se está indo bem.",
      "Explique o Redis antes do Postgres como já está no quadro, repetindo o que já disse.",
      "Pergunte o que acontece depois da entrevista e quando sai o resultado.",
    ],
    desenhos: [SEM, SEM, SEM, DESENHO_MEDIO, DESENHO_MEDIO, DESENHO_MEDIO, DESENHO_MEDIO, DESENHO_MEDIO, DESENHO_MEDIO, DESENHO_MEDIO, DESENHO_MEDIO],
  },
];

export type FonteTurno = "candidato" | "perguntar" | "analise";
export type Turno = {
  n: number;
  fase: Fase;
  fonte: FonteTurno;
  texto: string;
  /** Totti quieto (perguntar com responder=false). */
  quieto?: boolean;
  ms?: number;
  status?: string;
  /** Falha de infraestrutura (o candidato veria a fala de erro). */
  falhou?: boolean;
};

export type Conversa = { persona: string; turnos: Turno[] };

const EsquemaFala = z.object({ fala: z.string() });

async function falaDoCandidato(p: Persona, i: number, desenho: string, turnos: Turno[], perguntaNoAr: string | null): Promise<string> {
  const historico = turnos
    .filter((t) => !t.quieto)
    .map((t) => `${t.fonte === "candidato" ? "Você" : "Entrevistador"}: ${t.texto}`)
    .join("\n");
  const r = await repetirRespostaIncompleta(() => chatJsonVia(PROVEDOR_PLACAR, {
    model: MODELO_CANDIDATO,
    system: `Você faz o papel de um CANDIDATO numa entrevista de system design por voz, em português do Brasil. Não é assistente: é a pessoa sendo entrevistada.
Quem você é: ${p.descricao}
O que você sabe: só o enunciado e o que o entrevistador já disse. Você desenha num quadro enquanto fala.
Como falar: como fala transcrita de gente (1 a 3 frases), no seu jeito. Sem markdown, sem listas, sem narrar ações entre asteriscos.
Responda só com JSON: {"fala": "..."}`,
    user: `ENUNCIADO: ${problema.enunciado}

O QUE ESTÁ NO SEU QUADRO AGORA:
${desenho || "(quadro vazio)"}

CONVERSA ATÉ AGORA:
${historico || "(começo da entrevista)"}

${perguntaNoAr ? `PERGUNTA DO ENTREVISTADOR NO AR (a sua fala responde a ela): ${perguntaNoAr}\n\n` : ""}SUA INTENÇÃO NESTA FALA: ${p.intencoes[i]}`,
    schema: EsquemaFala,
    maxTokens: 400,
    temperature: 0.8,
  }), (tentativa) => console.warn(`[placar] resposta sem mensagem para o candidato; repetindo (${tentativa}/2)`));
  return r.data.fala.trim();
}

function pedidoDeAnalise(estado: EstadoSessao, fase: Fase, grafo: string, desenhoAnterior: string, requisitos: string[]): PedidoAnalise {
  return {
    sessao_id: "placar-local",
    fase,
    grafo,
    mudancas: grafo === desenhoAnterior ? "(nada mudou)" : "o candidato acrescentou elementos ao desenho",
    conversa_recente: estado.conversa.slice(-6).map((f) => ({ quem: f.quem, texto: f.texto })),
    perguntas_feitas: estado.perguntasFeitas,
    imagem_url: null,
    parado_ha_s: 10,
    requisitos,
  };
}

/** Roda uma entrevista simulada inteira e devolve os turnos (com o tempo de cada chamada do Totti). */
export async function simular(llm: LlmCliente, p: Persona, log: (linha: string) => void = () => {}, progresso: (conversa: Conversa) => void = () => {}): Promise<Conversa> {
  const deps = { llm, kit, problema, log: () => {} };
  const t0 = Date.now();
  let agora = t0;
  let estado: EstadoSessao = transicionar(estadoInicial({ criterios: kit.criterios.map((c) => c.id) }), { tipo: "SINCRONIZAR_FASE", fase: "REQUISITOS" }, agora).estado;
  const turnos: Turno[] = [];
  const requisitos: string[] = [];
  let desenhoAnterior = "";
  let n = 0;

  for (let i = 0; i < FASES_DO_ROTEIRO.length; i++) {
    agora += PASSO_DO_RELOGIO_MS;
    const fase = FASES_DO_ROTEIRO[i];
    if (estado.fase !== fase) estado = transicionar(estado, { tipo: "SINCRONIZAR_FASE", fase }, agora).estado;
    const grafo = p.desenhos[i];
    const perguntaNoAr = estado.perguntaAtiva?.pergunta ?? null;

    const fala = await falaDoCandidato(p, i, grafo, turnos, perguntaNoAr);
    turnos.push({ n: ++n, fase, fonte: "candidato", texto: fala });
    progresso({ persona: p.id, turnos: [...turnos] });
    log(`  [${fase}] candidato: ${fala}`);

    const inicio = Date.now();
    const r = await perguntar(deps, estado, { fase, texto: fala, grafo, perguntaAtiva: perguntaNoAr ?? undefined, requisitosAtuais: requisitos }, agora);
    const ms = Date.now() - inicio;
    estado = r.estado;
    if (r.requisito && !requisitos.includes(r.requisito)) requisitos.push(r.requisito);
    // Fala que respondeu à pergunta ativa: registra o desfecho e libera o plin, como o quadro faz.
    if (perguntaNoAr && estado.perguntaAtiva) {
      const numero = estado.perguntaAtiva.numero;
      if (r.desfecho) estado = transicionar(estado, { tipo: "DESFECHO_DA_PERGUNTA", numero, desfecho: r.desfecho, resposta: fala }, agora).estado;
      estado = { ...estado, plin: "LIVRE", perguntaAtiva: null, ultimaRespostaEm: agora };
    }
    turnos.push({ n: ++n, fase, fonte: "perguntar", texto: r.responder ? r.texto : "", quieto: !r.responder, ms, ...(r.falhou ? { falhou: true } : {}) });
    log(`  [${fase}] Totti (${ms} ms): ${r.responder ? r.texto : r.falhou ? "(FALHOU)" : "(quieto)"}`);

    // Sem pergunta de volta: o quadro analisa o desenho logo depois (e nas pausas).
    if (!r.responder || !r.texto.includes("?")) {
      agora += 5_000;
      const inicioAnalise = Date.now();
      const a = await analisar(deps, estado, pedidoDeAnalise(estado, fase, grafo, desenhoAnterior, requisitos), agora);
      const msAnalise = Date.now() - inicioAnalise;
      estado = a.estado;
      if (estado.plin === "PLIN_PENDENTE" && estado.perguntaPendente?.pergunta) {
        agora += 1_000;
        estado = transicionar(estado, { tipo: "PLIN_CLICADO" }, agora).estado;
        const texto = estado.perguntaAtiva?.pergunta ?? "";
        turnos.push({ n: ++n, fase, fonte: "analise", texto, ms: msAnalise, status: a.resposta.status });
        log(`  [${fase}] Totti, por iniciativa (${msAnalise} ms, ${a.resposta.status}): ${texto}`);
      } else {
        // Análise que ficou quieta conta no tempo, mas não vira fala.
        turnos.push({ n: ++n, fase, fonte: "analise", texto: "", quieto: true, ms: msAnalise, status: a.resposta.status, ...(a.diagnostico.origem === "erro" ? { falhou: true } : {}) });
      }
    }
    desenhoAnterior = grafo;
    progresso({ persona: p.id, turnos: [...turnos] });
  }
  return { persona: p.id, turnos };
}
