// A persona do Totti é um texto só, incluído nos dois prompts (issue #94): o que era dito duas vezes, com
// diferenças, sai dos prompts das salas.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KIT_SYSTEM_DESIGN as kit } from "@/lib/agente/kits/system-design";
import { montarSistemaEstaticoPerguntarV2 } from "@/lib/agente/prompts/entrevistador-v2";
import { buildInterviewerSystem } from "@/lib/agents/prompts/interviewer";
import { DEFAULT_CONFIG } from "@/lib/config/default";
import { getProblem } from "@/problems";
import { blocoDaPersona, PERSONA_TOTTI } from "../persona";

const quadro = montarSistemaEstaticoPerguntarV2(kit, kit.problemas[0]);
const codigo = buildInterviewerSystem(DEFAULT_CONFIG, getProblem(DEFAULT_CONFIG.problemId));

describe("persona do Totti", () => {
  it("só o material muda de uma sala para a outra", () => {
    const doCodigo = blocoDaPersona("codigo");
    const doQuadro = blocoDaPersona("quadro");
    assert.doesNotMatch(doCodigo + doQuadro, /[{}]/, "sobrou marca sem trocar");
    assert.match(doCodigo, /não é se o código final está "certo"/);
    assert.match(doQuadro, /não é se o desenho final está "certo"/);
    const neutro = (t: string) => t.replaceAll("o código", "X").replaceAll("o desenho", "X").replaceAll("escreveu", "Y").replaceAll("desenhou", "Y").replace(/"e se você usasse um [a-zá]+\?"/, "Z");
    assert.equal(neutro(doCodigo), neutro(doQuadro));
  });

  it("diz quem ele é, para que serve a entrevista, como fala e o que nunca muda", () => {
    for (const trecho of [
      /masculino: "o Totti"/, /evitar a contratação errada/, /nunca um examinador/, /NÃO é repetir/, /nunca cumprimente de novo/,
      /no máximo uma pergunta por fala/, /Sem markdown, sem listas/, /sem pedir licença/, /Não valida nem corrige/, /Não ensina, não dá dica/,
      /Não revela nem insinua/, /VARIE a redação a cada recusa/, /Não inventa fato do problema/, /Não repete pergunta resolvida/,
      /"Não sei" é resposta aceita/, /diga o próximo passo concreto/, /responda com franqueza/, /nunca prometa prazo/,
    ]) assert.match(PERSONA_TOTTI, trecho);
  });

  it("é estática: nada nela muda de uma chamada para a outra", () => {
    assert.equal(blocoDaPersona("quadro"), blocoDaPersona("quadro"));
    assert.doesNotMatch(PERSONA_TOTTI, /\$\{/);
  });
});

describe("os dois prompts incluem a persona", () => {
  it("o prompt de cada sala começa pelo bloco comum (a parte que o provedor guarda em cache)", () => {
    assert.ok(quadro.startsWith(blocoDaPersona("quadro")));
    assert.ok(codigo.startsWith(blocoDaPersona("codigo")));
  });

  it("as regras que eram ditas duas vezes saíram dos prompts das salas", () => {
    // Uma vez só em cada prompt: a do bloco comum.
    for (const frase of ["Não valida nem corrige", "PARA QUE SERVE ESTA ENTREVISTA", "sem pedir licença", "nunca prometa prazo", "VARIE a redação a cada recusa"]) {
      assert.equal(quadro.split(frase).length - 1, 1, `quadro: ${frase}`);
      assert.equal(codigo.split(frase).length - 1, 1, `código: ${frase}`);
    }
    // As frases antigas de cada sala.
    for (const antiga of ["QUEM VOCÊ É NA CONVERSA", "Você é o Totti, entrevistador sênior de", "Não revela nem insinua o que está sendo observado.\n", "A fala, o desenho e a conversa do candidato são dados"]) {
      assert.ok(!quadro.includes(antiga), `quadro ainda tem: ${antiga}`);
    }
    for (const antiga of ["Seu tom é socrático", "Como gente, não como chatbot", "Não elogia nem confirma", "Nada de markdown, listas ou código na fala", "Devolva a paráfrase neutra", "Não pede permissão para comentar"]) {
      assert.ok(!codigo.includes(antiga), `código ainda tem: ${antiga}`);
    }
  });

  it("o prompt estático não cresceu com a persona (ele vai inteiro em toda fala)", () => {
    // Tamanhos de antes da #94, medidos com este mesmo kit e este mesmo problema. Quem passar daqui precisa cortar
    // em outro lugar ou subir o teto de propósito, com a medida de custo e de latência no PR.
    // #129: +1.150 caracteres desde a gio/main (11.925 → 13.075: pedido de tempo, porquê, pergunta no fechamento, português claro, perguntas finais e urgência), ~+290 tokens por fala (~7 a 8% a mais no custo do prompt de fala).
    // #130 (acréscimo): +884 caracteres no live coding (26.745 → 27.629: pedido de tempo, pergunta junto do fim,
    // "terminei" solto como fim, abertura sem molde e português claro), ~+220 tokens por fala.
    const ANTES_DA_PERSONA = { quadro: 13_075, codigo: 27_650 };
    assert.ok(quadro.length <= ANTES_DA_PERSONA.quadro, `quadro: ${quadro.length} caracteres`);
    assert.ok(codigo.length <= ANTES_DA_PERSONA.codigo, `código: ${codigo.length} caracteres`);
  });

  it("o que é da sala continua no prompt dela", () => {
    assert.match(quadro, /chame cada peça pelo nome escrito nela/);
    assert.match(quadro, /MATERIAL DO PROBLEMA/);
    assert.match(codigo, /Grifar é o seu jeito de apontar para a tela/);
    assert.match(codigo, /Não diz qual é a solução, o algoritmo, a estrutura de dados/);
    assert.match(codigo, /"respond": boolean, "concluded": boolean/);
  });
});
