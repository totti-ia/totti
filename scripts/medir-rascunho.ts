// Mede o ganho da resposta antecipada do Totti com os modelos reais, pelos mesmos caminhos do servidor.
//
// Para cada fala de uma lista fixa, dois cenários a partir do MESMO estado (cada um numa cópia com id novo):
//   normal:     só a confirmação, sem rascunho. Latência = tempo da confirmação.
//   antecipado: dispara o rascunho (sem await), espera ANTECEDENCIA_MS (o tempo que sobra entre o fim da fala e o
//               fechamento do turno: ~2,6 s) e roda a confirmação. Latência = só a confirmação, sem a espera.
// A ordem dos cenários alterna entre as falas. A conversa segue pelo cenário normal. Tudo em sequência, nunca em paralelo.
//
//   npm run rascunho:medir -- sala ide pre        (sem argumentos: as três áreas)
//   RODADAS=3 npm run rascunho:medir -- sala      (repete a conversa inteira da área)
//   FALAS=2 npm run rascunho:medir -- ide         (corta a lista de falas, para validar)
//   ANTECEDENCIA_MS=2600 (padrão)
//
// Usa créditos da Featherless (primário de produção). Sem --pago a OpenRouter fica desligada (ver _gasto), então uma
// área que depender dela para e é relatada sem derrubar as outras.
import "./_gasto";
import { randomUUID } from "node:crypto";
import { POST as perguntarRota } from "../app/api/sessoes/[id]/perguntar/route";
import { criarRepositorioEmMemoria, type RepositorioSessoes } from "../lib/agente/armazenamento";
import { KIT_SYSTEM_DESIGN as kit } from "../lib/agente/kits/system-design";
import { criarClientePrincipal } from "../lib/agente/llm/principal";
import { definirContextoParaTestes } from "../lib/agente/rotas/contexto";
import { estadoInicial } from "../lib/agente/sessao/estado";
import type { ChatMessage } from "../lib/contracts";
import { copiaDaSessao, prepararRascunho as prepararRascunhoIde, turnoComRascunho, type PedidoDoTurno } from "../lib/agents/rascunho";
import { VAGAS } from "../fixtures/pre-entrevista/vagas";
import { classificarVaga } from "../lib/pre-entrevista/classificador";
import { extrairCompetencias } from "../lib/pre-entrevista/competencias";
import { depsQueReaproveitam, prepararRascunho as prepararRascunhoPre } from "../lib/pre-entrevista/resposta-antecipada";
import { criarSessao, type Sessao } from "../lib/pre-entrevista/sessoes";
import { abrirConversa, conduzirTurno } from "../lib/pre-entrevista/turno";
import { appendEvent, getOrCreateSession } from "../lib/session/store";
import type { SessionState } from "../lib/session/types";

const ANTECEDENCIA_MS = Number(process.env.ANTECEDENCIA_MS) || 2600;
const RODADAS = Number(process.env.RODADAS) || 1;
const FALAS_MAX = Number(process.env.FALAS) || Infinity;

type AreaId = "pre" | "sala" | "ide";
const NOMES: Record<AreaId, string> = {
  pre: "Pré-entrevista",
  sala: "Sala de system design",
  ide: "Live coding (IDE)",
};

/** Uma área: como começar a conversa, copiar o estado e rodar os dois cenários. `S` é o estado da conversa. */
interface Area<S> {
  falas: string[];
  iniciar(): Promise<S>;
  /** Cópia independente (id novo) do estado. */
  clonar(base: S): Promise<S>;
  /** Confirmação sem rascunho. Muda `s`: a conversa segue por ele. */
  normal(s: S, fala: string): Promise<{ ms: number; usado: boolean }>;
  /** Rascunho em `s`, espera `antecedencia`, confirmação. A cópia `s` é descartada depois. */
  antecipado(s: S, fala: string, antecedencia: number): Promise<{ ms: number; usado: boolean }>;
}

interface Medicao {
  rodada: number;
  fala: number;
  texto: string;
  normalMs?: number;
  antecipadoMs?: number;
  usado?: boolean;
  erros: string[];
}

const FALAS_PRE = [
  "Pode ser, vamos nessa.",
  "Quero focar em falhas de rede no meio do fluxo de pagamento, isso é o que mais pesa.",
  "Também quero ver idempotência e consistência entre os serviços.",
  "Escala e banco de dados importam mais que o resto, a parte de linguagem é secundária.",
  "Pode ser uns sessenta minutos, porque o desenho é grande.",
  "Sem dicas, ele que se vire.",
  "Acho que está bom assim, pode fechar a configuração.",
];

const FALAS_SALA = [
  "Então, eu começaria pelo cliente mandando a URL para uma API de encurtamento.",
  "Para gerar o id curto eu usaria base62 em cima de um contador.",
  "Para leitura, o cache Redis na frente do banco resolve a maior parte.",
  "Acho que a réplica de leitura segura o pico de redirecionamentos.",
  "Os cliques eu mandaria para uma fila e processaria em lote no worker.",
  "Se o banco cair, ainda dá para redirecionar pelo cache por um tempo.",
  "Não sei muito bem como dimensionar o Redis, nunca fiz isso.",
  "Acho que o load balancer distribui entre as instâncias da API.",
];

const FALAS_IDE = [
  "Vou começar percorrendo a string com dois ponteiros.",
  "Acho que um dicionário para contar as letras resolve.",
  "Não tenho certeza se precisa tratar o caso da lista vazia.",
  "Vou fazer uma versão simples primeiro e depois otimizar.",
  "A complexidade fica em O(n), porque percorre uma vez.",
  "Pode ser que eu esteja errado, mas acho que o laço de fora está certo.",
  "Vou testar com a entrada de exemplo antes de mudar o código.",
  "Tá, vou trocar para um set, deve ficar mais rápido.",
];

const dormir = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));
const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

/**
 * Roda a confirmação e mede só ela. Espera o rascunho que ainda sobrou depois de medir, para que ele não entre no
 * tempo da próxima fala.
 */
async function medirComRascunho<T>(rascunho: Promise<unknown>, confirmacao: () => Promise<T>): Promise<{ valor: T; ms: number }> {
  const inicio = Date.now();
  try {
    const valor = await confirmacao();
    return { valor, ms: Date.now() - inicio };
  } finally {
    await rascunho;
  }
}

// ---------------------------------------------------------------------------------------------
// Pré-entrevista: conduzirTurno direto, com as dependências de resposta-antecipada.ts
// ---------------------------------------------------------------------------------------------

const VAGA_PRE = VAGAS.find((v) => v.id === "backend-senior-pagamentos");

const areaPre: Area<Sessao> = {
  falas: FALAS_PRE,
  async iniciar() {
    if (!VAGA_PRE) throw new Error("vaga backend-senior-pagamentos não existe em fixtures/pre-entrevista/vagas.ts");
    const vaga = { roleTitle: VAGA_PRE.roleTitle, jobDescription: VAGA_PRE.jobDescription };
    const classificacao = await classificarVaga(vaga);
    const competencias = await extrairCompetencias(vaga);
    const sessao = criarSessao(vaga, classificacao, Date.now(), competencias);
    abrirConversa(sessao);
    return sessao;
  },
  async clonar(base) {
    const copia = structuredClone(base);
    copia.id = randomUUID();
    return copia;
  },
  async normal(s, fala) {
    const inicio = Date.now();
    await conduzirTurno(s, fala, depsQueReaproveitam(s.id).deps);
    return { ms: Date.now() - inicio, usado: false };
  },
  async antecipado(s, fala, antecedencia) {
    const rascunho = prepararRascunhoPre(s, fala);
    await dormir(antecedencia);
    const { deps, contagem } = depsQueReaproveitam(s.id);
    const { ms } = await medirComRascunho(rascunho, () => conduzirTurno(s, fala, deps));
    return { ms, usado: contagem.doRascunho > 0 };
  },
};

// ---------------------------------------------------------------------------------------------
// Sala de system design: POST de verdade em app/api/sessoes/[id]/perguntar
// ---------------------------------------------------------------------------------------------

const GRAFO_SALA = `COMPONENTES
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

/** Sessão da sala de system design no repositório em memória (o id vem do repositório). */
let repoSala: RepositorioSessoes | undefined;

const postSala = (dados: unknown) =>
  new Request("http://localhost/api/sessoes/x/perguntar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dados),
  });
const paramsSala = (id: string) => ({ params: Promise.resolve({ id }) });
const corpoSala = (id: string, texto: string, extra: Record<string, unknown> = {}) => ({
  sessao_id: id,
  fase: "ALTO_NIVEL",
  texto,
  grafo: GRAFO_SALA,
  ...extra,
});

const areaSala: Area<{ id: string }> = {
  falas: FALAS_SALA,
  async iniciar() {
    const agora = Date.now();
    repoSala = criarRepositorioEmMemoria();
    definirContextoParaTestes({ repositorio: repoSala, llm: criarClientePrincipal(), agora: () => Date.now() });
    const s = await repoSala.criar({
      avaliacaoId: "demo",
      candidatoId: "medicao",
      estado: {
        ...estadoInicial({ criterios: kit.criterios.map((c) => c.id) }),
        fase: "ALTO_NIVEL",
        faseIniciadaEm: agora - 60_000,
        iniciadaEm: agora - 10 * 60_000,
        conversa: [
          { quem: "agente", texto: "Você tem o desenho de um encurtador de URLs. Por onde você começaria?", em: agora - 50_000 },
          { quem: "candidato", texto: "Começaria pela API de encurtamento que recebe a URL longa.", em: agora - 40_000 },
        ],
      },
    });
    return { id: s.id };
  },
  async clonar(base) {
    if (!repoSala) throw new Error("repositório da sala não foi criado");
    const atual = await repoSala.obter(base.id);
    if (!atual) throw new Error("sessão de base sumiu do repositório");
    const copia = await repoSala.criar({
      avaliacaoId: "demo",
      candidatoId: "medicao",
      estado: structuredClone(atual.estado),
    });
    return { id: copia.id };
  },
  async normal(s, fala) {
    const inicio = Date.now();
    const r = await perguntarRota(postSala(corpoSala(s.id, fala)), paramsSala(s.id));
    const ms = Date.now() - inicio;
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return { ms, usado: r.headers.get("x-totti-rascunho") === "usado" };
  },
  async antecipado(s, fala, antecedencia) {
    const rascunho = perguntarRota(postSala(corpoSala(s.id, fala, { rascunho: true })), paramsSala(s.id))
      .then((r) => r.text())
      .catch(() => "");
    await dormir(antecedencia);
    const { valor: r, ms } = await medirComRascunho(rascunho, () =>
      perguntarRota(postSala(corpoSala(s.id, fala)), paramsSala(s.id)),
    );
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return { ms, usado: r.headers.get("x-totti-rascunho") === "usado" };
  },
};

// ---------------------------------------------------------------------------------------------
// Live coding: helpers de lib/agents/rascunho.ts com o LLM real
// ---------------------------------------------------------------------------------------------

const CODIGO_INICIAL = "def f(s):\n    pass";
const CODIGO_AGORA = "def f(s):\n    for c in s:\n        pass";

interface EstadoIde {
  sessao: SessionState;
  mensagens: ChatMessage[];
}

/** O pedido do turno, com a fala do candidato no fim do histórico. Igual nos dois cenários. */
function pedidoIde(e: EstadoIde, fala: string): PedidoDoTurno {
  const messages: ChatMessage[] = [...e.mensagens, { role: "candidate", text: fala }];
  return {
    sessionId: e.sessao.sessionId,
    messages,
    reconheceu: false,
    liveCode: CODIGO_AGORA,
    liveLanguage: "python",
    turno: { messages, reconheceu: false },
  };
}

const areaIde: Area<EstadoIde> = {
  falas: FALAS_IDE,
  async iniciar() {
    const id = randomUUID();
    const sessao = getOrCreateSession(id);
    appendEvent(sessao, { type: "session_started", sessionId: id, t: 0, language: "python", problemId: sessao.config.problemId } as never);
    appendEvent(sessao, { type: "snapshot", sessionId: id, t: 0, version: 1, language: "python", code: CODIGO_INICIAL } as never);
    return { sessao, mensagens: [] };
  },
  async clonar(base) {
    const sessao = copiaDaSessao(base.sessao);
    sessao.sessionId = randomUUID();
    return { sessao, mensagens: [...base.mensagens] };
  },
  async normal(e, fala) {
    const r = await turnoComRascunho(e.sessao, pedidoIde(e, fala));
    e.mensagens = [...e.mensagens, { role: "candidate", text: fala }, { role: "agent", text: r.resposta.reply }];
    return { ms: r.ms, usado: r.doRascunho };
  },
  async antecipado(e, fala, antecedencia) {
    const pedido = pedidoIde(e, fala);
    const rascunho = prepararRascunhoIde(e.sessao, pedido);
    await dormir(antecedencia);
    const { valor: r, ms } = await medirComRascunho(rascunho, () => turnoComRascunho(e.sessao, pedido));
    return { ms, usado: r.doRascunho };
  },
};

// ---------------------------------------------------------------------------------------------
// Medição, tabelas e resumo
// ---------------------------------------------------------------------------------------------

/** Conversa inteira de uma área: cada fala roda os dois cenários a partir do mesmo estado. */
async function medirArea<S>(area: Area<S>): Promise<Medicao[]> {
  const medicoes: Medicao[] = [];
  const falas = area.falas.slice(0, FALAS_MAX);
  for (let rodada = 1; rodada <= RODADAS; rodada++) {
    let base: S = await area.iniciar();
    for (let i = 0; i < falas.length; i++) {
      const fala = falas[i];
      const m: Medicao = { rodada, fala: i + 1, texto: fala, erros: [] };
      medicoes.push(m);
      let copias: { n: S; a: S };
      try {
        copias = { n: await area.clonar(base), a: await area.clonar(base) };
      } catch (e) {
        m.erros.push(`cópia: ${erroDe(e)}`);
        continue;
      }
      // Alterna a ordem: a fala par começa pelo normal, a ímpar pelo antecipado. Os dois rodam em sequência.
      const normalPrimeiro = medicoes.length % 2 === 1;
      const rodarNormal = async () => {
        try {
          const p = await area.normal(copias.n, fala);
          m.normalMs = p.ms;
          base = copias.n; // a conversa segue pelo cenário normal
        } catch (e) {
          m.erros.push(`normal: ${erroDe(e)}`);
        }
      };
      const rodarAntecipado = async () => {
        try {
          const p = await area.antecipado(copias.a, fala, ANTECEDENCIA_MS);
          m.antecipadoMs = p.ms;
          m.usado = p.usado;
        } catch (e) {
          m.erros.push(`antecipado: ${erroDe(e)}`);
        }
      };
      if (normalPrimeiro) {
        await rodarNormal();
        await rodarAntecipado();
      } else {
        await rodarAntecipado();
        await rodarNormal();
      }
      console.log(`  rodada ${rodada} fala ${i + 1}: normal ${m.normalMs ?? "-"} ms | antecipado ${m.antecipadoMs ?? "-"} ms | rascunho ${m.usado === undefined ? "-" : m.usado ? "usado" : "novo"}${m.erros.length ? ` | erros: ${m.erros.join("; ")}` : ""}`);
    }
  }
  return medicoes;
}

function percentil(valores: number[], p: number): number | undefined {
  if (!valores.length) return undefined;
  const ordenado = [...valores].sort((a, b) => a - b);
  return ordenado[Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length))];
}

interface Resumo {
  nome: string;
  n: number;
  falhas: number;
  normalP50?: number;
  normalP95?: number;
  antecipadoP50?: number;
  antecipadoP95?: number;
  ganhoP50?: number;
  usoRascunho: number;
}

function resumir(nome: string, medicoes: Medicao[]): Resumo {
  const pares = medicoes.filter((m) => m.normalMs !== undefined && m.antecipadoMs !== undefined);
  const normais = pares.map((m) => m.normalMs as number);
  const antecipados = pares.map((m) => m.antecipadoMs as number);
  const normalP50 = percentil(normais, 50);
  const antecipadoP50 = percentil(antecipados, 50);
  return {
    nome,
    n: pares.length,
    falhas: medicoes.filter((m) => m.erros.length > 0).length,
    normalP50,
    normalP95: percentil(normais, 95),
    antecipadoP50,
    antecipadoP95: percentil(antecipados, 95),
    ganhoP50: normalP50 !== undefined && antecipadoP50 !== undefined ? normalP50 - antecipadoP50 : undefined,
    usoRascunho: pares.length ? pares.filter((m) => m.usado).length / pares.length : 0,
  };
}

const fmt = (v: number | undefined) => (v === undefined ? "-" : `${Math.round(v)}`);

function imprimirTabela(medicoes: Medicao[]): void {
  console.log("\n| rodada | # | fala | normal (ms) | antecipado (ms) | rascunho usado | erros |");
  console.log("|---|---|---|---|---|---|---|");
  for (const m of medicoes) {
    const texto = m.texto.length > 50 ? `${m.texto.slice(0, 47)}...` : m.texto;
    const usado = m.usado === undefined ? "-" : m.usado ? "sim" : "não";
    console.log(`| ${m.rodada} | ${m.fala} | ${texto} | ${fmt(m.normalMs)} | ${fmt(m.antecipadoMs)} | ${usado} | ${m.erros.length || "-"} |`);
  }
}

function imprimirResumo(resumos: Resumo[], paradas: string[]): void {
  console.log(`\n## Resposta antecipada: ganho medido (antecedência ${ANTECEDENCIA_MS} ms, ${RODADAS} rodada(s))\n`);
  console.log("| Área | n | normal p50 / p95 (ms) | antecipado p50 / p95 (ms) | ganho p50 (ms) | rascunho usado | falas com erro |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of resumos) {
    const uso = r.n ? `${Math.round(r.usoRascunho * 100)}%` : "-";
    console.log(`| ${r.nome} | ${r.n} | ${fmt(r.normalP50)} / ${fmt(r.normalP95)} | ${fmt(r.antecipadoP50)} / ${fmt(r.antecipadoP95)} | ${fmt(r.ganhoP50)} | ${uso} | ${r.falhas} |`);
  }
  for (const p of paradas) console.log(`\nÁrea parou (não entra na tabela): ${p}`);
}

async function main() {
  const pedidas = process.argv.slice(2);
  const validas: AreaId[] = ["pre", "sala", "ide"];
  const desconhecidas = pedidas.filter((a) => !(validas as string[]).includes(a));
  if (desconhecidas.length) {
    console.error(`área desconhecida: ${desconhecidas.join(", ")}. Use: pre, sala, ide`);
    process.exitCode = 1;
    return;
  }
  const escolhidas = (pedidas.length ? pedidas : validas) as AreaId[];
  const executores: Record<AreaId, () => Promise<Medicao[]>> = {
    pre: () => medirArea(areaPre),
    sala: () => medirArea(areaSala),
    ide: () => medirArea(areaIde),
  };

  console.log(`Medição da resposta antecipada: áreas ${escolhidas.join(", ")}, antecedência ${ANTECEDENCIA_MS} ms, rodadas ${RODADAS}, até ${FALAS_MAX} falas por área`);
  const resumos: Resumo[] = [];
  const paradas: string[] = [];
  for (const id of escolhidas) {
    console.log(`\n== ${NOMES[id]} (${id}) ==`);
    try {
      const medicoes = await executores[id]();
      imprimirTabela(medicoes);
      resumos.push(resumir(NOMES[id], medicoes));
    } catch (e) {
      console.log(`  área parou: ${erroDe(e)}`);
      paradas.push(`${NOMES[id]}: ${erroDe(e)}`);
    }
  }
  imprimirResumo(resumos, paradas);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
