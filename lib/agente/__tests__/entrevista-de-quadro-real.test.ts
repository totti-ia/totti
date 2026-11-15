// O que deu errado numa entrevista real de system design (sessão a1fe8e5e, chat em tempo real) e não pode voltar:
// pergunta repetida, pedido de encerramento ignorado, peça citada sem marca, observação repetida no livro e a
// mudança no problema escrita por cima do desenho. E o fim da sessão 4e38b42f (#84): depois de "terminei", o Totti
// mandava seguir o desenho e a entrevista não fechava.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analisar } from "../analisar";
import { perguntaDeConducao, perguntaJaFeita } from "../guardas";
import { KIT_SYSTEM_DESIGN as kitDemo } from "../kits/system-design";
import { criarClienteFalso, ErroLlm } from "../llm/cliente";
import { perguntar } from "../perguntar";
import { estadoInicial, transicionar, type EstadoSessao } from "../sessao/estado";
import { extrairIdsDoGrafo, filtrarResposta, motivoBloqueioPlin } from "../sessao/politica";
import { garantirMarca, pecasCitadas } from "../../presenca/acoesVisuais";
import { DESPEDIDAS } from "../../totti/fechamento";
import { lugarLivreParaALinha } from "../../presenca/coreografia";
import { estadoInicial as estadoDoQuadro, marcoDoCliente, transicionar as transicionarQuadro, type EstadoEntrevista } from "../../sessao/estados";

const AGORA = 1_800_000_000_000;
const problema = kitDemo.problemas.find((p) => p.id === "chat_tempo_real")!;
const GRAFO = [
  "COMPONENTES",
  "- [r1] Novo usuário Número: Senha: (retângulo)",
  "- [r2] Contatos (retângulo)",
  "- [r3] Banco de dados Usuarios Cada usuario terá seus contatos salvos aqui (retângulo)",
  "- [r4] Conversa aberta (retângulo)",
  "CONEXÕES",
  "- [s1] Novo usuário Número: Senha: → Contatos",
].join("\n");

/** A mudança de cenário que já saiu (o encerramento só é oferecido depois dela, decisão F, #129). */
const MUDANCA_ANUNCIADA: NonNullable<EstadoSessao["empecilho"]> = {
  id: "teste_mudanca", fala: "Uma mudança no problema: o volume cresceu dez vezes.", requisito: "Mudança: volume 10x", exige: "Rever gargalos.",
  anunciadoEm: AGORA - 5 * 60_000, fase: "ALTO_NIVEL", forcado: false,
};
const JA_PERGUNTOU = "Se cada pessoa num grupo de cem mil faz uma requisição direta pro banco pra buscar mensagem, como você imagina que o banco se comporta com esse volume?";
const REPETIDA = "Se a gente mantiver essa ida direta ao banco para cada pessoa do grupo buscar mensagem, como você escalaria essa parte para aguentar o volume?";

function estadoEm(fase: EstadoSessao["fase"], extra: Partial<EstadoSessao> = {}): EstadoSessao {
  return { ...estadoInicial(), fase, faseIniciadaEm: AGORA - 5 * 60_000, iniciadaEm: AGORA - 8 * 60_000, ...extra };
}
const deps = (saida: Record<string, unknown>) => ({
  llm: criarClienteFalso([{ requisito: null, concluiu: false, desfecho: null, ...saida }]), kit: kitDemo, problema, log: () => {}, versao: "v2" as const,
});

describe("#83: convite durante requisitos na sessão a61b6346", () => {
  it("repassa 00:54 → 01:41 sem pergunta, mesmo se o modelo repetir o cumprimento", async () => {
    let estado = transicionar(estadoInicial(), { tipo: "SINCRONIZAR_FASE", fase: "REQUISITOS" }, AGORA + 54_000).estado;
    estado = transicionar(estado, { tipo: "CANDIDATO_FALOU", texto: "Me fala um pouco do volume, então.", fimDeResposta: false }, AGORA + 68_000).estado;
    estado = transicionar(estado, { tipo: "AGENTE_FALOU", texto: "São vinte mil mensagens por segundo." }, AGORA + 70_000).estado;
    const llm = criarClienteFalso([87, 101, 200].map(() => ({
      status: "duvida", pergunta: "Oi, tudo bem? Como você está pensando em abordar esse problema?",
      nota: "Como começar?", elementos: [], degrau: null,
      observacoes: [{ criterio: "requisitos", sinal: "positivo", espontaneo: true, evidencia: "Perguntou o volume de mensagens" }],
    })));
    for (const s of [87, 101, 200]) {
      if (s === 101) estado = transicionar(estado, {
        tipo: "CANDIDATO_FALOU", texto: "Como é? Cê falou o quê à noite?", fimDeResposta: false,
      }, AGORA + 90_000).estado;
      const r = await analisar({ llm, kit: kitDemo, problema, log: () => {} }, estado, {
        sessao_id: "a61b6346-63fe-46ac-abe2-0661fa2467dd", fase: "REQUISITOS", grafo: "", mudancas: "",
        conversa_recente: [], perguntas_feitas: 0, imagem_url: null, parado_ha_s: 120,
      }, AGORA + s * 1000);
      assert.equal(r.resposta.status, "ok", `aos ${s} segundos`);
      assert.equal(r.resposta.pergunta, null);
      assert.equal(r.estado.plin, "LIVRE");
      assert.equal(r.estado.perguntas.length, 0);
      estado = r.estado;
    }
    assert.equal(llm.chamadas.length, 3);
    assert.equal(estado.observacoes.length, 1, "evidência continua sendo colhida e deduplicada");
  });
});

describe("pergunta repetida", () => {
  it("reconhece a pergunta que o candidato reclamou de ouvir de novo", () => {
    assert.equal(perguntaJaFeita(REPETIDA, [JA_PERGUNTOU]), true);
    assert.equal(perguntaJaFeita("Como a mensagem chega em quem está offline?", [JA_PERGUNTOU]), false);
  });

  it("o Totti não repete: a pergunta sai da fala, e sem mais nada ele fica quieto", async () => {
    const estado = estadoEm("ALTO_NIVEL", { conversa: [{ quem: "agente", texto: JA_PERGUNTOU, em: AGORA - 40_000 }] });
    const r = await perguntar(deps({ responder: true, texto: REPETIDA }), estado, { fase: "ALTO_NIVEL", texto: "Vai ter uma lentidão, depende do banco.", grafo: GRAFO }, AGORA);
    assert.equal(r.responder, false);
  });
});

describe("candidato diz que terminou", () => {
  it("na primeira vez o Totti comenta uma peça e pergunta no mesmo turno", async () => {
    const r = await perguntar(deps({ responder: true, texto: "Tranquilo. O que mais você gostaria de detalhar ou adicionar no desenho?", concluiu: true }),
      estadoEm("APROFUNDAMENTO"), { fase: "APROFUNDAMENTO", texto: "Acho que eu terminei aqui.", grafo: GRAFO }, AGORA);
    assert.match(r.texto, /Novo usuário/);
    assert.ok(r.texto.trim().endsWith("?"), r.texto);
    assert.equal(r.concluiu, true);
    assert.equal(r.estado.conclusoes, 1);
    for (const vaga of ["Quer seguir para outra parte do desenho ou detalhar algo que a gente passou por cima?", "O que mais você gostaria de detalhar ou adicionar no desenho?"]) {
      assert.equal(perguntaDeConducao(vaga), true, vaga);
    }
    assert.equal(perguntaDeConducao("Por que você quer guardar as mensagens nesse banco?"), false);
    assert.equal(perguntaDeConducao("Como a mensagem chega em quem está offline?"), false);
    const semPergunta = await perguntar(deps({ responder: true, texto: "Tudo bem. Fica à vontade.", concluiu: true }),
      estadoEm("APROFUNDAMENTO"), { fase: "APROFUNDAMENTO", texto: "Acho que eu terminei aqui.", grafo: GRAFO }, AGORA);
    assert.match(semPergunta.texto, /Novo usuário/);
    assert.ok(semPergunta.texto.trim().endsWith("?"));
    // A pergunta já saiu no turno da conclusão, então a análise não pode emendar outra logo depois.
    assert.notEqual(motivoBloqueioPlin(semPergunta.estado, AGORA + 3_000, undefined, { paradoHaS: 3 }), null);
    assert.equal(motivoBloqueioPlin(semPergunta.estado, AGORA + 59_999, undefined, { paradoHaS: 59.999 }), "BOLA_COM_O_CANDIDATO");
  });
});

describe("#84: fechamento do quadro na sessão 4e38b42f", () => {
  const SESSAO = "4e38b42f-a919-46af-9b01-f0161242f4a2";
  // O caminho principal desenhado: cliente → servidor → banco.
  const DESENHO = [
    "COMPONENTES",
    "- [r1] App do usuário (retângulo)",
    "- [r2] Servidor de conexão (retângulo)",
    "- [r3] Banco de mensagens (retângulo)",
    "CONEXÕES",
    "- [s1] App do usuário → Servidor de conexão",
    "- [s2] Servidor de conexão → Banco de mensagens",
  ].join("\n");
  const MAIS_DESENHO = DESENHO.replace("CONEXÕES", "- [r4] Fila (retângulo)\nCONEXÕES") + "\n- [s3] Servidor de conexão → Fila";
  const PENDENTE = "Como a mensagem sai desse servidor de conexão e chega em quem está em outro servidor?";
  const MANDA_SEGUIR = /segu(e|ir|indo)|continu(a|ar|e)|próxima parte|pode desenhar|volt(a|ar) (a|ao|pro) desenh/i;
  const turno = (estado: EstadoSessao, texto: string, saida: Record<string, unknown> | Error, agora: number, extra: Record<string, unknown> = {}) => {
    const llm = criarClienteFalso([saida instanceof Error ? saida : { requisito: null, concluiu: false, desfecho: null, ...saida }]);
    return perguntar({ llm, kit: kitDemo, problema, log: () => {}, versao: "v2" as const }, estado,
      { fase: estado.fase, texto, sessao_id: SESSAO, grafo: DESENHO, desenhoParadoHaS: 10, ...extra }, agora).then((r) => ({ ...r, llm }));
  };
  /**
   * 12 minutos de entrevista, no alto nível, com uma dúvida da análise esperando a vez. A mudança de cenário já saiu:
   * sem ela, "terminei" é barrado (decisão F, #129), e estes testes são do fechamento, não da barra.
   */
  const antesDeTerminar = () => estadoEm("ALTO_NIVEL", {
    iniciadaEm: AGORA - 12 * 60_000,
    empecilho: MUDANCA_ANUNCIADA,
    plin: "PLIN_PENDENTE",
    perguntaPendente: { status: "duvida", parteFechada: true, escopo: false, pergunta: PENDENTE, nota: "Entre servidores?", elementos: ["r2"], visual: [{ tipo: "circular", alvo: "r2" }], degrau: null, observacoes: [], criadoEm: AGORA - 20_000 },
  });

  it("\"terminei\" → anúncio e primeira pergunta → respostas → última palavra → despedida", async () => {
    // 1. Ele diz que terminou, com o caminho principal no quadro. O modelo fica quieto: quem fala é o fechamento.
    const inicio = await turno(antesDeTerminar(), "Eu acho que é isso, terminei.", { responder: false, texto: "" }, AGORA);
    assert.equal(inicio.concluiu, true);
    assert.equal(inicio.fechamento, "perguntas_finais");
    assert.equal(inicio.estado.fase, "FECHAMENTO");
    assert.equal(inicio.texto, `Tá, olhei: App do usuário liga em Servidor de conexão. Beleza. Só preciso fechar uns pontos com você antes de encerrar. ${PENDENTE}`);
    assert.equal(inicio.perguntou, true);
    assert.equal(inicio.encerrar, undefined);
    // A pergunta que a análise tinha pronta sai agora, com a marca dela, e deixa de esperar a vez.
    assert.deepEqual(inicio.visual, [{ tipo: "circular", alvo: "r2" }]);
    assert.equal(inicio.estado.perguntaPendente, null);
    assert.equal(motivoBloqueioPlin(inicio.estado, AGORA + 5_000, undefined, { paradoHaS: 30 }), "FECHAMENTO");

    // 2. As respostas vão ao núcleo, uma atrás da outra: resposta, "não sei" e "pula" levam à pergunta seguinte.
    const falas: [string, Record<string, unknown>][] = [
      ["Eu colocaria um barramento de eventos entre os servidores.", { responder: true, texto: "Saquei.", desfecho: "respondeu" }],
      ["Não sei.", { responder: true, texto: "Tranquilo.", desfecho: "nao_sabe" }],
      ["Pula essa.", { responder: true, texto: "Sem problema.", desfecho: "pulou" }],
      ["Eu particionaria por conversa.", { responder: true, texto: "Certo. Pode seguir com a próxima parte do seu desenho.", desfecho: "respondeu" }],
    ];
    let estado = inicio.estado;
    let agora = AGORA;
    const perguntasOuvidas = [PENDENTE];
    let ultima = inicio as Awaited<ReturnType<typeof turno>>;
    for (const [fala, saida] of falas) {
      agora += 25_000;
      ultima = await turno(estado, fala, saida, agora);
      assert.equal(ultima.responder, true, fala);
      assert.equal(ultima.falhou, undefined);
      // Sem esperar análise, intervalo nem cota: a próxima fala já vem na resposta deste turno.
      assert.ok(ultima.texto.endsWith("?"), ultima.texto);
      assert.doesNotMatch(ultima.texto, MANDA_SEGUIR, "nenhuma fala manda continuar o desenho depois de concluído");
      const pergunta = ultima.estado.fechamento?.nucleo.atual?.pergunta;
      if (pergunta) {
        assert.equal(perguntasOuvidas.includes(pergunta), false, `pergunta repetida: ${pergunta}`);
        assert.ok(ultima.texto.endsWith(pergunta), ultima.texto);
        perguntasOuvidas.push(pergunta);
      }
      // O modelo só lê o turno: recebe a etapa do fechamento e um prazo curto.
      assert.match(ultima.llm.chamadas[0].sistema.dinamico ?? "", /Fechamento da entrevista: o desenho está concluído/);
      assert.equal(ultima.llm.chamadas[0].timeoutMs, 3500);
      estado = ultima.estado;
    }
    // 3. Acabaram as perguntas finais (quatro, no máximo): a última palavra é dele.
    assert.equal(perguntasOuvidas.length, 4);
    assert.equal(ultima.fechamento, "ultima_palavra");
    assert.match(ultima.texto, /Era isso da minha parte\. Quer acrescentar alguma coisa antes de encerrar\?$/);

    // 4. Ele não tem mais nada: a despedida do núcleo sai inteira e o quadro encerra.
    const fim = await turno(estado, "Não, é isso.", { responder: false, texto: "" }, agora + 20_000);
    assert.equal(fim.encerrar, true);
    assert.equal(fim.responder, true);
    assert.ok(DESPEDIDAS.includes(fim.texto), fim.texto);
    assert.equal(fim.fechamento, "encerrada");
    assert.equal(fim.estado.conversa.at(-1)?.texto, fim.texto);
  });

  it("ele retoma o desenho no meio das perguntas finais: o fechamento é suspenso e a fala é uma fala normal", async () => {
    const inicio = await turno(antesDeTerminar(), "Eu acho que é isso, terminei.", { responder: false, texto: "" }, AGORA);
    // O mesmo desenho, ou uma peça renomeada, não suspende.
    const mesma = await turno(inicio.estado, "Deixa eu pensar.", { responder: false, texto: "" }, AGORA + 10_000,
      { grafo: DESENHO.replace("Servidor de conexão (retângulo)", "Servidor de conexões (retângulo)") });
    assert.equal(mesma.fechamento, "perguntas_finais");
    assert.equal(mesma.responder, false, "ele ainda está pensando: o Totti espera");
    // Duas peças novas: ele voltou a desenhar.
    const voltou = await turno(mesma.estado, "Na verdade vou colocar uma fila aqui, pra aguentar o pico.", { responder: true, texto: "Hm." }, AGORA + 40_000, { grafo: MAIS_DESENHO });
    assert.equal(voltou.fechamento, "suspenso");
    assert.equal(voltou.estado.fechamento, null);
    assert.equal(voltou.estado.fase, "ALTO_NIVEL");
    assert.equal(voltou.encerrar, undefined);
    // Ele está desenhando de novo: o convite de seguir volta a valer (o desenho deixou de estar concluído).
    assert.equal(voltou.texto, "Hm. Pode continuar de onde parou.");
    assert.equal(voltou.estado.desenhoConcluido, null);
    assert.equal(voltou.llm.chamadas[0].timeoutMs, undefined);
    assert.doesNotMatch(voltou.llm.chamadas[0].sistema.dinamico ?? "", /Fechamento da entrevista/);
    // Quando ele disser de novo que terminou, o fechamento recomeça (segunda conclusão), sem repetir o que já ouviu.
    const deNovo = await turno(voltou.estado, "Agora sim, terminei.", { responder: false, texto: "" }, AGORA + 120_000, { grafo: MAIS_DESENHO });
    assert.equal(deNovo.fechamento, "perguntas_finais");
    assert.equal(deNovo.texto.includes(PENDENTE), false);
  });

  it("primeira conclusão sem o caminho principal: comenta e pergunta; na segunda, fecha", async () => {
    const primeira = await turno(estadoEm("APROFUNDAMENTO", { empecilho: MUDANCA_ANUNCIADA }), "Acho que eu terminei aqui.", { responder: true, texto: "Tudo bem.", concluiu: true }, AGORA, { grafo: GRAFO });
    assert.match(primeira.texto, /Novo usuário/);
    assert.ok(primeira.texto.trim().endsWith("?"), primeira.texto);
    assert.equal(primeira.fechamento, undefined);
    // Depois de concluído, o convite de seguir desenhando não passa, mesmo sem fechamento.
    const depois = await turno(primeira.estado, "E o que você acha do banco que eu escolhi?", { responder: true, texto: "Depende da leitura que você espera. Pode seguir com a próxima parte do seu desenho." }, AGORA + 20_000, { grafo: GRAFO });
    assert.doesNotMatch(depois.texto, MANDA_SEGUIR);
    assert.match(depois.texto, /Depende da leitura/);
    const segunda = await turno(depois.estado, "Já falei, pô. Eu acho que eu terminei aqui.", { responder: true, texto: "Tudo bem. Se quiser dar uma última olhada, fica à vontade.", concluiu: true }, AGORA + 60_000, { grafo: GRAFO });
    assert.equal(segunda.fechamento, "perguntas_finais");
    assert.match(segunda.texto, /^Tá, olhei: Novo usuário Número: Senha: liga em Contatos\. Beleza\. Só preciso fechar uns pontos com você antes de encerrar\. .+\?$/);
    assert.equal(segunda.estado.conclusoes, 2);
  });

  it("pedido explícito de encerrar: sai a despedida do núcleo, sem perguntas finais", async () => {
    // Com urgência ("tenho que sair agora"), o pedido vai direto à despedida. Sem urgência e sem critérios no plano, o
    // quadro vai à última palavra (decisão revisada, #129; ver perguntar.test.ts).
    const r = await turno(estadoEm("APROFUNDAMENTO"), "Acho que é isso, pode encerrar a entrevista.", { responder: false, texto: "", encerrar: true, urgente: true }, AGORA);
    assert.equal(r.encerrar, true);
    assert.ok(DESPEDIDAS.includes(r.texto), r.texto);
    assert.equal(r.fechamento, "encerrada");
    // Durante as perguntas finais o pedido também vale.
    const inicio = await turno(antesDeTerminar(), "Eu acho que é isso, terminei.", { responder: false, texto: "" }, AGORA);
    const pediu = await turno(inicio.estado, "Prefiro encerrar agora.", { responder: false, texto: "", encerrar: true }, AGORA + 15_000);
    assert.equal(pediu.encerrar, true);
    assert.ok(DESPEDIDAS.includes(pediu.texto), pediu.texto);
  });

  it("tempo acabando: fecha mesmo sem ele dizer que terminou, com as perguntas que cabem", async () => {
    // Faltam 2 minutos e meio de 35: cabe uma pergunta final. Ele perguntou algo: a resposta vem antes do anúncio.
    const quaseNoFim = estadoEm("APROFUNDAMENTO", { iniciadaEm: AGORA - (35 * 60_000 - 150_000) });
    const r = await turno(quaseNoFim, "Posso assumir que o grupo tem no máximo 256 pessoas?", { responder: true, texto: "Pode, são até 256 pessoas por grupo." }, AGORA);
    assert.equal(r.fechamento, "perguntas_finais");
    assert.match(r.texto, /^Pode, são até 256 pessoas por grupo\. O nosso tempo está acabando\./);
    assert.equal(r.estado.fechamento?.nucleo.gatilho, "tempo");
    assert.equal(r.estado.fechamento?.nucleo.fila.length, 0, "só cabia a pergunta que já foi feita");
    // Com tempo de sobra, uma fala comum não fecha nada.
    const cedo = await turno(estadoEm("APROFUNDAMENTO"), "Posso assumir que o grupo tem no máximo 256 pessoas?", { responder: true, texto: "Pode, são até 256 pessoas por grupo." }, AGORA);
    assert.equal(cedo.fechamento, undefined);
  });

  it("o modelo falha no meio do fechamento: a próxima fala sai do mesmo jeito", async () => {
    const inicio = await turno(antesDeTerminar(), "Eu acho que é isso, terminei.", { responder: false, texto: "" }, AGORA);
    const r = await turno(inicio.estado, "Eu colocaria um barramento de eventos entre os servidores.", new ErroLlm("timeout", "LLM passou de 3500ms"), AGORA + 20_000);
    assert.equal(r.falhou, undefined);
    assert.equal(r.responder, true);
    assert.ok(r.texto.endsWith("?"), r.texto);
    assert.equal(r.fechamento, "perguntas_finais");
  });

  it("provedor que ignora o timeout não segura a próxima pergunta por quatro segundos", async () => {
    const inicio = await turno(antesDeTerminar(), "Eu acho que é isso, terminei.", { responder: false, texto: "" }, AGORA);
    const comeco = performance.now();
    const r = await perguntar({ ...deps({}), llm: { completarJson: () => new Promise<never>(() => {}) } }, inicio.estado,
      { fase: "FECHAMENTO", texto: "Eu separaria leitura de escrita.", grafo: DESENHO }, AGORA + 20_000);
    assert.ok(performance.now() - comeco < 4000, "a leitura tem um teto real mesmo se o cliente ignorar o sinal");
    assert.equal(r.responder, true);
    assert.equal(r.fechamento, "perguntas_finais");
  });

  it("fala que substitui a anterior refaz o passo: a pergunta que ele não ouviu não é pulada", async () => {
    const inicio = await turno(antesDeTerminar(), "Eu acho que é isso, terminei.", { responder: false, texto: "" }, AGORA);
    const primeira = await turno(inicio.estado, "Eu colocaria um barramento", { responder: true, texto: "Saquei.", desfecho: "respondeu" }, AGORA + 20_000);
    // Ele continuou falando antes de ouvir: a fala junta substitui a anterior, e a pergunta seguinte é a mesma.
    const junta = await turno(primeira.estado, "Eu colocaria um barramento de eventos entre os servidores.", { responder: true, texto: "Saquei.", desfecho: "respondeu" }, AGORA + 23_000, { substitui: true });
    assert.equal(junta.texto, primeira.texto);
    assert.deepEqual(junta.estado.fechamento?.nucleo, primeira.estado.fechamento?.nucleo);
    // Substituir a fala que começou o fechamento desfaz o começo: a fala junta já não diz que ele terminou.
    const outra = await turno(inicio.estado, "Eu acho que é isso, terminei essa parte, agora vou ligar o cache.", { responder: true, texto: "Certo." }, AGORA + 4_000, { substitui: true, desenhoParadoHaS: 0 });
    assert.equal(outra.fechamento, "suspenso");
    assert.equal(outra.estado.fase, "ALTO_NIVEL");
    assert.equal(outra.estado.conclusoes, 0);
    assert.equal(outra.passoDoFechamento?.desfeito, true);
  });
});

describe("peça citada é marcada", () => {
  it("acha pelo nome as peças de que a fala trata", () => {
    assert.deepEqual(pecasCitadas("Como as mensagens passam desse banco de dados para a conversa aberta?", GRAFO), ["r3", "r4"]);
    assert.deepEqual(pecasCitadas("E se o destinatário estiver offline?", GRAFO), []);
  });

  it("pergunta com elementos e sem gesto ganha uma marca; o gesto do modelo fica como está", () => {
    assert.deepEqual(garantirMarca([], ["r3"]), [{ tipo: "marcar", alvo: "r3" }]);
    assert.deepEqual(garantirMarca([{ tipo: "anotar", texto: "Por quê?" }], ["r3"], 1), [{ tipo: "marcar", alvo: "r3" }, { tipo: "anotar", texto: "Por quê?" }]);
    const doModelo = [{ tipo: "enquadrar" as const, alvo: "r4" }];
    assert.deepEqual(garantirMarca(doModelo, ["r3"]), doModelo);
    assert.equal(garantirMarca(undefined, []), undefined);
  });

  it("a análise que devolve visual vazio com elementos sai com a marca", () => {
    const r = filtrarResposta(estadoEm("ALTO_NIVEL"), {
      status: "duvida", parteFechada: true, escopo: false, pergunta: "Por que os contatos ficam nesse banco?", nota: "Contatos no banco?", elementos: ["r3"], visual: [], degrau: null, observacoes: [],
    }, extrairIdsDoGrafo(GRAFO), AGORA);
    assert.deepEqual(r.visual, [{ tipo: "marcar", alvo: "r3" }]);
  });

  it("a pergunta da conversa que cita uma peça também marca", async () => {
    const r = await perguntar(deps({ responder: true, texto: "Como as mensagens saem desse banco de dados e chegam na conversa aberta?", visual: [] }),
      estadoEm("ALTO_NIVEL"), { fase: "ALTO_NIVEL", texto: "Pronto, tem alguma dúvida?", grafo: GRAFO }, AGORA);
    assert.equal(r.visual?.[0] && "alvo" in r.visual[0] ? r.visual[0].alvo : null, "r3");
  });
});

describe("livro de observações", () => {
  it("a mesma observação com outras palavras não entra de novo", () => {
    const obs = (evidencia: string, criterio = "requisitos") => ({ status: "ok" as const, parteFechada: false, escopo: false, pergunta: null, nota: null, elementos: [], degrau: null,
      observacoes: [{ criterio, sinal: "negativo" as const, espontaneo: false, evidencia }] });
    let e = estadoEm("ALTO_NIVEL");
    for (const evidencia of [
      "Começou a desenhar telas de cadastro e contatos sem alinhar escala ou funcionalidades principais.",
      "Candidato começou a desenhar telas de cadastro e contatos sem alinhar escala ou funcionalidades principais.",
      "Candidato desenhando telas de cadastro e contatos sem definir escala ou funcionalidades principais.",
    ]) e = transicionar(e, { tipo: "ANALISE_RECEBIDA", resposta: obs(evidencia) }, AGORA).estado;
    assert.equal(e.observacoes.length, 1);
    assert.equal(e.cobertura.requisitos.negativo, 1);
    // Outro critério, ou outro fato, entra.
    e = transicionar(e, { tipo: "ANALISE_RECEBIDA", resposta: obs("Propôs um banco de dados para cada grupo.", "dados_consistencia") }, AGORA).estado;
    assert.equal(e.observacoes.length, 2);
  });
});

describe("quadro", () => {
  it("o requisito novo não é escrito por cima do desenho do candidato", () => {
    const linha = { x: 40, y: 300, largura: 560, altura: 30 };
    assert.deepEqual(lugarLivreParaALinha(linha, [{ x: 700, y: 290, largura: 200, altura: 80 }]), linha);
    const desviada = lugarLivreParaALinha(linha, [{ x: 100, y: 280, largura: 300, altura: 120 }, { x: 500, y: 310, largura: 400, altura: 60 }]);
    assert.equal(desviada.x, 900 + 48);
    assert.equal(desviada.y, linha.y);
  });

  it("dizer que terminou é um marco no quadro: a pergunta seguinte não espera o intervalo", () => {
    let e: EstadoEntrevista = { ...estadoDoQuadro(), fase: "APROFUNDAMENTO", faseIniciadaEm: AGORA - 5 * 60_000 };
    assert.equal(marcoDoCliente(e, AGORA), false);
    e = transicionarQuadro(e, { tipo: "CANDIDATO_CONCLUIU" }, AGORA);
    assert.equal(e.fase, "APROFUNDAMENTO");
    assert.equal(marcoDoCliente(e, AGORA + 10_000), true);
    assert.equal(marcoDoCliente(e, AGORA + 60_000), false);
  });
});
