// As travas da fala do Totti (lib/totti/guardas.ts), uma por uma e encadeadas. Os casos vêm das entrevistas de
// teste de 2026-11-11 (issues #83, #84 e #94) e dos testes que já existiam em cada sala.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aplicarGuardas, comVezDevolvida, convitesPara, escolherConvite, ePerguntaDePorque, eSoReacao, falaNaoRepetida, perguntaDeConducao, perguntaDePorque, perguntaJaFeita, promessaVazia,
  reacaoNeutra, semCumprimento, semEcoNoComeco, semPerguntaNoFim, semPerguntaNoFimSeSobrar, semReacaoRepetida, semValidacao, emPortugues,
} from "../guardas";
import { avisosDeQueVaiOlhar } from "../turno";

describe("cumprimento e reapresentação fora da abertura", () => {
  it("o caso real da #83: o cumprimento sai e a pergunta fica", () => {
    assert.equal(semCumprimento("Oi, tudo bem? Como você está pensando em abordar esse problema?"), "Como você está pensando em abordar esse problema?");
  });
  it("tira oi, olá, bom dia, tudo bem?, como vai? e a reapresentação", () => {
    assert.equal(semCumprimento("Olá! Por que o contador fica no banco?"), "Por que o contador fica no banco?");
    assert.equal(semCumprimento("Bom dia, tudo certo? Me fala desse cache."), "Me fala desse cache.");
    assert.equal(semCumprimento("Boa tarde. E a fila, quem consome?"), "E a fila, quem consome?");
    assert.equal(semCumprimento("E aí, tudo bem? O que esse laço faz?"), "O que esse laço faz?");
    assert.equal(semCumprimento("Tudo bem? Qual é a ideia aqui?"), "Qual é a ideia aqui?");
    assert.equal(semCumprimento("Oi, eu sou o Totti e vou conduzir a sua entrevista. Como você começaria?"), "Como você começaria?");
  });
  it("se só havia o cumprimento, não sobra fala", () => {
    for (const fala of ["Oi, tudo bem?", "Olá!", "Oi. Eu sou o Totti.", "E aí?", "Bom dia, como vai?"]) assert.equal(semCumprimento(fala), "", fala);
  });
  it("não confunde com fala que só parece cumprimento", () => {
    for (const fala of [
      "Tudo bem, seguimos. Pode continuar de onde parou.",
      "Tudo bem. Fica à vontade.",
      "E aí, qual é a ideia que você está seguindo?",
      "Beleza, pode começar.",
      "Boa parte dos acessos é leitura.",
      "Como você está pensando em guardar isso?",
    ]) assert.equal(semCumprimento(fala), fala, fala);
  });
  it("o candidato cumprimentou ou perguntou quem fala: responder é o natural", () => {
    assert.equal(semCumprimento("Oi! Tudo bem, e você?", "oi totti tudo bem"), "Oi! Tudo bem, e você?");
    assert.equal(semCumprimento("Eu sou o Totti, o entrevistador.", "desculpa, qual é o seu nome mesmo"), "Eu sou o Totti, o entrevistador.");
  });
});

describe("validação", () => {
  it("o caso real da #84: \"Faz sentido.\" sai e o resto fica", () => {
    assert.equal(semValidacao("Faz sentido. Pode seguir com a próxima parte do seu desenho."), "Pode seguir com a próxima parte do seu desenho.");
  });
  it("tira a reação que julga, no começo, no meio ou colada por vírgula", () => {
    assert.equal(semValidacao("Boa. E onde fica o contador?"), "E onde fica o contador?");
    assert.equal(semValidacao("Boa, e onde fica o contador?"), "E onde fica o contador?");
    assert.equal(semValidacao("Perfeito! Isso mesmo. E se o cache cair?"), "E se o cache cair?");
    assert.equal(semValidacao("Entendi, faz todo sentido. E a escrita?"), "Entendi. E a escrita?");
    assert.equal(semValidacao("Ótima pergunta. São 100 milhões por mês."), "São 100 milhões por mês.");
    assert.equal(semValidacao("Tá. Muito bom. Pode seguir."), "Tá. Pode seguir.");
    assert.equal(semValidacao("Exato, o banco fica atrás do cache."), "O banco fica atrás do cache.");
    assert.equal(semValidacao("Boa escolha de banco. E o volume?"), "E o volume?");
  });
  it("o que faz parte de uma pergunta fica", () => {
    for (const fala of ["Faz sentido para você usar uma fila aqui?", "Faz sentido?", "Faz sentido, né?", "Isso mesmo que você quis dizer com réplica?"]) {
      assert.equal(semValidacao(fala), fala, fala);
    }
  });
  it("reação neutra, fato e convite não são validação", () => {
    for (const fala of [
      "Certo. Pode seguir.", "Tá, entendi.", "Saquei. E a memória?", "Isso, um bilhão por mês.", "Legal. E depois?",
      "Boa parte dos acessos é leitura.", "Bom, vamos por partes.", "Bem, isso depende do volume.", "Boa tarde.", "O exato momento em que a fila enche.",
    ]) assert.equal(semValidacao(fala), fala, fala);
  });
  it("fala que era só validação fica vazia (quem troca por uma reação neutra é o aplicarGuardas)", () => {
    for (const fala of ["Perfeito.", "Boa!", "Faz sentido.", "Isso mesmo, exato.", "Ótimo, muito bom."]) assert.equal(semValidacao(fala), "", fala);
  });
});

describe("eco", () => {
  const fala = "Para gerar o código curto eu vou usar um contador e converter para base 62.";
  it("tira a abertura que só repete o candidato com as palavras dele", () => {
    assert.equal(semEcoNoComeco("Contador com base 62. E onde ele fica guardado?", fala), "E onde ele fica guardado?");
    assert.equal(semEcoNoComeco("Postgres. Como você lida com o volume de leitura?", "Vou guardar os links num Postgres."), "Como você lida com o volume de leitura?");
    assert.equal(semEcoNoComeco("Entendi que você vai usar um contador global. E se ele cair?", fala), "E se ele cair?");
    assert.equal(semEcoNoComeco("Então você quer evitar colisão. Pode seguir.", fala), "Pode seguir.");
  });
  it("o caso real da #84: a fala que era só o eco não sai", () => {
    assert.equal(semEcoNoComeco("Terminou.", "Eu acho que é isso, terminei."), "");
    assert.equal(semEcoNoComeco("Terminou o desenho.", "Eu disse que eu já terminei o meu desenho."), "");
    assert.equal(semEcoNoComeco("Entendi que você vai usar base 62.", fala), "");
    assert.equal(semEcoNoComeco("Contador com base 62.", fala), "");
  });
  it("reação curta e conteúdo novo não são eco", () => {
    assert.equal(semEcoNoComeco("Entendi. E onde ele fica guardado?", fala), "Entendi. E onde ele fica guardado?");
    assert.equal(semEcoNoComeco("Tá.", "tá, eu acho que é isso"), "Tá.");
    assert.equal(semEcoNoComeco("Certo.", "certo, então eu sigo"), "Certo.");
    assert.equal(semEcoNoComeco("E se esse serviço cair no meio do dia?", fala), "E se esse serviço cair no meio do dia?");
  });
  it("resposta a uma pergunta dele usa as mesmas palavras e não é eco", () => {
    const pergunta = "Tem que dar para o usuário escolher o código, tipo um apelido personalizado?";
    assert.equal(semEcoNoComeco("Sim, o usuário pode escolher o código. É opcional.", pergunta), "Sim, o usuário pode escolher o código. É opcional.");
    // A transcrição quase nunca põe o "?": a sala avisa que ele perguntou.
    assert.equal(semEcoNoComeco("Cem milhões de links por mês.", "são cem milhões de links por mês né", true), "Cem milhões de links por mês.");
    // E a frase que responde ("Pode…", "São…") fica mesmo sem o aviso.
    assert.equal(semEcoNoComeco("Pode assumir cem milhões por mês.", "posso assumir cem milhões de links por mês"), "Pode assumir cem milhões por mês.");
  });
});

describe("reação vazia repetida", () => {
  it("\"Hm.\" atrás de \"Hm.\" não sai; a primeira passa", () => {
    assert.equal(semReacaoRepetida("Hm.", ["Hm."]), "");
    assert.equal(semReacaoRepetida("Tá.", ["E se cair?", "Certo, beleza."]), "");
    assert.equal(semReacaoRepetida("Hm.", []), "Hm.");
    assert.equal(semReacaoRepetida("Hm.", ["E se cair?"]), "Hm.");
  });
  it("não abre com o mesmo reconhecimento da fala anterior, nem com outro depois do \"uhum\" da sala", () => {
    assert.equal(semReacaoRepetida("Saquei. E o custo de memória?", [], true), "E o custo de memória?");
    assert.equal(semReacaoRepetida("Entendi, fica mais direto. Qual o custo?", [], true), "Fica mais direto. Qual o custo?");
    assert.equal(semReacaoRepetida("Saquei. E o custo?", [], false), "Saquei. E o custo?");
    assert.equal(semReacaoRepetida("Saquei, e a pilha vazia?", ["Saquei. Pode seguir."], false), "E a pilha vazia?");
    assert.equal(semReacaoRepetida("Tá, e a pilha vazia?", ["Tá. Pode seguir."], false), "E a pilha vazia?");
    // Só a reação: sem ela não sobra fala, fica como está.
    assert.equal(semReacaoRepetida("Saquei.", [], true), "Saquei.");
  });
  it("eSoReacao reconhece reação sem conteúdo", () => {
    for (const t of ["Hm.", "Hmm", "Tá.", "Certo, beleza.", "Uhum.", "Ok"]) assert.equal(eSoReacao(t), true, t);
    for (const t of ["Hm. E onde fica o contador?", "Pode seguir.", "Tá, vai em frente.", "", undefined]) assert.equal(eSoReacao(t), false, String(t));
  });
  it("a reação neutra não repete a que abriu a última fala", () => {
    assert.equal(reacaoNeutra([]), "Certo.");
    assert.equal(reacaoNeutra(["Certo. Pode seguir."]), "Tá.");
    assert.equal(reacaoNeutra(["E se o cache cair?"]), "Certo.");
  });
});

describe("pergunta repetida e pergunta de condução", () => {
  const JA_PERGUNTOU = "Se cada pessoa num grupo de cem mil faz uma requisição direta pro banco pra buscar mensagem, como você imagina que o banco se comporta com esse volume?";
  const REPETIDA = "Se a gente mantiver essa ida direta ao banco para cada pessoa do grupo buscar mensagem, como você escalaria essa parte para aguentar o volume?";
  it("reconhece a pergunta que o candidato reclamou de ouvir de novo", () => {
    assert.equal(perguntaJaFeita(REPETIDA, [JA_PERGUNTOU]), true);
    assert.equal(perguntaJaFeita("Como a mensagem chega em quem está offline?", [JA_PERGUNTOU]), false);
  });
  it("reconhece a pergunta que só devolve a condução", () => {
    for (const vaga of ["Quer seguir para outra parte do desenho ou detalhar algo que a gente passou por cima?", "O que mais você gostaria de detalhar ou adicionar no desenho?", "Quer seguir assim ou mudar alguma coisa?"]) {
      assert.equal(perguntaDeConducao(vaga), true, vaga);
    }
    for (const concreta of ["Por que você quer guardar as mensagens nesse banco?", "Como a mensagem chega em quem está offline?", "Quer uma dica?", "Quer tentar um pouco e eu volto depois?"]) {
      assert.equal(perguntaDeConducao(concreta), false, concreta);
    }
  });
});

describe("convite para seguir", () => {
  it("é a mesma lista nas duas salas, só com o material trocado", () => {
    const codigo = convitesPara("codigo");
    const quadro = convitesPara("quadro");
    assert.equal(codigo.length, quadro.length);
    assert.deepEqual(codigo.map((c) => c.replace("o código", "o desenho")), quadro);
    assert.ok(codigo.includes("Pode seguir com o código.") && quadro.includes("Pode seguir com o desenho."));
  });
  it("não repete o convite que o Totti acabou de dizer, ignorando acento e pontuação", () => {
    const texto = "São 20 mil por dia.";
    const primeiro = escolherConvite(texto, [], "quadro");
    const segundo = escolherConvite(texto, [`Certo. ${primeiro}`], "quadro");
    assert.notEqual(segundo, primeiro);
    assert.ok(![primeiro, segundo].includes(escolherConvite(texto, [primeiro, segundo], "quadro")));
    assert.notEqual(escolherConvite("a", ["pode continuar de onde parou"], "codigo"), "Pode continuar de onde parou.");
  });
  it("se todos já foram ditos, volta à escolha de sempre em vez de travar", () => {
    assert.equal(escolherConvite("abc", convitesPara("codigo"), "codigo"), escolherConvite("abc", [], "codigo"));
  });
  it("comVezDevolvida põe o convite da sala só quando a fala não devolve a vez", () => {
    assert.match(comVezDevolvida("Isso, um bilhão de links novos por mês.", [], "quadro"), /^Isso, um bilhão de links novos por mês\. (Pode|Continua)/);
    assert.equal(comVezDevolvida("Saquei. E se o cache cair?", [], "codigo"), "Saquei. E se o cache cair?");
    assert.equal(comVezDevolvida("São 5 anos. Pode seguir com esse número.", [], "quadro"), "São 5 anos. Pode seguir com esse número.");
    assert.doesNotMatch(comVezDevolvida("Certo, a lista vem ordenada.", [], "codigo"), /desenho/);
  });
  it("tirar a pergunta do fim: com convite sempre, ou só se não sobrar fala", () => {
    assert.doesNotMatch(semPerguntaNoFim("Sem problema, seguimos. Quer olhar outra parte do desenho?", [], "quadro"), /\?/);
    assert.equal(semPerguntaNoFimSeSobrar("Sem problema, seguimos. Quer olhar outra parte do desenho?", "quadro"), "Sem problema, seguimos.");
    assert.ok(convitesPara("codigo").includes(semPerguntaNoFimSeSobrar("O que mais você quer detalhar?", "codigo")));
    assert.equal(semPerguntaNoFimSeSobrar("Tranquilo, continua daí.", "codigo"), "Tranquilo, continua daí.");
  });
  it("falaNaoRepetida escolhe a ainda não dita e, se todas foram, a menos recente", () => {
    assert.equal(falaNaoRepetida(["a", "b", "c"], ["a"]), "b");
    assert.equal(falaNaoRepetida(["a", "b"], ["b", "a"]), "b");
  });
});

describe("aplicarGuardas", () => {
  it("barra promessa vazia e aceita comentário com pergunta", () => {
    const avisosDasDuasSalas = [...avisosDeQueVaiOlhar("quadro"), ...avisosDeQueVaiOlhar("codigo")];
    for (const fala of [...avisosDasDuasSalas, "Vou olhar.", "Vou dar uma olhada.", "Só um instante que eu olho o que você fez.", "Deixa eu ver.", "Já te falo.", "Vou analisar.", "Certo, vou olhar o desenho.", "Deixa eu dar uma olhada no código."]) assert.equal(promessaVazia(fala), true, fala);
    assert.equal(promessaVazia("Tá, olhei: o cache fica antes do banco. Por que ali?"), false);
    assert.equal(aplicarGuardas("Vou analisar.").travas.includes("promessa_vazia"), true);
  });
  it("os três casos reais de 11/11, com o nome da trava que agiu", () => {
    assert.deepEqual(
      aplicarGuardas("Oi, tudo bem? Como você está pensando em abordar esse problema?", { falaDoCandidato: "tá bom" }),
      { texto: "Como você está pensando em abordar esse problema?", travas: ["cumprimento"] },
    );
    assert.deepEqual(
      aplicarGuardas("Faz sentido. Pode seguir com a próxima parte do seu desenho.", { falaDoCandidato: "aí o serviço grava o evento na fila e o consumidor atualiza o saldo" }),
      { texto: "Pode seguir com a próxima parte do seu desenho.", travas: ["validacao"] },
    );
    assert.deepEqual(aplicarGuardas("Terminou.", { falaDoCandidato: "Eu acho que é isso, terminei." }), { texto: "", travas: ["eco"] });
  });
  it("fala que era só validação vira uma reação neutra, que não repete a da fala anterior", () => {
    assert.deepEqual(aplicarGuardas("Perfeito!", {}), { texto: "Certo.", travas: ["validacao"] });
    assert.deepEqual(aplicarGuardas("Boa.", { falasDoTotti: ["Certo. Pode seguir."] }), { texto: "Tá.", travas: ["validacao"] });
    // ...e some se a fala anterior já era só uma reação (a segunda reação vazia seguida não sai).
    assert.deepEqual(aplicarGuardas("Boa.", { falasDoTotti: ["Hm."] }), { texto: "", travas: ["validacao", "reacao_repetida"] });
  });
  it("encadeia: cumprimento, validação e eco na mesma fala", () => {
    const r = aplicarGuardas("Oi! Boa. Contador com base 62. E onde ele fica guardado?", { falaDoCandidato: "vou usar um contador e converter para base 62" });
    assert.deepEqual(r, { texto: "E onde ele fica guardado?", travas: ["cumprimento", "validacao", "eco"] });
  });
  it("pergunta repetida e de condução saem; o que sobra passa pela reação repetida", () => {
    const feita = "Como o banco aguenta o volume de leitura no pico de acessos?";
    assert.deepEqual(
      aplicarGuardas("Saquei. E como o banco aguenta esse volume de leitura no pico?", { perguntasJaFeitas: [feita] }),
      { texto: "Saquei.", travas: ["pergunta_repetida"] },
    );
    assert.deepEqual(aplicarGuardas("Hm. Quer detalhar mais alguma parte?", { falasDoTotti: ["Hm."] }), { texto: "", travas: ["pergunta_de_conducao", "reacao_repetida"] });
    assert.deepEqual(aplicarGuardas("Quer detalhar mais alguma parte?", { barrarConducao: false }), { texto: "Quer detalhar mais alguma parte?", travas: [] });
  });
  it("na abertura o cumprimento fica; fala boa passa sem trava nenhuma", () => {
    const abertura = "Oi, tudo bem? Eu sou o Totti e vou conduzir sua entrevista hoje.";
    assert.deepEqual(aplicarGuardas(abertura, { abertura: true }), { texto: abertura, travas: [] });
    for (const fala of ["Saquei. E se o cache cair?", "São 20 mil por dia. Pode seguir com esse número.", "Tranquilo, deixa isso de lado. Pode seguir com a próxima parte do seu desenho.", "Hm."]) {
      assert.deepEqual(aplicarGuardas(fala, { falaDoCandidato: "e aí eu separo leitura de escrita", falasDoTotti: ["Como você separa os fluxos?"] }), { texto: fala, travas: [] }, fala);
    }
  });
  it("é idempotente: passar de novo não muda mais nada", () => {
    const contexto = { falaDoCandidato: "vou usar um contador e converter para base 62", falasDoTotti: ["Certo. Pode seguir."] };
    for (const fala of ["Oi! Boa. Contador com base 62. E onde ele fica guardado?", "Perfeito.", "Certo, e a pilha vazia?", "Terminou."]) {
      const uma = aplicarGuardas(fala, contexto);
      assert.deepEqual(aplicarGuardas(uma.texto, contexto), { texto: uma.texto, travas: [] }, fala);
    }
  });
});

describe("por quê: pergunta de porquê e a que ainda não saiu", () => {
  it("reconhece a pergunta de porquê, com ou sem acento e com reação antes", () => {
    assert.equal(ePerguntaDePorque("Por que no backend?"), true);
    assert.equal(ePerguntaDePorque("Tá. Por quê?"), true);
    assert.equal(ePerguntaDePorque("Por que essa opção?"), true);
    assert.equal(ePerguntaDePorque("Tá. E o banco aguenta?"), false);
    assert.equal(ePerguntaDePorque("Por que no backend, então."), false);
  });
  it("a pergunta de porquê não repete a última que o Totti disse, mesmo dentro de uma reação", () => {
    assert.equal(perguntaDePorque([]), "Por quê?");
    assert.equal(perguntaDePorque(["Tá. Por quê?"]), "Por que essa opção?");
    assert.equal(perguntaDePorque(["Tá. Por quê?", "Certo. Por que essa opção?"]), "E por que essa e não a outra?");
  });
});

describe("português claro (emPortugues)", () => {
  it("troca courier e rider, no singular e no plural, pelo termo do português", () => {
    assert.equal(emPortugues("Chegou o courier."), "Chegou o entregador.");
    assert.equal(emPortugues("Os couriers e os riders saem juntos."), "Os entregadores e os entregadores saem juntos.");
    assert.equal(emPortugues("O rider atrasou."), "O entregador atrasou.");
  });
  it("mantém a inicial maiúscula da palavra trocada", () => {
    assert.equal(emPortugues("Courier chega às dez."), "Entregador chega às dez.");
    assert.equal(emPortugues("Riders na fila."), "Entregadores na fila.");
  });
  it("só troca palavra inteira: dentro de outra palavra, não", () => {
    assert.equal(emPortugues("O supercourier e o couriers_api ficam."), "O supercourier e o couriers_api ficam.");
    assert.equal(emPortugues("Um courierzinho."), "Um courierzinho.");
  });
  it("não mexe nos termos que são o nome usual da área", () => {
    assert.equal(emPortugues("Kafka, cache e API com load balancer."), "Kafka, cache e API com load balancer.");
  });
  it("não troca o termo que a descrição da vaga usa, mas troca o resto", () => {
    const vaga = "Experiência com courier próprio e rastreio em tempo real.";
    assert.equal(emPortugues("O courier e o rider atrasam.", vaga), "O courier e o entregador atrasam.");
    assert.equal(emPortugues("O courier atrasa.", "Logística de última milha."), "O entregador atrasa.");
  });
  it("é idempotente: trocar de novo não muda mais nada", () => {
    const uma = emPortugues("Os couriers e o Rider.");
    assert.equal(emPortugues(uma), uma);
  });
});
