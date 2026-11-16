import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KIT_SYSTEM_DESIGN as kitDemo } from "../kits/system-design";
import { DESPEDIDAS } from "../../totti/fechamento";
import { criarClienteFalso, ErroLlm, type LlmArgs } from "../llm/cliente";
import { perguntar } from "../perguntar";
import { estadoInicial, type EstadoSessao } from "../sessao/estado";
import { conclusaoBarradaRecente } from "../sessao/politica";
import type { PlanoDaSessao } from "../plano";

const AGORA = 1_000_000;
const problema = kitDemo.problemas[0];
const estado = { ...estadoInicial(), fase: "REQUISITOS" as const, faseIniciadaEm: AGORA };
// A maior parte destes testes é das regras do v1; o v2 tem os seus no bloco "Totti 2 no quadro".
const deps = (llm: ReturnType<typeof criarClienteFalso>) => ({ llm, kit: kitDemo, problema, log: () => {}, versao: "v1" as const });
/** A mudança de cenário que já saiu na entrevista (ver `podeOferecerEncerrar`, decisão F). */
const MUDANCA_ANUNCIADA: NonNullable<EstadoSessao["empecilho"]> = {
  id: "teste_mudanca", fala: "Uma mudança no problema: o volume cresceu dez vezes.", requisito: "Mudança: volume 10x", exige: "Rever gargalos.",
  anunciadoEm: AGORA - 5 * 60_000, fase: "ALTO_NIVEL", forcado: false,
};

describe("conclusão com comentário no mesmo turno", () => {
  const grafo = "COMPONENTES\n- [r1] Cache (retângulo)\n- [r2] Banco (cilindro)\nCONEXÕES\n- [s1] Cache → Banco";
  const entrada = { fase: "ALTO_NIVEL" as const, texto: "Terminei o desenho, dá uma olhada.", grafo };
  const estadoAlto = { ...estadoInicial(), fase: "ALTO_NIVEL" as const, faseIniciadaEm: AGORA };
  const resultado = (texto: string) => ({ responder: true, texto, requisito: null, concluiu: true });

  it("resposta normal já comenta uma peça e pergunta, registrando a pergunta depois da conclusão", async () => {
    const llm = criarClienteFalso([resultado("O Cache fica antes do Banco. Por que você escolheu essa ordem?")]);
    const r = await perguntar({ ...deps(llm), versao: "v2" }, estadoAlto, entrada, AGORA);
    assert.match(r.texto, /Cache/);
    assert.ok(r.texto.trim().endsWith("?"));
    assert.deepEqual(r.estado.conversa.slice(-2).map((f) => f.quem), ["candidato", "agente"]);
    assert.equal(r.estado.conversa.at(-1)?.texto, r.texto);
  });

  it("regenera uma promessa vazia uma vez e reserva comentário e pergunta se ela se repete", async () => {
    const llm = criarClienteFalso([resultado("Tá, vou olhar."), resultado("Certo, deixa eu analisar.")]);
    const r = await perguntar({ ...deps(llm), versao: "v2" }, estadoAlto, entrada, AGORA);
    assert.equal(llm.chamadas.length, 2);
    assert.match(r.texto, /Cache/);
    assert.ok(r.texto.trim().endsWith("?"));
  });

  it("substitui pergunta genérica que só cita a peça por observação concreta e uma pergunta", async () => {
    const llm = criarClienteFalso([resultado("Como você pensou no Cache?")]);
    const r = await perguntar({ ...deps(llm), versao: "v2" }, estadoAlto, entrada, AGORA);
    assert.match(r.texto, /^Tá, olhei: Cache liga em Banco\./);
    assert.equal((r.texto.match(/\?/g) ?? []).length, 1);
  });

  it("falha do modelo usa a reserva ligada ao desenho", async () => {
    const llm = criarClienteFalso([new ErroLlm("rede", "indisponível")]);
    const r = await perguntar({ ...deps(llm), versao: "v2" }, estadoAlto, entrada, AGORA);
    assert.equal(r.falhou, undefined);
    assert.match(r.texto, /Cache/);
    assert.match(r.texto, /Cache liga em Banco/);
    assert.ok(r.texto.trim().endsWith("?"));
  });

  it("conclusão sem peças usa a reserva completa com pergunta", async () => {
    const llm = criarClienteFalso([new ErroLlm("rede", "indisponível")]);
    const r = await perguntar({ ...deps(llm), versao: "v2" }, estadoAlto, { ...entrada, grafo: "" }, AGORA);
    assert.equal(r.responder, true);
    assert.equal(r.texto, "Ainda não vejo peças no desenho. Por onde você pensa em começar?");
    assert.equal((r.texto.match(/\?/g) ?? []).length, 1);
  });
});

describe("perguntar", () => {
  it("segunda reação vazia seguida (\"Hm.\" depois de \"Hm.\") vira silêncio; a primeira passa", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Hm.", requisito: null, concluiu: false }]);
    const comHm = { ...estado, conversa: [{ quem: "agente" as const, texto: "Hm.", em: AGORA }] };
    const v2 = { ...deps(llm), versao: "v2" as const };
    const segunda = await perguntar(v2, comHm, { fase: "REQUISITOS", texto: "E a fila fica separada." }, AGORA);
    assert.equal(segunda.responder, false);
    const primeira = await perguntar(v2, estado, { fase: "REQUISITOS", texto: "E a fila fica separada." }, AGORA);
    assert.equal(primeira.responder, true);
    assert.equal(primeira.texto, "Hm.");
  });
  it("tira a abertura com eco da fala do candidato", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Entendi que você vai usar um contador. E onde ele fica?", requisito: null, concluiu: false }]);
    const r = await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "Vou usar um contador em base 62." }, AGORA);
    assert.equal(r.texto, "E onde ele fica?");
  });
  it("registra no log quem respondeu o turno (modelo, provedor, tempo e custo)", async () => {
    const falso = criarClienteFalso([{ responder: true, texto: "Certo.", requisito: null, concluiu: false }]);
    const llm = {
      ...falso,
      async completarJson<T>(args: Parameters<typeof falso.completarJson<T>>[0]) {
        const r = await falso.completarJson(args);
        return { ...r, ms: 3200, modelo: "zai-org/GLM-5.3-Flash", provedor: "featherless", uso: { entrada: 9000, saida: 120, custo: 0.002 } };
      },
    };
    const eventos: [string, Record<string, unknown>][] = [];
    await perguntar({ llm, kit: kitDemo, problema, log: (e, m) => eventos.push([e, m]) }, estado, { fase: "REQUISITOS", texto: "Oi", sessao_id: "s1" }, AGORA);
    const turno = eventos.find(([e]) => e === "perguntar_llm")?.[1];
    assert.ok(turno, "faltou o evento perguntar_llm");
    assert.equal(turno.modelo, "zai-org/GLM-5.3-Flash");
    assert.equal(turno.provedor, "featherless");
    assert.equal(turno.ms, 3200);
    assert.equal(turno.custo_usd, 0.002);
  });
  it("devolve o uso do turno (tokens, custo e tamanho de cada bloco do prompt) para a rota gravar", async () => {
    const falso = criarClienteFalso([{ responder: true, texto: "Certo.", requisito: null, concluiu: false }]);
    const llm = {
      ...falso,
      async completarJson<T>(args: Parameters<typeof falso.completarJson<T>>[0]) {
        const r = await falso.completarJson(args);
        return { ...r, modelo: "google/gemini-3.5-flash-lite", provedor: "openrouter", uso: { entrada: 5000, saida: 80, cache: 3000, custo: 0.0011 } };
      },
    };
    const comConversa = { ...estado, fase: "ALTO_NIVEL" as const, conversa: [{ quem: "candidato" as const, texto: "Vou pôr um cache.", em: AGORA }] };
    const r = await perguntar({ llm, kit: kitDemo, problema, log: () => {}, versao: "v2" }, comConversa, {
      fase: "ALTO_NIVEL", texto: "E o banco atrás.", grafo: "- [r1] Cache", mudancas: "+ [r1] Cache", imagemBase64: "data:image/jpeg;base64,AAAA",
    }, AGORA);
    assert.ok(r.uso, "faltou o uso do turno");
    assert.equal(r.uso.tokens_entrada, 5000);
    assert.equal(r.uso.tokens_cache, 3000);
    assert.equal(r.uso.custo_usd, 0.0011);
    assert.equal(r.uso.foto, "data:image/jpeg;base64,AAAA".length);
    assert.equal(r.uso.falas_no_prompt, 1);
    assert.ok(r.uso.blocos.grafo > 0 && r.uso.blocos.mudancas > 0 && r.uso.blocos.conversa > 0 && r.uso.blocos.resto > 0);
    const dinamico = falso.chamadas[0].sistema.dinamico ?? "";
    assert.equal(r.uso.blocos.grafo + r.uso.blocos.mudancas + r.uso.blocos.conversa + r.uso.blocos.resto, dinamico.length);
  });
  it("sem resposta do modelo, não há uso a gravar", async () => {
    const llm = criarClienteFalso([new ErroLlm("http", "caiu")]);
    const r = await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "Oi" }, AGORA);
    assert.equal(r.falhou, true);
    assert.equal(r.uso, undefined);
  });
  it("resposta e feedback recebem o desenho e a pergunta ativa no loop rápido", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Você separou as leituras da escrita.", requisito: null, concluiu: false }]);
    const r = await perguntar(deps(llm), { ...estado, fase: "ALTO_NIVEL" }, {
      fase: "ALTO_NIVEL", texto: "Pode comentar meu desenho?", grafo: "- [e1] API de leitura", perguntaAtiva: "Como você separou os fluxos?",
    }, AGORA);
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /API de leitura/);
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /Como você separou os fluxos/);
    assert.equal(r.concluiu, false);
    assert.equal(r.requisito, null);
  });
  it("falas curtas vão ao modelo (sem lista de palavras) e a fala é registrada", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null }]);
    const r = await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "hmm, deixa eu ver" }, AGORA);
    assert.equal(llm.chamadas.length, 1);
    assert.equal(r.responder, false);
    assert.equal(r.estado.conversa.at(-1)?.texto, "hmm, deixa eu ver");
  });

  it("LLM pode devolver responder false", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null }]);
    const r = await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "então, vou pensar nisso" }, AGORA);
    assert.equal(r.responder, false);
  });

  it("responde pela ficha, devolve requisito e registra as duas falas", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Uns 4 mil acessos por segundo, com picos de 40 mil.", requisito: "Leitura: ~4 mil/s (picos de 40 mil)" }]);
    const r = await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "Quantos acessos por segundo?" }, AGORA);
    assert.equal(r.responder, true);
    assert.equal(r.requisito, "Leitura: ~4 mil/s (picos de 40 mil)");
    assert.deepEqual(r.estado.conversa.map((f) => f.quem), ["candidato", "agente"]);
    // A ficha está no prompt estático (servidor), a fala do candidato vai como mensagem.
    const a = llm.chamadas[0];
    assert.ok(a.sistema.estatico.includes("4 mil por segundo"));
    assert.equal(a.mensagens[0].content, "Quantos acessos por segundo?");
    assert.equal(a.nomeSchema, "resposta_entrevistador");
  });

  it("limita a 3 frases (sem cortar decimais) e não repete requisito já no quadro", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Um. São 2.5 mil por segundo. Três. Quatro.", requisito: "Retenção: 5 anos" }]);
    const r = await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "Por quanto tempo guardo?", requisitosAtuais: ["Retenção: 5 anos"] }, AGORA);
    // As 3 frases do modelo ficam inteiras; como nenhuma devolve a vez, entra um convite curto no fim.
    assert.equal(r.texto, "Um. São 2.5 mil por segundo. Três. Continua daí.");
    assert.equal(r.requisito, null);
  });

  it("erro do LLM: responder false, sem lançar", async () => {
    const llm = criarClienteFalso([new ErroLlm("timeout", "x")]);
    const r = await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "Quantos acessos?" }, AGORA);
    assert.equal(r.responder, false);
    assert.equal(r.estado.conversa.length, 1);
  });
});

describe("conclusão (interpretada pelo modelo)", () => {
  it("repassa concluiu quando o modelo interpreta que o candidato terminou", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Certo, vou olhar o que você montou.", requisito: null, concluiu: true }]);
    const r = await perguntar(deps(llm), { ...estado, fase: "ALTO_NIVEL" }, { fase: "ALTO_NIVEL", texto: "acho que já deu, podemos seguir?" }, AGORA);
    assert.equal(r.concluiu, true);
    assert.equal(r.responder, true);
  });

  it("concluiu vale mesmo sem texto de resposta (o sinal é do modelo, o código não inventa fala)", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null, concluiu: true }]);
    const r = await perguntar(deps(llm), { ...estado, fase: "ALTO_NIVEL" }, { fase: "ALTO_NIVEL", texto: "é isso" }, AGORA);
    assert.equal(r.concluiu, true);
    assert.equal(r.responder, false);
    assert.equal(r.texto, "");
  });

  it("o código não decide por palavras: 'pronto' sem interpretação do modelo não conclui", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null, concluiu: false }]);
    const r = await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "pronto, pode perguntar mais" }, AGORA);
    assert.equal(r.concluiu, false);
  });

  it("pergunta comum não marca concluiu", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Uns 4 mil por segundo.", requisito: null }]);
    const r = await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "qual a escala?" }, AGORA);
    assert.equal(r.concluiu, false);
});

describe("perguntar: prompt contra quebra de personagem (sem limpeza por código)", () => {
  it("o prompt estático não instrui a citar a ficha e proíbe pergunta", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Ok, 5 anos.", requisito: null }]);
    await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "Por quanto tempo guardo?" }, AGORA);
    const p = llm.chamadas[0].sistema.estatico;
    // "ficha" só pode aparecer dentro da proibição entre aspas.
    const semProibicao = p.replace(/"ficha"/g, "");
    assert.ok(!/ficha/i.test(semProibicao), "o prompt ainda usa o termo 'ficha' fora da proibição");
    assert.match(p, /NUNCA cite "ficha"/);
    assert.match(p, /NUNCA faça pergunta/);
    assert.match(p, /SEMPRE preencha/);
  });

  it("o prompt orienta recusa curta e variada, convite sem '?', assumir só se faltar dado e resposta só do perguntado", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Ok, 5 anos.", requisito: null }]);
    await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "Por quanto tempo guardo?" }, AGORA);
    const p = llm.chamadas[0].sistema.estatico;
    assert.match(p, /UMA frase curta e natural/);
    assert.match(p, /VARIE a redação/);
    assert.match(p, /convite sem interrogação/);
    assert.match(p, /SOMENTE quando a pergunta do candidato é sobre um dado que não existe/);
    assert.match(p, /Nunca use essa orientação em recusas/);
    assert.match(p, /Responda SOMENTE o que foi perguntado/);
    assert.ok(!/o time espera/i.test(p), "o prompt não deve sugerir 'o time espera'");
    // Sem texto fixo de recusa para copiar.
    assert.ok(!/Não posso compartilhar/i.test(p));
  });
  });
});

describe("desfecho da pergunta ativa", () => {
  const ativa = { ...estado, fase: "APROFUNDAMENTO" as const };
  it("não sei: repassa o desfecho e a fala não termina em pergunta", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Sem problema, seguimos. Quer olhar outra parte?", requisito: null, concluiu: false, desfecho: "nao_sabe" }]);
    const r = await perguntar(deps(llm), ativa, { fase: "APROFUNDAMENTO", texto: "Não sei, nunca vi isso.", perguntaAtiva: "Como evita colisão?" }, AGORA);
    assert.equal(r.desfecho, "nao_sabe");
    assert.doesNotMatch(r.texto, /\?/);
  });
  it("respondeu vago: o aprofundamento do fim continua valendo", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Saquei. Melhor em que sentido?", requisito: null, concluiu: false, desfecho: "respondeu", aprofundar: true }]);
    const r = await perguntar(deps(llm), ativa, { fase: "APROFUNDAMENTO", texto: "Uso um contador, fica melhor.", perguntaAtiva: "Como gera o código?" }, AGORA);
    assert.equal(r.desfecho, "respondeu");
    assert.equal(r.texto, "Saquei. Melhor em que sentido?");
  });
  it("respondeu justificado: outra pergunta no fim vira convite", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Saquei. E se o contador cair?", requisito: null, concluiu: false, desfecho: "respondeu", aprofundar: false }]);
    const r = await perguntar(deps(llm), ativa, { fase: "APROFUNDAMENTO", texto: "Uso um contador porque nunca repete.", perguntaAtiva: "Como gera o código?" }, AGORA);
    assert.match(r.texto, /^Saquei\. /);
    assert.doesNotMatch(r.texto, /\?/);
  });
  it("sem pergunta ativa não há desfecho", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Tranquilo, continua daí.", requisito: null, concluiu: false, desfecho: "pulou" }]);
    const r = await perguntar(deps(llm), ativa, { fase: "APROFUNDAMENTO", texto: "Vou pular essa parte." }, AGORA);
    assert.equal(r.desfecho, null);
  });
});

describe("foto e mudanças do quadro no /perguntar", () => {
  it("a foto vai ao modelo e o que mudou entra no contexto", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null }]);
    await perguntar(deps(llm), { ...estado, fase: "ALTO_NIVEL" }, {
      fase: "ALTO_NIVEL", texto: "Olha o que eu fiz aqui", imagemBase64: "data:image/jpeg;base64,/9j/", mudancas: "+ adicionou [r2] Cache",
    }, AGORA);
    assert.equal(llm.chamadas[0].imagem, "data:image/jpeg;base64,/9j/");
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /acabou de mudar no desenho.*adicionou \[r2\] Cache/);
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /FOTO DO QUADRO/);
  });
});

describe("Totti 2 no quadro (versao v2)", () => {
  const ativa = { ...estado, fase: "APROFUNDAMENTO" as const };
  const depsV2 = (llm: ReturnType<typeof criarClienteFalso>) => ({ ...deps(llm), versao: "v2" as const });
  it("usa o prompt de objetivos, o schema próprio (papel conversa_quadro) e mostra o que ainda não deu sinal", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "São 100 milhões por mês.", requisito: null }]);
    const comCriterios = { ...estadoInicial({ criterios: kitDemo.criterios.map((c) => c.id) }), fase: "REQUISITOS" as const, faseIniciadaEm: AGORA };
    await perguntar(depsV2(llm), comCriterios, { fase: "REQUISITOS", texto: "Quantas URLs por mês?" }, AGORA);
    const c = llm.chamadas[0];
    assert.equal(c.nomeSchema, "resposta_entrevistador_v2");
    assert.match(c.sistema.estatico, /PARA QUE SERVE ESTA ENTREVISTA/);
    assert.match(c.sistema.dinamico ?? "", new RegExp(`Ainda sem nenhum sinal.*${kitDemo.criterios[0].nome}`));
  });
  it("não sei: tira a pergunta do fim e, se a fala não diz o próximo passo, põe um convite", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Tranquilo, seguimos. Quer olhar outra parte?", requisito: null, desfecho: "nao_sabe" }]);
    const r = await perguntar(depsV2(llm), ativa, { fase: "APROFUNDAMENTO", texto: "Não sei.", perguntaAtiva: "Como evita colisão?" }, AGORA);
    assert.match(r.texto, /^Tranquilo, seguimos\. (Pode|Continua|Fica|Segue)/);
    assert.doesNotMatch(r.texto, /\?/);
  });
  it("não sei com próximo passo concreto: fica como o modelo disse", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Tranquilo, deixa isso de lado. Pode seguir com a próxima parte do desenho.", requisito: null, desfecho: "nao_sabe" }]);
    const r = await perguntar(depsV2(llm), ativa, { fase: "APROFUNDAMENTO", texto: "Não sei.", perguntaAtiva: "Como evita colisão?" }, AGORA);
    assert.equal(r.texto, "Tranquilo, deixa isso de lado. Pode seguir com a próxima parte do desenho.");
  });
  it("réplica solta depois de responder à pergunta do Totti ganha a direção", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Tudo bem.", requisito: null, desfecho: "respondeu" }]);
    const r = await perguntar(depsV2(llm), ativa, { fase: "APROFUNDAMENTO", texto: "Uso um contador por servidor.", perguntaAtiva: "Como evita colisão?" }, AGORA);
    assert.match(r.texto, /^Tudo bem\. \S/);
  });
  it("sem versao explícita vale o v2; TOTTI_QUADRO=v1 volta ao v1", async () => {
    const { versao: _, ...semVersao } = deps(criarClienteFalso([]));
    const anterior = process.env.TOTTI_QUADRO;
    try {
      delete process.env.TOTTI_QUADRO;
      const a = criarClienteFalso([{ responder: false, texto: "", requisito: null }]);
      await perguntar({ ...semVersao, llm: a }, estado, { fase: "REQUISITOS", texto: "hmm" }, AGORA);
      assert.equal(a.chamadas[0].nomeSchema, "resposta_entrevistador_v2");
      process.env.TOTTI_QUADRO = "v1";
      const b = criarClienteFalso([{ responder: false, texto: "", requisito: null }]);
      await perguntar({ ...semVersao, llm: b }, estado, { fase: "REQUISITOS", texto: "hmm" }, AGORA);
      assert.equal(b.chamadas[0].nomeSchema, "resposta_entrevistador");
    } finally {
      if (anterior === undefined) delete process.env.TOTTI_QUADRO;
      else process.env.TOTTI_QUADRO = anterior;
    }
  });
});

describe("briefing da entrevista no /perguntar", () => {
  const comEvidencia = {
    ...estadoInicial({ criterios: kitDemo.criterios.map((c) => c.id) }),
    fase: "APROFUNDAMENTO" as const,
    faseIniciadaEm: AGORA,
    cobertura: { ...estadoInicial({ criterios: kitDemo.criterios.map((c) => c.id) }).cobertura, escalabilidade: { positivo: 1, negativo: 0, neutro: 0 } },
    observacoes: [{ criterio: "escalabilidade", sinal: "positivo" as const, espontaneo: true, evidencia: "cache de leitura para o pico", em: AGORA, fase: "APROFUNDAMENTO" as const }],
  };

  it("o briefing vai no bloco dinâmico, com as evidências e o que falta", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null }]);
    await perguntar(deps(llm), comEvidencia, { fase: "APROFUNDAMENTO", texto: "então, o cache fica na frente" }, AGORA);
    const dinamico = llm.chamadas[0].sistema.dinamico ?? "";
    assert.match(dinamico, /BRIEFING DA ENTREVISTA/);
    assert.match(dinamico, /cache de leitura para o pico/);
    assert.match(dinamico, /O que ainda falta/);
  });

  it("o bloco estático não muda com a evidência (continua igual para o mesmo kit)", async () => {
    const a = criarClienteFalso([{ responder: false, texto: "", requisito: null }]);
    const b = criarClienteFalso([{ responder: false, texto: "", requisito: null }]);
    await perguntar(deps(a), comEvidencia, { fase: "APROFUNDAMENTO", texto: "ok" }, AGORA);
    await perguntar(deps(b), { ...comEvidencia, observacoes: [], cobertura: estadoInicial({ criterios: kitDemo.criterios.map((c) => c.id) }).cobertura }, { fase: "APROFUNDAMENTO", texto: "ok" }, AGORA);
    assert.equal(a.chamadas[0].sistema.estatico, b.chamadas[0].sistema.estatico);
  });

  it("o prompt estático manda usar o briefing sem cobrar o que já tem evidência", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null }]);
    await perguntar(deps(llm), estado, { fase: "REQUISITOS", texto: "ok" }, AGORA);
    assert.match(llm.chamadas[0].sistema.estatico, /BRIEFING DA ENTREVISTA mostra o que você já tem/);
  });
});

describe("convite do fim no /perguntar", () => {
  it("não repete o convite que o Totti acabou de dizer", async () => {
    const respostaDoModelo = { responder: true, texto: "São 20 mil por dia.", requisito: null, concluiu: false };
    const primeira = await perguntar(deps(criarClienteFalso([respostaDoModelo])), estado, { fase: "REQUISITOS", texto: "Quantos usuários?" }, AGORA);
    const convite1 = primeira.texto.replace("São 20 mil por dia. ", "");
    // A segunda pergunta parte do estado em que o Totti já disse o primeiro convite.
    const segunda = await perguntar(deps(criarClienteFalso([respostaDoModelo])), primeira.estado, { fase: "REQUISITOS", texto: "E de escrita?" }, AGORA);
    const convite2 = segunda.texto.replace("São 20 mil por dia. ", "");
    assert.notEqual(convite2, convite1);
  });
});

describe("perguntar (v2): \"tô pensando\" é pedido de tempo, não resposta", () => {
  const v2 = (llm: ReturnType<typeof criarClienteFalso>) => ({ ...deps(llm), versao: "v2" as const });
  const emAltoNivel = { ...estado, fase: "ALTO_NIVEL" as const, faseIniciadaEm: AGORA - 60_000 };
  const pensando = { responder: false, texto: "", requisito: null, concluiu: false, desfecho: "pensando" };

  it("na primeira vez na entrevista, uma reação curta fixa, sem convite e sem pergunta", async () => {
    const llm = criarClienteFalso([{ ...pensando, responder: true, texto: "Certo, pode pensar. Pode seguir quando quiser." }]);
    const r = await perguntar(v2(llm), emAltoNivel, { fase: "ALTO_NIVEL", texto: "Calma, tô pensando." }, AGORA);
    assert.equal(r.responder, true);
    assert.equal(r.texto, "Claro, fica à vontade.");
    assert.equal(r.perguntou, undefined);
    assert.deepEqual(r.pediuTempo, { reagiu: true });
    assert.equal(r.estado.pediuTempoEm, AGORA);
    assert.equal(r.estado.reacaoAoPensarDita, true);
    assert.equal(r.estado.ultimaFalaDoAgenteEm, AGORA);
  });

  it("nas vezes seguintes, fica calado: sem convite, sem pergunta, mas o pedido fica registrado", async () => {
    const jaReagiu = { ...emAltoNivel, reacaoAoPensarDita: true };
    const llm = criarClienteFalso([{ ...pensando, responder: true, texto: "Pode continuar de onde parou." }]);
    const r = await perguntar(v2(llm), jaReagiu, { fase: "ALTO_NIVEL", texto: "Deixa eu pensar um pouco." }, AGORA);
    assert.equal(r.responder, false);
    assert.equal(r.texto, "");
    assert.deepEqual(r.pediuTempo, { reagiu: false });
    assert.equal(r.estado.pediuTempoEm, AGORA);
    assert.equal(r.estado.reacaoAoPensarDita, true);
  });

  it("com pergunta ativa, o pedido não vira desfecho da pergunta nem grava observação", async () => {
    const comPergunta = { ...emAltoNivel, perguntaAtiva: {
      numero: 1, status: "duvida" as const, pergunta: "Por que o cache fica na frente do banco?", nota: null, elementos: [],
      degrau: null, fase: "ALTO_NIVEL" as const, feitaEm: AGORA - 30_000,
    } };
    const llm = criarClienteFalso([{ ...pensando, desfecho: "pensando" }]);
    const r = await perguntar(v2(llm), comPergunta, { fase: "ALTO_NIVEL", texto: "Um minuto, deixa eu pensar.", perguntaAtiva: "Por que o cache fica na frente do banco?" }, AGORA);
    assert.equal(r.desfecho, null);
    assert.equal(r.estado.observacoes.length, 0);
    assert.equal(r.estado.perguntaAtiva?.desfecho, undefined);
  });

  it("o modelo pede tempo, mas a fala é só \"Tá.\": o pedido ainda é o que vale (não sai a reação do convite)", async () => {
    const llm = criarClienteFalso([{ ...pensando, responder: true, texto: "Tá. Pode seguir." }]);
    const r = await perguntar(v2(llm), { ...emAltoNivel, reacaoAoPensarDita: true }, { fase: "ALTO_NIVEL", texto: "Calma." }, AGORA);
    assert.equal(r.responder, false);
    assert.equal(r.pediuTempo?.reagiu, false);
  });

  it("depois de ele só reagir à última fala (que devolveu a vez), a reação sai sem convite de novo (ele não desenhou)", async () => {
    const depoisDoConvite = { ...emAltoNivel, ultimaFalaDoAgenteEm: AGORA - 10_000,
      conversa: [{ quem: "agente" as const, texto: "Como você separa a leitura da escrita?", em: AGORA - 10_000 }] };
    const llm = criarClienteFalso([{ responder: true, texto: "Certo.", requisito: null, concluiu: false, desfecho: null }]);
    const r = await perguntar(v2(llm), depoisDoConvite, { fase: "ALTO_NIVEL", texto: "Tá.", desenhoParadoHaS: 30 }, AGORA);
    assert.equal(r.texto, "Certo.");
  });

  it("se ele desenhou depois da fala que devolveu a vez, a reação volta a ter convite (a regra de sempre)", async () => {
    const depoisDoConvite = { ...emAltoNivel, ultimaFalaDoAgenteEm: AGORA - 10_000,
      conversa: [{ quem: "agente" as const, texto: "Como você separa a leitura da escrita?", em: AGORA - 10_000 }] };
    const llm = criarClienteFalso([{ responder: true, texto: "Certo.", requisito: null, concluiu: false, desfecho: null }]);
    const r = await perguntar(v2(llm), depoisDoConvite, { fase: "ALTO_NIVEL", texto: "Tá.", desenhoParadoHaS: 2 }, AGORA);
    assert.match(r.texto, /^Certo\. \S/);
  });
});

describe("por quê obrigatório no v2 (escolha curta a uma pergunta com alternativas)", () => {
  const ativa = { ...estado, fase: "APROFUNDAMENTO" as const };
  const depsV2 = (llm: ReturnType<typeof criarClienteFalso>) => ({ ...deps(llm), versao: "v2" as const });
  const perguntada = { fase: "APROFUNDAMENTO" as const, perguntaAtiva: "No back ou no front?" };
  it("(a) escolha curta e o modelo só reage: sai o porquê, sem convite, e a pergunta segue aberta", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Tá.", requisito: null, concluiu: false, desfecho: "respondeu" }]);
    const r = await perguntar(depsV2(llm), ativa, { ...perguntada, texto: "back" }, AGORA);
    assert.equal(r.texto, "Tá. Por quê?");
    assert.equal(r.perguntou, true);
    assert.equal(r.seguimento, true);
    assert.equal(r.desfecho, "respondeu");
  });
  it("(a) com o modelo calado, a pergunta de porquê sai sozinha", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null, concluiu: false }]);
    const r = await perguntar(depsV2(llm), ativa, { ...perguntada, texto: "back" }, AGORA);
    assert.equal(r.responder, true);
    assert.equal(r.texto, "Por quê?");
    assert.equal(r.seguimento, true);
  });
  it("(a) a pergunta de porquê que sai não repete a última que o Totti disse", async () => {
    const jaPerguntou = { ...ativa, conversa: [{ quem: "agente" as const, texto: "Tá. Por quê?", em: AGORA - 60_000 }] };
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null, concluiu: false }]);
    const r = await perguntar(depsV2(llm), jaPerguntou, { ...perguntada, texto: "SQL" }, AGORA);
    assert.equal(r.texto, "Por que essa opção?");
  });
  it("(b) o modelo pergunta o porquê de novo: a pergunta passa, mesmo que o ponto já tenha sido aprofundado", async () => {
    const jaAprofundado = { ...ativa, conversa: [
      { quem: "agente" as const, texto: "Por que no backend?", em: AGORA - 60_000 },
      { quem: "candidato" as const, texto: "Porque é mais simples.", em: AGORA - 50_000 },
    ] };
    const llm = criarClienteFalso([{ responder: true, texto: "Por que no backend?", requisito: null, concluiu: false, desfecho: "respondeu" }]);
    const r = await perguntar(depsV2(llm), jaAprofundado, { ...perguntada, texto: "back" }, AGORA);
    assert.equal(r.texto, "Por que no backend?");
    assert.equal(r.seguimento, true);
  });
  it("(c) resposta longa e justificada: nada é forçado", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Saquei. E o banco aguenta esse volume?", requisito: null, concluiu: false, desfecho: "respondeu" }]);
    const r = await perguntar(depsV2(llm), ativa, { ...perguntada, texto: "Fila, porque o pico é alto e eu não quero perder pedido." }, AGORA);
    assert.doesNotMatch(r.texto, /Por qu/);
    assert.equal(r.seguimento, undefined);
  });
  it("(a) o convite que o modelo pôs sai antes da pergunta de porquê: \"Tá, pode seguir.\" → \"Tá. Por quê?\"", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Tá, pode seguir.", requisito: null, concluiu: false, desfecho: "respondeu" }]);
    const r = await perguntar(depsV2(llm), ativa, { ...perguntada, texto: "back" }, AGORA);
    assert.equal(r.texto, "Tá. Por quê?");
  });
  it("(d) não sei: nada é forçado, o desfecho é 'não sabe' e a fala não termina em pergunta", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Tranquilo, deixa isso de lado.", requisito: null, concluiu: false, desfecho: "nao_sabe" }]);
    const r = await perguntar(depsV2(llm), ativa, { ...perguntada, texto: "não sei" }, AGORA);
    assert.equal(r.desfecho, "nao_sabe");
    assert.doesNotMatch(r.texto, /Por qu/);
    assert.doesNotMatch(r.texto, /\?/);
  });
  it("o prompt manda pedir o porquê da escolha curta mesmo depois de aprofundar", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null, concluiu: false }]);
    await perguntar(depsV2(llm), ativa, { ...perguntada, texto: "back" }, AGORA);
    assert.match(llm.chamadas[0].sistema.estatico, /pergunte o porquê da escolha DELE antes de seguir/);
  });
  it("registra a regra pede_porque no log do turno", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null, concluiu: false }]);
    const eventos: [string, Record<string, unknown>][] = [];
    await perguntar({ ...depsV2(llm), log: (e, m) => eventos.push([e, m]) }, ativa, { ...perguntada, texto: "back" }, AGORA);
    assert.ok(eventos.some(([e, m]) => e === "perguntar_turno" && (m.regras as string[]).includes("pede_porque")));
  });
});

describe("pergunta dele no fechamento do quadro: o modelo lê a pergunta (candidatoPerguntou), sem regex", () => {
  // Três peças ligadas: "terminei" com isto no quadro fecha na primeira vez.
  const GRAFO = "COMPONENTES\n- [r1] Cliente (retângulo)\n- [r2] API (retângulo)\n- [r3] Banco (retângulo)\nCONEXÕES\n- [s1] Cliente → API\n- [s2] API → Banco";
  const VOLTA = "Mais alguma coisa antes de encerrar?";
  // A mudança de cenário já saiu: sem ela, "terminei" é barrado (decisão F, #129) e estes testes são do fechamento.
  const emALTO = { ...estadoInicial(), fase: "ALTO_NIVEL" as const, faseIniciadaEm: AGORA - 5 * 60_000, iniciadaEm: AGORA - 12 * 60_000, empecilho: MUDANCA_ANUNCIADA };
  const comV2 = (llm: ReturnType<typeof criarClienteFalso>) => ({ llm, kit: kitDemo, problema, log: () => {}, versao: "v2" as const });
  /** O modelo do teste, pela fala: conclui, pede para encerrar com pergunta, pergunta, ou fica quieto ao "só isso". */
  const modelo = (args: LlmArgs<unknown>) => {
    const fala = args.mensagens.at(-1)?.content ?? "";
    if (fala.includes("terminei")) return { responder: false, texto: "", requisito: null, concluiu: true };
    if (fala.includes("encerrar, mas")) return { responder: true, texto: "É o entregador.", requisito: null, concluiu: false, encerrar: true, candidatoPerguntou: true };
    if (fala.includes("courier")) return { responder: true, texto: "É o entregador.", requisito: null, concluiu: false, candidatoPerguntou: true };
    if (fala.includes("só isso")) return { responder: false, texto: "", requisito: null, concluiu: false };
    return { responder: true, texto: "Certo.", requisito: null, concluiu: false };
  };

  it("o caso real: anunciado o fechamento, ele pergunta o que é courier sem '?': responde e pergunta se quer mais, sem encerrar; depois 'não, só isso' despede", async () => {
    const llm = criarClienteFalso(modelo);
    const d = comV2(llm);
    let r = await perguntar(d, emALTO, { fase: "ALTO_NIVEL", texto: "Pronto, terminei o desenho.", grafo: GRAFO }, AGORA);
    for (let i = 0; i < 6 && r.fechamento !== "ultima_palavra"; i++) {
      r = await perguntar(d, r.estado, { fase: "ALTO_NIVEL", texto: "Certo, entendi.", grafo: GRAFO }, AGORA);
    }
    assert.equal(r.fechamento, "ultima_palavra");
    r = await perguntar(d, r.estado, { fase: "ALTO_NIVEL", texto: "não entendi o que é courier", grafo: GRAFO }, AGORA);
    assert.equal(r.texto, `É o entregador. ${VOLTA}`);
    assert.equal(r.encerrar, undefined);
    assert.equal(r.fechamento, "ultima_palavra");
    r = await perguntar(d, r.estado, { fase: "ALTO_NIVEL", texto: "não, só isso", grafo: GRAFO }, AGORA);
    assert.ok(DESPEDIDAS.includes(r.texto), r.texto);
    assert.equal(r.encerrar, true);
    assert.equal(r.fechamento, "encerrada");
  });

  it("pede para encerrar e pergunta na mesma fala: a pergunta é respondida, e o quadro não se despede neste turno", async () => {
    const r = await perguntar(comV2(criarClienteFalso(modelo)), emALTO, { fase: "ALTO_NIVEL", texto: "pode encerrar, mas o que é courier?", grafo: GRAFO }, AGORA);
    assert.equal(r.texto, `É o entregador. ${VOLTA}`);
    assert.equal(r.encerrar, undefined);
    assert.equal(r.fechamento, "ultima_palavra");
  });

  it("sem critérios no plano, pedir para encerrar vai à última palavra (nada a perguntar); depois de 'não' despede", async () => {
    // Antes (#129, decisão F) ia direto à despedida; a decisão revisada faz as perguntas finais, e sem candidatas, a última palavra.
    const llm = criarClienteFalso(() => ({ responder: false, texto: "", requisito: null, concluiu: false, encerrar: true }));
    const r = await perguntar(comV2(llm), emALTO, { fase: "ALTO_NIVEL", texto: "pode encerrar", grafo: GRAFO }, AGORA);
    assert.equal(r.texto, "Por mim, era isso. Quer acrescentar alguma coisa antes de encerrar?");
    assert.equal(r.encerrar, undefined);
    assert.equal(r.fechamento, "ultima_palavra");
    const fim = await perguntar(comV2(criarClienteFalso(modelo)), r.estado, { fase: "ALTO_NIVEL", texto: "não", grafo: GRAFO }, AGORA);
    assert.ok(DESPEDIDAS.includes(fim.texto), fim.texto);
    assert.equal(fim.encerrar, true);
  });

  it("primeiro modelo calado e a segunda geração responde (pergunta sem \"?\"): sai a resposta, fora do fechamento", async () => {
    const llm = criarClienteFalso((args) => (args.sistema.dinamico ?? "").includes("ATENÇÃO: ele te fez")
      ? { responder: true, texto: "É o entregador.", requisito: null, concluiu: false, candidatoPerguntou: true }
      : { responder: false, texto: "", requisito: null, concluiu: false, candidatoPerguntou: true });
    const r = await perguntar(comV2(llm), emALTO, { fase: "ALTO_NIVEL", texto: "não entendi o que é courier", grafo: GRAFO }, AGORA);
    assert.equal(r.texto, "É o entregador.");
    assert.equal(llm.chamadas.length, 2, "a segunda geração rodou");
  });

  it("no fechamento, a pergunta sem \"?\" também ganha a segunda geração antes da reserva", async () => {
    const modeloSegundo = (args: LlmArgs<unknown>) => {
      if ((args.sistema.dinamico ?? "").includes("ATENÇÃO: ele te fez")) return { responder: true, texto: "É o entregador.", requisito: null, concluiu: false, candidatoPerguntou: true };
      const fala = args.mensagens.at(-1)?.content ?? "";
      if (fala.includes("courier")) return { responder: false, texto: "", requisito: null, concluiu: false, candidatoPerguntou: true };
      return modelo(args);
    };
    const llm = criarClienteFalso(modeloSegundo);
    const d = comV2(llm);
    let r = await perguntar(d, emALTO, { fase: "ALTO_NIVEL", texto: "Pronto, terminei o desenho.", grafo: GRAFO }, AGORA);
    for (let i = 0; i < 6 && r.fechamento !== "ultima_palavra"; i++) {
      r = await perguntar(d, r.estado, { fase: "ALTO_NIVEL", texto: "Certo, entendi.", grafo: GRAFO }, AGORA);
    }
    const antes = llm.chamadas.length;
    r = await perguntar(d, r.estado, { fase: "ALTO_NIVEL", texto: "não entendi o que é courier", grafo: GRAFO }, AGORA);
    assert.equal(r.texto, `É o entregador. ${VOLTA}`);
    assert.equal(r.encerrar, undefined);
    assert.equal(llm.chamadas.length - antes, 2, "a primeira leitura veio calada e a segunda respondeu");
    r = await perguntar(d, r.estado, { fase: "ALTO_NIVEL", texto: "não, só isso", grafo: GRAFO }, AGORA);
    assert.equal(r.encerrar, true);
  });
});

describe("quando o quadro fecha: vaga com plano e mudança de cenário (#129, decisão F)", () => {
  // Três peças ligadas: o caminho principal está desenhado, então sem a barra "terminei" fecharia na primeira vez.
  const DESENHO = "COMPONENTES\n- [r1] Cliente (retângulo)\n- [r2] API (retângulo)\n- [r3] Banco (retângulo)\nCONEXÕES\n- [s1] Cliente → API\n- [s2] API → Banco";
  const PLANO: PlanoDaSessao = {
    cargo: "Engenheiro de pagamentos", senioridade: "pleno", tom: "amigavel", dicas: "livres", foco: [], notas: "", duracaoMin: 30,
    criterios: [
      { nome: "Idempotência", descricao: "não cobra duas vezes", peso: 2 },
      { nome: "Falha no gateway", descricao: "o que acontece se o gateway cair", peso: 1 },
    ],
  };
  const COBERTOS: EstadoSessao["cobertura"] = {
    Idempotência: { positivo: 1, negativo: 0, neutro: 0 }, "Falha no gateway": { positivo: 1, negativo: 0, neutro: 0 },
  };
  const MIN = 60_000;
  /** Vaga de 30 min, começada `decorridos` minutos atrás, no alto nível, com o plano. */
  const vaga = (decorridos: number, extra: Partial<EstadoSessao> = {}): EstadoSessao => ({
    ...estadoInicial({ plano: PLANO }), fase: "ALTO_NIVEL", faseIniciadaEm: AGORA - 5 * MIN, iniciadaEm: AGORA - decorridos * MIN, ...extra,
  });
  const turno = (estado: EstadoSessao, texto: string, saida: Record<string, unknown>, agora = AGORA) => {
    const llm = criarClienteFalso(() => ({ requisito: null, desfecho: null, ...saida }));
    return perguntar({ llm, kit: kitDemo, problema, log: () => {}, versao: "v2" as const }, estado, { fase: "ALTO_NIVEL", texto, grafo: DESENHO }, agora);
  };
  const terminei = { responder: true, texto: "Beleza, vou olhar.", concluiu: true };

  it("vaga de 30 min, 'terminei' aos 9 min com critérios do plano sem evidência: comenta e pergunta no mesmo turno", async () => {
    const r = await turno(vaga(9), "Pronto, terminei.", terminei);
    assert.equal(r.fechamento, undefined);
    assert.ok(!r.estado.fechamento, "o fechamento não começou");
    assert.match(r.texto, /Cliente/);
    assert.ok(r.texto.trim().endsWith("?"), r.texto);
    assert.equal(conclusaoBarradaRecente(r.estado, AGORA, { kit: kitDemo, problema }), "faltam_criterios", "a análise recebe a linha da conclusão barrada");
  });

  it("a segunda e a terceira conclusão também não fecham enquanto a barra segurar", async () => {
    let r = await turno(vaga(9), "Pronto, terminei.", terminei);
    r = await turno(r.estado, "Já falei, pronto.", terminei, AGORA + 30_000);
    assert.equal(r.fechamento, undefined);
    assert.match(r.texto, /Cliente/);
    assert.ok(r.texto.trim().endsWith("?"), r.texto);
    r = await turno(r.estado, "Eu já terminei mesmo.", terminei, AGORA + 60_000);
    assert.equal(r.fechamento, undefined);
    assert.equal(r.estado.conclusoes, 3);
  });

  it("critérios cobertos e mudança já feita: 'terminei' fecha", async () => {
    const r = await turno(vaga(9, { cobertura: COBERTOS, empecilho: MUDANCA_ANUNCIADA }), "Pronto, terminei.", terminei);
    assert.notEqual(r.fechamento, undefined);
    assert.equal(r.estado.fechamento?.nucleo.gatilho, "concluiu");
  });

  it("faltando 15% da vaga (4 min de 30), fecha por tempo mesmo sem ele dizer que terminou; com 5 min, não", async () => {
    const quatro = await turno(vaga(26), "Posso assumir que o grupo tem no máximo 256 pessoas?", { responder: true, texto: "Pode." });
    assert.equal(quatro.estado.fechamento?.nucleo.gatilho, "tempo");
    const cinco = await turno(vaga(25), "Posso assumir que o grupo tem no máximo 256 pessoas?", { responder: true, texto: "Pode." });
    assert.equal(cinco.fechamento, undefined);
  });

  it("'tenho que sair' encerra mesmo com critérios e mudança pendentes (com urgência, o pedido vai direto à despedida)", async () => {
    const r = await turno(vaga(9), "Tenho que sair agora, pode encerrar.", { responder: false, texto: "", encerrar: true, urgente: true });
    assert.equal(r.encerrar, true);
    assert.ok(DESPEDIDAS.includes(r.texto), r.texto);
    assert.equal(r.fechamento, "encerrada");
  });

  // O modelo escreve as perguntas finais no mesmo turno (`perguntasFinais`): o código só as enfileira.
  const PERGUNTAS = ["Como o pedido repetido é tratado no seu desenho?", "E se o gateway cair, quem já pagou fica como?"];

  it("pedir para encerrar com critérios do plano sem evidência: anúncio e a 1ª pergunta que o modelo escreveu; a mudança pendente não entra", async () => {
    const r = await turno(vaga(9), "Pode encerrar, já falei o que tinha.", { responder: false, texto: "", encerrar: true, perguntasFinais: PERGUNTAS });
    assert.equal(r.encerrar, undefined);
    assert.equal(r.fechamento, "perguntas_finais");
    assert.equal(r.texto, `Beleza. Só mais umas coisas antes de terminar: ${PERGUNTAS[0]}`);
    assert.doesNotMatch(r.texto, /Mudança|volume|dez vezes/);
    // A resposta dele leva à segunda pergunta, e depois à última palavra (não à mudança de cenário).
    let s = await turno(r.estado, "Eu usaria uma chave de idempotência.", { responder: true, texto: "Entendi." });
    assert.equal(s.fechamento, "perguntas_finais");
    assert.equal(s.texto, `Entendi. ${PERGUNTAS[1]}`);
    s = await turno(s.estado, "Se o gateway cair, a fila segura.", { responder: true, texto: "Entendi." });
    assert.equal(s.fechamento, "ultima_palavra");
    assert.match(s.texto, /Era isso da minha parte\. Quer acrescentar alguma coisa antes de encerrar\?$/);
    const despedida = await turno(s.estado, "não, só isso", { responder: false, texto: "" });
    assert.equal(despedida.encerrar, true);
    assert.ok(DESPEDIDAS.includes(despedida.texto), despedida.texto);
  });

  it("pedir para encerrar faz no máximo duas perguntas finais, mesmo com três escritas pelo modelo", async () => {
    const tres = [...PERGUNTAS, "O que muda com dez vezes mais acessos?"];
    const r0 = await turno(vaga(9), "Pode encerrar.", { responder: false, texto: "", encerrar: true, perguntasFinais: tres });
    const falas = [r0.texto];
    let s = r0.estado;
    for (const fala of ["Certo, uma.", "Certo, duas."]) {
      const r = await turno(s, fala, { responder: true, texto: "Entendi." });
      falas.push(r.texto);
      s = r.estado;
    }
    assert.equal(falas.filter((t) => tres.some((p) => t.includes(p))).length, 2, falas.join(" | "));
    assert.doesNotMatch(falas.join(" "), /dez vezes/);
    assert.equal(s.fechamento?.nucleo.etapa, "ultima_palavra");
  });

  it("uma pergunta que ele já ouviu não volta: sai só a outra (o anúncio é o do singular)", async () => {
    const jaOuviu = { ...vaga(9), conversa: [{ quem: "agente" as const, texto: PERGUNTAS[0], em: AGORA - 60_000 }] };
    const r = await turno(jaOuviu, "Pode encerrar.", { responder: false, texto: "", encerrar: true, perguntasFinais: PERGUNTAS });
    assert.equal(r.texto, `Claro, vamos fechar. Antes, uma coisa rápida: ${PERGUNTAS[1]}`);
  });

  it("sem critério do plano pendente, as perguntas do modelo não entram: vai à última palavra", async () => {
    const r = await turno(vaga(9, { cobertura: COBERTOS, empecilho: MUDANCA_ANUNCIADA }), "Pode encerrar.", { responder: false, texto: "", encerrar: true, perguntasFinais: PERGUNTAS });
    assert.equal(r.texto, "Por mim, era isso. Quer acrescentar alguma coisa antes de encerrar?");
    assert.equal(r.fechamento, "ultima_palavra");
  });

  it("critério pendente, mas o modelo não escreveu perguntas: última palavra", async () => {
    const r = await turno(vaga(9), "Pode encerrar.", { responder: false, texto: "", encerrar: true, perguntasFinais: [] });
    assert.equal(r.texto, "Por mim, era isso. Quer acrescentar alguma coisa antes de encerrar?");
    assert.equal(r.fechamento, "ultima_palavra");
  });

  it("o prompt v2: repetir que terminou ou dizer que não tem mais nada é encerrar (não concluiu), e pede as perguntas finais", async () => {
    const llm = criarClienteFalso([{ responder: false, texto: "", requisito: null, concluiu: false }]);
    await perguntar({ llm, kit: kitDemo, problema, log: () => {}, versao: "v2" as const }, vaga(9), { fase: "ALTO_NIVEL", texto: "Já falei, nada mais.", grafo: DESENHO }, AGORA);
    const estatico = llm.chamadas[0].sistema.estatico;
    assert.match(estatico, /Ele repete que terminou[^\n]*"encerrar" true/);
    assert.match(estatico, /perguntasFinais: com encerrar true/);
  });
});

describe("português claro: a fala do quadro não sai com termo em inglês (#129, decisão H)", () => {
  const v2 = (llm: ReturnType<typeof criarClienteFalso>) => ({ ...deps(llm), versao: "v2" as const });
  const comVaga = (descricaoVaga?: string): EstadoSessao => ({
    ...estado,
    plano: { cargo: "Engenheiro de logística", senioridade: "pleno", tom: "amigavel", dicas: "livres", foco: [], notas: "", duracaoMin: 30, ...(descricaoVaga ? { descricaoVaga } : {}) },
  });

  it("o termo em inglês da fala vira o português (courier → entregador), sem a descrição da vaga", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Esse courier passa pela fila?", requisito: null, concluiu: false }]);
    const r = await perguntar(v2(llm), comVaga(), { fase: "REQUISITOS", texto: "Vou usar uma fila." }, AGORA);
    assert.equal(r.texto, "Esse entregador passa pela fila?");
  });

  it("o termo que a descrição da vaga usa fica como está; o outro é trocado", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "O courier e o rider chegam juntos?", requisito: null, concluiu: false }]);
    const r = await perguntar(v2(llm), comVaga("Experiência com courier próprio."), { fase: "REQUISITOS", texto: "Vou usar uma fila." }, AGORA);
    assert.equal(r.texto, "O courier e o entregador chegam juntos?");
  });

  it("o prompt do quadro (v2) manda o português claro", async () => {
    const llm = criarClienteFalso([{ responder: true, texto: "Certo.", requisito: null, concluiu: false }]);
    await perguntar(v2(llm), estado, { fase: "REQUISITOS", texto: "Oi" }, AGORA);
    assert.match(llm.chamadas[0].sistema.estatico, /Português claro: termo do domínio em português \("entregador"/);
  });
});
