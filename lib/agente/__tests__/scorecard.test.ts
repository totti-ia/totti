import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventoArmazenado } from "../armazenamento/repositorio";
import { KIT_SYSTEM_DESIGN } from "../kits/system-design";
import { montarRelatorio } from "../relatorio";
import {
  aplicarGuardas,
  citacaoExiste,
  extrairFontes,
  gerarScorecardFalso,
  normalizar,
  montarEntradaDoPrompt,
  timeoutScorecardMs,
  SEM_EVIDENCIA,
  type SaidaScorecardLlm,
} from "../scorecard";
import { estadoInicial, transicionar } from "../sessao/estado";

const RUBRICA = KIT_SYSTEM_DESIGN.criterios;
const T1 = "2026-11-07T15:00:00.000Z";
const T2 = "2026-11-07T15:01:00.000Z";
const GRAFO = "COMPONENTES\n- [r1] Cliente (retângulo)\n- [e1] Postgres (elipse)\nCONEXÕES\n- [s1] Cliente → Postgres";

function ev(horario: string, tipo: string, dados: unknown): EventoArmazenado {
  return { horario, tipo, dados, recebidoEm: 0 };
}

function fontes() {
  let e = estadoInicial({ criterios: RUBRICA.map((c) => c.id) });
  e = transicionar(e, { tipo: "CANDIDATO_FALOU", texto: "Acho que um Postgres aguenta, é só criar um índice!", fimDeResposta: false }, Date.parse(T2)).estado;
  return {
    estado: e,
    f: extrairFontes(
      e,
      [ev(T1, "desenho", { grafo: GRAFO, mudancas: "+ x" }), ev(T2, "fala", { quem: "candidato", texto: "Vou usar cache na leitura" })],
      [{ numero: 1, horario: T1 }],
    ),
  };
}

function saida(parcial: Partial<SaidaScorecardLlm> = {}): SaidaScorecardLlm {
  return {
    nota_geral: 4,
    recomendacao: "avancar",
    criterios: RUBRICA.map((c) => ({
      criterio: c.id,
      nota: 3,
      justificativa: "ok",
      evidencias: [{ tipo: "fala" as const, horario: T2, texto: "cache na leitura", elementos: [], imagem: null }],
    })),
    pontos_fortes: ["a"],
    pontos_a_aprofundar: ["b"],
    briefing_para_proxima_etapa: "x",
    resumo_da_solucao: "Um banco e uma API.",
    resumo_da_entrevista: "Boa base.",
    ...parcial,
  };
}

function guardas(s: SaidaScorecardLlm) {
  return aplicarGuardas(s, { sessaoId: "s1", candidatoId: "c1", problemaId: "p1", rubrica: RUBRICA, fontes: fontes().f, origem: "llm" });
}

describe("scorecard: guardas", () => {
  it("todo critério da rubrica aparece exatamente uma vez (faltante vira sem nota, extra e repetido somem)", () => {
    const s = saida();
    s.criterios = [
      ...s.criterios.slice(0, 3),
      { ...s.criterios[0], nota: 1 },
      { criterio: "inventado", nota: 4, justificativa: "", evidencias: [] },
    ];
    const sc = guardas(s);
    assert.deepEqual(sc.criterios.map((c) => c.criterio), RUBRICA.map((c) => c.id));
    assert.equal(sc.criterios[0].nota, 3, "usa o primeiro repetido");
    assert.equal(sc.criterios[4].nota, null);
    assert.equal(sc.criterios[4].justificativa, SEM_EVIDENCIA);
  });

  it("nota sem evidência vira null com justificativa 'sem evidência suficiente'", () => {
    const s = saida();
    s.criterios[0] = { criterio: RUBRICA[0].id, nota: 4, justificativa: "ótimo", evidencias: [] };
    const sc = guardas(s);
    assert.equal(sc.criterios[0].nota, null);
    assert.match(sc.criterios[0].justificativa, /sem evidência suficiente/i);
  });

  it("fala precisa existir na conversa (normalizada); inventada é descartada e leva a nota junto", () => {
    const s = saida();
    s.criterios[0].evidencias = [{ tipo: "fala", horario: T2, texto: "ACHO que um postgres aguenta...", elementos: [], imagem: null }];
    s.criterios[1].evidencias = [{ tipo: "fala", horario: T2, texto: "frase que ninguém disse", elementos: [], imagem: null }];
    const sc = guardas(s);
    assert.equal(sc.criterios[0].evidencias.length, 1);
    assert.equal(sc.criterios[0].nota, 3);
    assert.equal(sc.criterios[1].evidencias.length, 0);
    assert.equal(sc.criterios[1].nota, null);
    assert.ok(sc.ajustes.some((a) => a.includes("citação não encontrada")));
  });

  it("desenho: ids inexistentes são removidos; sem referência válida é descartada", () => {
    const s = saida();
    s.criterios[0].evidencias = [{ tipo: "desenho", horario: T1, texto: null, elementos: ["e1", "zz9"], imagem: null }];
    s.criterios[1].evidencias = [{ tipo: "desenho", horario: "2020-01-01T00:00:00.000Z", texto: null, elementos: ["zz9"], imagem: null }];
    s.criterios[2].evidencias = [{ tipo: "desenho", horario: "2020-01-01T00:00:00.000Z", texto: null, elementos: ["r1"], imagem: "imagem 1 (2026-11-07T15:02:11.120Z)" }];
    s.criterios[3].evidencias = [{ tipo: "desenho", horario: T1, texto: null, elementos: [], imagem: "snap_7.png" }];
    const sc = guardas(s);
    assert.deepEqual(sc.criterios[0].evidencias[0].elementos, ["e1"]);
    assert.equal(sc.criterios[1].nota, null);
    assert.equal(sc.criterios[2].evidencias[0].horario, T1, "horário falso é trocado pelo do desenho em que o id apareceu");
    assert.equal(sc.criterios[2].evidencias[0].imagem, "/api/sessoes/s1/imagens/1");
    assert.equal(sc.criterios[3].evidencias[0].imagem, undefined, "imagem inexistente removida; horário válido mantém a prova");
  });

  it("nota_geral é recalculada como média das notas não nulas (1 casa)", () => {
    const s = saida({ nota_geral: 1 });
    s.criterios[0].nota = 4;
    s.criterios[1].nota = 2;
    s.criterios[2].nota = 2;
    const sc = guardas(s);
    assert.equal(sc.nota_geral, 2.8); // (4+2+2+3+3+3)/6 = 2.83
  });

  it("recomendação neutra quando menos da metade dos critérios tem evidência", () => {
    const s = saida({ recomendacao: "avancar" });
    for (let i = 0; i < 4; i++) s.criterios[i].evidencias = [];
    assert.equal(guardas(s).recomendacao, "evidencia_insuficiente");
    assert.equal(guardas(saida({ recomendacao: "avancar" })).recomendacao, "avancar");
  });

  it("sem nenhuma nota: nota_geral null", () => {
    const s = saida();
    s.criterios = s.criterios.map((c) => ({ ...c, evidencias: [] }));
    assert.equal(guardas(s).nota_geral, null);
  });
});

describe("scorecard: auxiliares", () => {
  it("normalizar tira acentos, pontuação e caixa", () => {
    assert.equal(normalizar("  Você, AGORA!! "), "voce agora");
  });
  it("citacaoExiste exige ao menos quatro caracteres significativos", () => {
    assert.equal(citacaoExiste("ok", [{ texto: "ok tudo bem" }]).ok, false);
    assert.equal(citacaoExiste("tudo ... bem", [{ texto: "ok tudo bem" }]).ok, true);
  });
  it("scorecard falso passa pelas mesmas guardas e cobre toda a rubrica", () => {
    const { estado } = fontes();
    const comObs = {
      ...estado,
      // O Totti puxou o assunto da carga: sem isso a escalabilidade não teria nota.
      conversa: [...estado.conversa, { quem: "agente" as const, texto: "E se o volume de acessos crescer dez vezes?", em: Date.parse(T1) }],
      observacoes: [
        { criterio: "escalabilidade", sinal: "negativo" as const, espontaneo: false, evidencia: "banco único", em: Date.parse(T2), fase: "APROFUNDAMENTO" as const,
          desenho: { horario: T1, grafo: GRAFO } },
      ],
    };
    const sc = gerarScorecardFalso(
      { kit: KIT_SYSTEM_DESIGN, problema: KIT_SYSTEM_DESIGN.problemas[0] },
      { sessaoId: "s1", candidatoId: "c1", estado: comObs, eventos: [ev(T1, "desenho", { grafo: GRAFO })], imagens: [] },
    );
    assert.equal(sc.origem, "fake");
    assert.equal(sc.criterios.length, RUBRICA.length);
    const esc = sc.criterios.find((c) => c.criterio === "escalabilidade");
    assert.equal(esc?.nota, 1);
    assert.ok((esc?.evidencias.length ?? 0) > 0);
    assert.equal(sc.recomendacao, "evidencia_insuficiente");
  });
});

describe("scorecard: regressões de proveniência", () => {
  it("só candidato é prova; fala sem autor, entrevistador e marcadores são contexto", () => {
    const estado = estadoInicial();
    estado.conversa = [{ quem: "agente", texto: "Sugiro cache distribuído", em: Date.parse(T1) },
      { quem: "candidato", texto: "(respondeu)", em: Date.parse(T2) }];
    const f = extrairFontes(estado, [
      ev(T1, "fala", { quem: "agente", texto: "Sugiro cache distribuído" }),
      ev(T1, "fala", { texto: "Não há autor" }),
      ev(T1, "resposta", { quem: "agente", texto: "Resposta do entrevistador" }),
      ev(T1, "resposta", { texto: "(respondeu)" }),
      ev(T2, "resposta", { quem: "candidato", texto: "Eu escolhi cache local" }),
    ], []);
    assert.deepEqual(f.falas.map(f => f.texto), ["Eu escolhi cache local"]);
  });

  it("não concatena falas distintas, não reordena trechos nem ignora negações", () => {
    assert.equal(citacaoExiste("cache ... distribuído", [{ texto: "cache" }, { texto: "distribuído" }]).ok, false);
    assert.equal(citacaoExiste("distribuído ... cache", [{ texto: "cache distribuído" }]).ok, false);
    assert.equal(citacaoExiste("não ... usaria cache", [{ texto: "eu usaria cache" }]).ok, false);
    assert.equal(citacaoExiste("cache", [{ texto: "cacheado" }]).ok, false);
  });

  it("imagem aceita referências explícitas e data não interfere no número", () => {
    const s = saida();
    const valores = ["1", "imagem 1 (2026-11-07T15:02:11.120Z)", "/imagens/1", "/api/sessoes/s1/imagens/1", "snap_1.png", "/api/sessoes/outra/imagens/1"];
    s.criterios.forEach((c, i) => { c.evidencias = [{ tipo: "desenho", horario: T1, texto: null, elementos: [], imagem: valores[i] }]; });
    const sc = aplicarGuardas(s, { sessaoId: "s1", candidatoId: "c", problemaId: "p", rubrica: RUBRICA.map(({ id }) => ({ id })), fontes: fontes().f, origem: "llm" });
    assert.deepEqual(sc.criterios.map(c => !!c.evidencias[0].imagem), [true, true, true, true, false, false]);
  });

  it("liga horário arredondado ao snapshot mais próximo e rejeita horário distante sem referência", () => {
    const estado = estadoInicial();
    const fontes = extrairFontes(estado, [ev("2026-11-07T15:00:00.120Z", "desenho", { grafo: GRAFO }), ev("2026-11-07T15:00:01.120Z", "desenho", { grafo: GRAFO })], []);
    const s = saida();
    s.criterios[0].evidencias = [{ tipo: "desenho", horario: "2026-11-07T15:00:01.000Z", texto: null, elementos: [], imagem: null }];
    s.criterios[1].evidencias = [{ tipo: "desenho", horario: T2, texto: null, elementos: [], imagem: null }];
    const sc = aplicarGuardas(s, { sessaoId: "s", candidatoId: "c", problemaId: "p", rubrica: RUBRICA, fontes, origem: "llm" });
    assert.equal(sc.criterios[0].evidencias[0].horario, "2026-11-07T15:00:01.120Z");
    assert.equal(sc.criterios[1].nota, null);
  });

  it("não mistura ids apagados de versões diferentes do quadro", () => {
    const f = extrairFontes(estadoInicial(), [ev(T1, "desenho", { grafo: "COMPONENTES\n- [r1] Primeira versão" }), ev(T2, "desenho", { grafo: "COMPONENTES\n- [r2] Segunda versão" })], []);
    const s = saida();
    s.criterios[0].evidencias = [{ tipo: "desenho", horario: "inválido", texto: null, elementos: ["r1", "r2"], imagem: null }];
    const sc = aplicarGuardas(s, { sessaoId: "s", candidatoId: "c", problemaId: "p", rubrica: RUBRICA, fontes: f, origem: "llm" });
    assert.equal(sc.criterios[0].nota, null);
  });

  it("observação só ancora texto do mesmo critério e snapshot, nunca observação do navegador", () => {
    const estado = estadoInicial();
    estado.observacoes = [{ criterio: RUBRICA[0].id, sinal: "positivo", espontaneo: false,
      evidencia: "priorizou o fluxo", em: Date.parse(T2), fase: "APROFUNDAMENTO", desenho: { horario: T1, grafo: GRAFO } }];
    const f = extrairFontes(estado, [ev(T1, "desenho", { grafo: GRAFO }), ev(T1, "analise", { observacoes: [{ criterio: RUBRICA[1].id, evidencia: "inventado" }] })], []);
    const s = saida();
    s.criterios.forEach(c => { c.evidencias = [{ tipo: "desenho", horario: T1, texto: "priorizou o fluxo", elementos: ["r1"], imagem: null }]; });
    const sc = aplicarGuardas(s, { sessaoId: "s", candidatoId: "c", problemaId: "p", rubrica: RUBRICA, fontes: f, origem: "llm" });
    assert.equal(sc.criterios[0].nota, 3);
    assert.equal(sc.criterios[0].evidencias[0].texto, "priorizou o fluxo");
    assert.ok(sc.criterios.slice(1).every(c => c.nota === null));
  });

  it("não promove observação provocada ao nível que exige espontaneidade", () => {
    const rubrica = [{ ...RUBRICA[0], niveis: { ...RUBRICA[0].niveis, 4: "Compara alternativas espontaneamente" } }];
    const estado = estadoInicial();
    estado.observacoes = [{ criterio: rubrica[0].id, sinal: "positivo", espontaneo: false,
      evidencia: "comparou alternativas", em: Date.parse(T2), fase: "APROFUNDAMENTO", desenho: { horario: T1, grafo: GRAFO } }];
    const s = saida(); s.criterios[0].nota = 4;
    s.criterios[0].evidencias = [{ tipo: "desenho", horario: T1, texto: "comparou alternativas", elementos: ["r1"], imagem: null }];
    const sc = aplicarGuardas(s, { sessaoId: "s", candidatoId: "c", problemaId: "p", rubrica, fontes: extrairFontes(estado, [ev(T1, "desenho", { grafo: GRAFO })], []), origem: "llm" });
    assert.equal(sc.criterios[0].nota, 3);
    assert.match(sc.ajustes.join(" "), /espontaneidade/);
  });

  it("nota 14 e frações não viram notas válidas silenciosamente", () => {
    const s = saida(); s.criterios[0].nota = 14; s.criterios[1].nota = 2.7;
    const sc = guardas(s);
    assert.equal(sc.criterios[0].nota, null); assert.equal(sc.criterios[1].nota, null);
    assert.equal(sc.recomendacao, "avancar_com_ressalvas");
    assert.deepEqual(sc.pontos_fortes, ["a"], "o ponto forte que não cita critério sem prova fica");
    const citando = guardas({ ...s, pontos_fortes: ["Foi bem em Requisitos e escopo.", "Explicou o cache."] });
    assert.deepEqual(citando.pontos_fortes, ["Explicou o cache."], "o que se apoiava em prova removida sai");
  });

  it("sem desenho nem fala: nenhuma nota, mesmo com observação sem vínculo", () => {
    const estado = estadoInicial();
    estado.observacoes = [{ criterio: RUBRICA[0].id, sinal: "positivo", espontaneo: true, evidencia: "sem prova", em: Date.parse(T1), fase: "REQUISITOS" }];
    const sc = gerarScorecardFalso({ kit: KIT_SYSTEM_DESIGN, problema: KIT_SYSTEM_DESIGN.problemas[0] }, { sessaoId: "s", candidatoId: "c", estado, eventos: [ev(T1, "desenho", { grafo: "COMPONENTES\nCONEXÕES" })], imagens: [] });
    assert.equal(sc.nota_geral, null); assert.equal(sc.recomendacao, "evidencia_insuficiente");
    assert.deepEqual(sc.pontos_fortes, []);
  });

  it("prompt preserva começo e fim em sessões longas, com o livro separado e false explícito", () => {
    const eventos = Array.from({ length: 200 }, (_, i) => ev(new Date(Date.parse(T1) + i * 1000).toISOString(), "fala", { quem: "candidato", texto: `${i === 0 ? "INICIO" : i === 199 ? "FIM_IMPORTANTE" : "meio"} ${"x".repeat(500)}` }));
    const estado = estadoInicial();
    const prompt = montarEntradaDoPrompt({ sessaoId: "s", candidatoId: "c", estado, eventos, imagens: [] }, extrairFontes(estado, eventos, []));
    assert.ok(prompt.linhaDoTempo.includes("INICIO")); assert.ok(prompt.linhaDoTempo.includes("FIM_IMPORTANTE"));
    assert.ok(prompt.linhaDoTempo.length <= 40_000);
  });

  it("timeout configurável valida o intervalo seguro e não aceita NaN ou negativos", () => {
    const anterior = process.env.AGENTE_TIMEOUT_SCORECARD_MS;
    try {
      // Padrão e teto de 280 s: o relatório cabe na função de 300 s com folga para gravar.
      for (const valor of ["", "-1", "NaN", "280001", "1.5"]) {
        process.env.AGENTE_TIMEOUT_SCORECARD_MS = valor; assert.equal(timeoutScorecardMs(), 280_000);
      }
      process.env.AGENTE_TIMEOUT_SCORECARD_MS = "30000"; assert.equal(timeoutScorecardMs(), 30_000);
      process.env.AGENTE_TIMEOUT_SCORECARD_MS = "280000"; assert.equal(timeoutScorecardMs(), 280_000);
    } finally {
      if (anterior === undefined) delete process.env.AGENTE_TIMEOUT_SCORECARD_MS; else process.env.AGENTE_TIMEOUT_SCORECARD_MS = anterior;
    }
  });

  it("troca ids por nomes em resumos, briefing, justificativas e ajustes sem mudar a citação", () => {
    const s = saida();
    const f = fontes().f;
    const literal = "Escolhi e1 para guardar os dados_consistencia";
    f.falas.push({ horario: T2, texto: literal });
    s.criterios[0].justificativa = "requisitos: discutiu dados_consistencia e e1.";
    s.criterios[0].evidencias = [{ tipo: "fala", horario: T2, texto: literal, elementos: [], imagem: null }];
    s.pontos_fortes = ["COMPONENTES_FLUXO e E1"];
    s.pontos_a_aprofundar = ["dados_consistencia; não alterar componentes_fluxo_extra nem e10"];
    s.briefing_para_proxima_etapa = "Retomar tradeoffs e e1.";
    const sc = aplicarGuardas(s, { sessaoId: "s1", candidatoId: "c", problemaId: "p", rubrica: RUBRICA, fontes: f, origem: "llm" });
    assert.equal(sc.pontos_fortes[0], "Componentes e fluxo e Postgres");
    assert.equal(sc.pontos_a_aprofundar[0], "Dados e consistência; não alterar componentes_fluxo_extra nem e10");
    assert.equal(sc.briefing_para_proxima_etapa, "Retomar Trade-offs e Postgres.");
    assert.equal(sc.criterios[0].justificativa, "Requisitos e escopo: discutiu Dados e consistência e Postgres.");
    assert.equal(sc.criterios[0].criterio, "requisitos");
    assert.equal(sc.criterios[0].evidencias[0].texto, literal);
    assert.ok(sc.ajustes.some(a => a.includes("Referências técnicas")));
  });

  it("resumo da solução e da entrevista passam pelo texto legível; o resumo da entrevista sai se as guardas corrigiram as notas", () => {
    const f = fontes().f;
    const s = saida({ resumo_da_solucao: "Um cache com e1 na frente do Postgres.", resumo_da_entrevista: "Boa base em dados_consistencia." });
    const sc = aplicarGuardas(s, { sessaoId: "s1", candidatoId: "c", problemaId: "p", rubrica: RUBRICA, fontes: f, origem: "llm" });
    assert.equal(sc.resumo_da_solucao, "Um cache com Postgres na frente do Postgres.");
    assert.equal(sc.resumo_da_entrevista, "Boa base em Dados e consistência.");
    // Nota de critério sem prova: as guardas mexem nos critérios, então o resumo escrito antes não vale.
    const corrigido = aplicarGuardas({ ...s, criterios: s.criterios.map((c, i) => i === 0 ? { ...c, evidencias: [] } : c) },
      { sessaoId: "s1", candidatoId: "c", problemaId: "p", rubrica: RUBRICA, fontes: f, origem: "llm" });
    assert.equal(corrigido.resumo_da_entrevista, "Boa base em Dados e consistência.", "resumo que não cita a nota removida fica");
    const citando = aplicarGuardas({ ...s, resumo_da_entrevista: "Foi bem em dados_consistencia e em requisitos.", criterios: s.criterios.map((c, i) => i === 0 ? { ...c, evidencias: [] } : c) },
      { sessaoId: "s1", candidatoId: "c", problemaId: "p", rubrica: RUBRICA, fontes: f, origem: "llm" });
    assert.equal(citando.resumo_da_entrevista, "Houve prova em 5 de 6 critérios: Componentes e fluxo (3 de 4), Escalabilidade (3 de 4), Dados e consistência (3 de 4), Trade-offs (3 de 4), Comunicação (3 de 4). 1 de 6 critérios ficou sem prova.");
    assert.equal(corrigido.resumo_da_solucao, "Um cache com Postgres na frente do Postgres.");
  });

  it("falso usa nomes da rubrica nos pontos a aprofundar", () => {
    const estado = estadoInicial();
    const sc = gerarScorecardFalso({ kit: KIT_SYSTEM_DESIGN, problema: KIT_SYSTEM_DESIGN.problemas[0] },
      { sessaoId: "s", candidatoId: "c", estado, eventos: [], imagens: [] });
    const itens = sc.pontos_a_aprofundar.join(" | ");
    assert.ok(itens.includes("Componentes e fluxo: sem prova"));
    assert.ok(itens.includes("Dados e consistência: sem prova"));
    assert.ok(itens.includes("Requisitos e escopo: o Totti não provocou este ponto"), "não expande duas vezes um nome já legível; escopo sem provocação não é falta do candidato");
    assert.ok(sc.pontos_a_aprofundar.every(t => !t.startsWith("Aprofundar")), "nunca 'Aprofundar X.'");
    assert.ok(!sc.pontos_a_aprofundar.join(" ").includes("componentes_fluxo"));
  });

  it("reanálise e upload da mesma versão preservam horário real e foto daquela versão no relatório", () => {
    const data = (segundos: number) => new Date(Date.parse(T1) + segundos * 1000).toISOString();
    const estado = estadoInicial();
    estado.observacoes = [{ criterio: RUBRICA[0].id, sinal: "positivo", espontaneo: true, evidencia: "priorizou o fluxo",
      em: Date.parse(T2), fase: "APROFUNDAMENTO", desenho: { horario: data(45), grafo: GRAFO } }];
    const eventos = [ev(data(-10), "fase", { fase: "ALTO_NIVEL" }), ev(T1, "desenho", { grafo: GRAFO }),
      ev(data(20), "desenho", { grafo: GRAFO, imagem_url: "/api/sessoes/s/imagens/1" }),
      ev(data(50), "desenho", { grafo: GRAFO + "\n- [r2] Outra versão" })];
    const imagens = [{ numero: 1, horario: T1 }, { numero: 2, horario: data(50) }];
    const sc = gerarScorecardFalso({ kit: KIT_SYSTEM_DESIGN, problema: KIT_SYSTEM_DESIGN.problemas[0] },
      { sessaoId: "s", candidatoId: "c", estado, eventos, imagens });
    assert.equal(sc.criterios[0].evidencias[0].horario, T1);
    assert.equal(estado.observacoes[0].desenho?.horario, data(45), "não altera a auditoria da análise no estado");
    const relatorio = montarRelatorio({ sessao: { id: "s", candidatoId: "c", avaliacaoId: "demo", criadaEm: Date.parse(data(-10)), estado, analises: 1 },
      scorecard: sc, kit: KIT_SYSTEM_DESIGN, problema: KIT_SYSTEM_DESIGN.problemas[0], eventos, imagens });
    const prova = relatorio.criterios[0].provas[0];
    assert.equal(prova.tipo, "desenho");
    assert.equal(prova.momento, "00:10");
    assert.equal(prova.tipo === "desenho" && prova.imagem, "/api/sessoes/s/imagens/1");
  });

  it("não ancora observação em versão antiga que já foi substituída, nem em evento futuro", () => {
    const estado = estadoInicial();
    estado.observacoes = [{ criterio: RUBRICA[0].id, sinal: "positivo", espontaneo: true, evidencia: "observação",
      em: Date.parse(T2), fase: "APROFUNDAMENTO", desenho: { horario: T2, grafo: GRAFO } }];
    const antes = new Date(Date.parse(T2) - 1000).toISOString();
    const depois = new Date(Date.parse(T2) + 1000).toISOString();
    assert.equal(extrairFontes(estado, [ev(T1, "desenho", { grafo: GRAFO }), ev(antes, "desenho", { grafo: "COMPONENTES" })], []).observacoes[0].desenho, undefined);
    assert.equal(extrairFontes(estado, [ev(depois, "desenho", { grafo: GRAFO })], []).observacoes[0].desenho, undefined);
    assert.equal(extrairFontes(estado, [], []).observacoes[0].desenho, undefined);
  });

  it("reversão ao mesmo grafo usa a última versão e lotes recebidos tarde ainda têm o horário original", () => {
    const estado = estadoInicial();
    const retorno = new Date(Date.parse(T2) - 500).toISOString();
    estado.observacoes = [{ criterio: RUBRICA[0].id, sinal: "positivo", espontaneo: true, evidencia: "observação",
      em: Date.parse(T2), fase: "APROFUNDAMENTO", desenho: { horario: T2, grafo: GRAFO } }];
    const eventos = [ev(T1, "desenho", { grafo: GRAFO }), ev(new Date(Date.parse(T1) + 1000).toISOString(), "desenho", { grafo: "COMPONENTES" }),
      { ...ev(retorno, "desenho", { grafo: GRAFO }), recebidoEm: Date.parse(T2) + 60_000 }];
    assert.equal(extrairFontes(estado, eventos, []).observacoes[0].desenho?.horario, retorno);
  });
});
