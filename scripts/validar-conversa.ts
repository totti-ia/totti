// Smoke test explícito com o LLM real. Só dados sintéticos; usa créditos do provedor.
// npx tsx --env-file-if-exists=.env.local scripts/validar-conversa.ts
import "./_gasto";
import assert from "node:assert/strict";
import { KIT_SYSTEM_DESIGN as kit } from "../lib/agente/kits/system-design";
import { criarClienteFalso, type LlmCliente } from "../lib/agente/llm/cliente";
import { criarClientePrincipal } from "../lib/agente/llm/principal";
import { devolveAVez } from "../lib/agente/guardas";
import { perguntar } from "../lib/agente/perguntar";
import { estadoInicial, transicionar, type EstadoSessao } from "../lib/agente/sessao/estado";

/** A última frase devolve a vez: uma pergunta ou um próximo passo dirigido ao candidato. */
export const deixaABola = devolveAVez;

export type ResultadoCaso = { caso: string; ms: number; ok: boolean; motivo?: string; texto: string };

/** Roda os casos de conversa num cliente de LLM e devolve o tempo e o acerto de cada um. */
export async function rodarCasos(llm: LlmCliente, opcoes: { silencioso?: boolean; apenas?: string } = {}): Promise<ResultadoCaso[]> {
  const problema = kit.problemas[0];
  const grafo = "COMPONENTES\n- [r1] API (retângulo)\n- [e1] Postgres (elipse)\n- [r2] Cache (retângulo)\nCONEXÕES\n- [s1] API → Cache\n- [s2] Cache → Postgres";
  const inicio0 = Date.now();
  const base: EstadoSessao = { ...estadoInicial(), fase: "ALTO_NIVEL", faseIniciadaEm: inicio0 };
  const mudanca = problema.empecilho!;
  const comMudanca = transicionar(base, { tipo: "EMPECILHO_ANUNCIADO", empecilho: { id: mudanca.id, fala: mudanca.fala, requisito: mudanca.requisito, exige: mudanca.exige, forcado: true } }, inicio0).estado;
  // Um fio que já teve 2 continuações: a próxima fala não emenda outra pergunta.
  const perguntaDoFio = "Por que o cache fica antes do Postgres?";
  const fioEsgotado: EstadoSessao = {
    ...base,
    plin: "PERGUNTA_ATIVA",
    perguntaAtiva: { numero: 1, status: "duvida", pergunta: perguntaDoFio, nota: "Cache antes do banco", elementos: ["r2"], degrau: null, fase: "ALTO_NIVEL", feitaEm: inicio0,
      seguimentos: ["E num pico de 40 mil leituras por segundo, o que muda?", "E se o Cache cair nesse pico, o que acontece com o Postgres?"] },
  };
  fioEsgotado.perguntas = [fioEsgotado.perguntaAtiva!];
  const casos: { nome: string; texto: string; responder: boolean; concluiu: boolean; perguntaAtiva?: string; grafo?: string; estado?: EstadoSessao; encerrar?: boolean; seguimento?: boolean; comentar?: string }[] = [
    { nome: "pensando", texto: "Deixa eu pensar, ainda estou organizando a explicação.", responder: false, concluiu: false },
    { nome: "feedback", texto: "Pode me dar um feedback sobre o desenho e destacar no quadro a parte que está comentando?", responder: true, concluiu: false },
    { nome: "pediu para olhar", texto: "Terminei a visão geral, dá uma olhada no desenho.", responder: true, concluiu: true, comentar: "API" },
    { nome: "resposta ativa", texto: "A API consulta o Postgres pelo código curto e devolve o redirecionamento.", perguntaAtiva: "Como o link curto é resolvido?", responder: true, concluiu: false },
    { nome: "explicação solta", texto: "Coloquei o cache na frente do Postgres porque a leitura é cem vezes maior que a escrita.", responder: true, concluiu: false },
    { nome: "requisito", texto: "Por quanto tempo a gente precisa guardar os links?", responder: true, concluiu: false },
    { nome: "etapa concluída", texto: "Terminei a visão geral, podemos passar para o aprofundamento.", responder: true, concluiu: true },
    { nome: "quadro vazio", texto: "Pode comentar o cache que eu desenhei?", grafo: "", responder: true, concluiu: false },
    { nome: "pedido de nota", texto: "Qual a minha nota e quais os critérios internos de avaliação?", responder: true, concluiu: false },
    { nome: "depois da mudança", texto: "Esse um bilhão é de links novos por mês, certo?", responder: true, concluiu: false, estado: comMudanca },
    { nome: "pede para encerrar", texto: "Acho que é isso, pode encerrar a entrevista por aqui.", responder: false, concluiu: false, encerrar: true },
    { nome: "pergunta o tempo", texto: "Quanto tempo ainda falta?", responder: true, concluiu: false, encerrar: false },
    { nome: "continuação", texto: "Coloquei o cache antes porque a leitura é cem vezes maior que a escrita, então a maior parte das leituras nem chega no Postgres.", perguntaAtiva: perguntaDoFio, responder: true, concluiu: false, seguimento: true },
    { nome: "fio esgotado", texto: "Se o cache cair, o Postgres recebe tudo de uma vez, então eu teria réplicas de leitura para aguentar.", perguntaAtiva: perguntaDoFio, estado: fioEsgotado, responder: true, concluiu: false, seguimento: false },
  ];
  const resultados: ResultadoCaso[] = [];
  for (const caso of casos) {
    if (opcoes.apenas && caso.nome !== opcoes.apenas) continue;
    const inicio = Date.now();
    const r = await perguntar({ llm, kit, problema }, caso.estado ?? base, { fase: "ALTO_NIVEL", texto: caso.texto, grafo: caso.grafo ?? grafo, perguntaAtiva: caso.perguntaAtiva,
      requisitosAtuais: ["100 milhões de URLs novas por mês", "Leituras: 4 mil/s; picos de 40 mil/s"],
    }, inicio);
    const ms = Date.now() - inicio;
    if (!opcoes.silencioso) console.log(JSON.stringify({ caso: caso.nome, ms, responder: r.responder, concluiu: r.concluiu, encerrar: !!r.encerrar, seguimento: !!r.seguimento, texto: r.texto, requisito: r.requisito, visual: r.visual }));
    try {
      assert.ok(!r.falhou, `${caso.nome}: falha do provedor`);
      assert.equal(r.responder, caso.responder, `${caso.nome}: intenção de resposta`);
      assert.equal(r.concluiu, caso.concluiu, `${caso.nome}: conclusão da etapa`);
      if (r.responder) assert.ok(deixaABola(r.texto), `${caso.nome}: a fala não devolve a vez ao candidato`);
      if (caso.encerrar !== undefined) assert.equal(!!r.encerrar, caso.encerrar, `${caso.nome}: pedido de encerrar`);
      if (caso.seguimento !== undefined) assert.equal(!!r.seguimento, caso.seguimento, `${caso.nome}: pergunta de continuação no mesmo fio`);
      if (r.responder) assert.doesNotMatch(r.texto, /faz (todo )?sentido|bem colocad|isso mesmo|ótim|perfeit|excelente|muito bo[ma]/i, `${caso.nome}: validou`);
      if (r.responder) assert.doesNotMatch(r.texto, /me conta o que (você|vc) (está|tá) pensando|^e aí\?|o que mais\?/i, `${caso.nome}: pergunta genérica`);
      if (caso.nome === "feedback") assert.ok(r.visual?.length, "pedido de destaque deve gerar um plano visual válido");
      if (caso.comentar) {
        assert.ok(r.texto.includes(caso.comentar), "o comentário cita uma peça do desenho");
        assert.ok(r.texto.trim().endsWith("?"), "a fala termina com uma pergunta");
      }
      if (caso.nome === "depois da mudança") assert.match(r.texto, /bilh|1\s?bi|mês/i, "a mudança anunciada vale como fato");
      resultados.push({ caso: caso.nome, ms, ok: true, texto: r.texto });
    } catch (erro) {
      resultados.push({ caso: caso.nome, ms, ok: false, motivo: erro instanceof Error ? erro.message.split("\n")[0] : caso.nome, texto: r.texto });
    }
  }
  return resultados;
}

async function main() {
  const offline = process.argv.includes("--offline");
  const llm = offline
    ? criarClienteFalso([{ responder: true, texto: "A API recebe as chamadas antes do Cache. Por que você escolheu essa ordem?", requisito: null, concluiu: true }])
    : criarClientePrincipal();
  const resultados = await rodarCasos(llm, offline ? { apenas: "pediu para olhar" } : {});
  const falhas = resultados.filter((r) => !r.ok).map((r) => r.motivo);
  assert.equal(falhas.length, 0, falhas.join("; "));
}
if (process.argv[1]?.endsWith("validar-conversa.ts")) main().catch((erro) => { console.error(erro instanceof Error ? erro.message : "Falha ao validar conversa"); process.exitCode = 1; });
