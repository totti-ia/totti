// Resposta antecipada: o rascunho não muda a sessão, e a confirmação com a mesma entrada reaproveita as chamadas lentas.
// LLM e Jev falsos (apoio.ts). Cada teste abre uma sessão nova: o id é um UUID, e o cache é global.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { depsQueReaproveitam, prepararRascunho } from "../resposta-antecipada";
import { conduzirTurno } from "../turno";
import { ErroChat, type ChatOpcoes, type ChatResposta } from "../llm";
import { estaOcupada } from "../sessoes";
import { chatFalso, ela, jevFalso, saida, sessaoAberta, totti } from "./apoio";

const TEXTO = "Pode ser, vamos nessa.";

const respostaDoChat = (fala: string): ChatResposta => ({
  content: saida(fala),
  ms: 1,
  provedor: "featherless",
  model: "falso",
  tentativas: [{ provedor: "featherless", model: "falso", ms: 1 }],
});

describe("resposta antecipada: o rascunho não muda a sessão", () => {
  it("prepararRascunho deixa a sessão igual e não mexe na transcrição", async () => {
    const sessao = sessaoAberta([totti("Oi, vamos começar? Você prefere live coding ou system design?")]);
    const antes = structuredClone(sessao);
    const { chat } = chatFalso(saida("Ótimo. Me conta do seu último projeto de APIs."));

    const { fala } = await prepararRascunho(sessao, TEXTO, { chat, ...jevFalso() });

    assert.notEqual(fala, null);
    assert.deepEqual(sessao, antes);
    assert.equal(sessao.transcricao.length, antes.transcricao.length);
    assert.equal(estaOcupada(sessao.id), false);
  });
});

describe("resposta antecipada: confirmação com a mesma entrada reaproveita", () => {
  it("o chat roda só no rascunho, a fala é a mesma e a fala dela entra uma vez", async () => {
    const sessao = sessaoAberta([totti("Oi, vamos começar? Você prefere live coding ou system design?")]);
    const { chat, chamadas } = chatFalso(saida("Ótimo. Me conta do seu último projeto de APIs."));

    const rascunho = await prepararRascunho(sessao, TEXTO, { chat, ...jevFalso() });
    const chamadasDoRascunho = chamadas.length;
    assert.ok(chamadasDoRascunho >= 1);
    assert.notEqual(rascunho.fala, null);

    const { deps, contagem } = depsQueReaproveitam(sessao.id, { chat, ...jevFalso() });
    const real = await conduzirTurno(sessao, TEXTO, deps);

    assert.equal(chamadas.length, chamadasDoRascunho, "o chat não roda de novo na confirmação");
    assert.equal(contagem.aoVivo, 0);
    assert.equal(contagem.doRascunho, chamadasDoRascunho + 2, "chat do rascunho, cobertura e ênfase reaproveitados");
    assert.equal(real.fala, rascunho.fala);
    assert.equal(sessao.transcricao.filter((t) => t.role === "recrutadora" && t.text === TEXTO).length, 1);
  });

  it("texto diferente na confirmação: o chat roda de novo", async () => {
    const sessao = sessaoAberta([totti("Oi, vamos começar? Você prefere live coding ou system design?")]);
    const { chat, chamadas } = chatFalso(saida("Ótimo. Me conta do seu último projeto de APIs."));

    await prepararRascunho(sessao, "Pode ser", { chat, ...jevFalso() });
    const chamadasDoRascunho = chamadas.length;

    const { deps, contagem } = depsQueReaproveitam(sessao.id, { chat, ...jevFalso() });
    await conduzirTurno(sessao, "Pode ser, vamos nessa, e também quero falar de banco.", deps);

    assert.ok(chamadas.length > chamadasDoRascunho, "a entrada mudou: o chat roda ao vivo");
    assert.ok(contagem.aoVivo >= 1);
  });

  it("sessão mudou entre rascunho e confirmação: as chamadas com entrada diferente vão ao vivo, sem erro", async () => {
    const sessao = sessaoAberta([totti("Oi, vamos começar? Você prefere live coding ou system design?")]);
    const { chat, chamadas } = chatFalso(saida("Ótimo. Me conta do seu último projeto de APIs."));

    await prepararRascunho(sessao, TEXTO, { chat, ...jevFalso() });
    const chamadasDoRascunho = chamadas.length;

    // Como uma extração faria: o rascunho da sessão muda, e a entrada da cobertura muda com ele.
    sessao.rascunho = structuredClone(sessao.rascunho);
    sessao.rascunho.seniority = sessao.rascunho.seniority === "senior" ? "pleno" : "senior";

    const { deps, contagem } = depsQueReaproveitam(sessao.id, { chat, ...jevFalso() });
    const real = await conduzirTurno(sessao, TEXTO, deps);

    assert.ok(chamadas.length > chamadasDoRascunho, "o chat, com a sessão nova, roda ao vivo");
    assert.ok(contagem.aoVivo >= 1);
    assert.equal(typeof real.fala, "string");
  });

  it("rascunho cujo chat falha: a confirmação chama ao vivo e funciona", async () => {
    const sessao = sessaoAberta([totti("Oi, vamos começar? Você prefere live coding ou system design?")]);
    let chamadas = 0;
    const chat = async (_opcoes: ChatOpcoes): Promise<ChatResposta> => {
      chamadas += 1;
      // Primeira chamada (a do rascunho) falha; as seguintes respondem.
      if (chamadas === 1) throw new ErroChat("nenhum provedor respondeu", []);
      return respostaDoChat("Ótimo. Me conta do seu último projeto de APIs.");
    };

    const rascunho = await prepararRascunho(sessao, TEXTO, { chat, ...jevFalso() });
    assert.equal(rascunho.fala, null);
    assert.equal(chamadas, 1);

    const { deps, contagem } = depsQueReaproveitam(sessao.id, { chat, ...jevFalso() });
    const real = await conduzirTurno(sessao, TEXTO, deps);

    assert.equal(chamadas, 2, "a confirmação chama o chat de novo, ao vivo");
    assert.ok(contagem.aoVivo >= 1);
    assert.match(real.fala, /Me conta do seu último projeto de APIs/);
    assert.equal(sessao.transcricao.filter((t) => t.role === "recrutadora" && t.text === TEXTO).length, 1);
  });
});
