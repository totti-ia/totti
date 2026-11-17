import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { render } from "@react-email/render";
import { CONTATO_PADRAO, pedirDemonstracao } from "@/lib/contato/demonstracao";
import type { sendEmail } from "@/lib/email/send";

Object.assign(globalThis, { React });
const env = process.env as Record<string, string | undefined>;
const salvo = env.CONTATO_EMAIL;
afterEach(() => {
  if (salvo === undefined) delete env.CONTATO_EMAIL;
  else env.CONTATO_EMAIL = salvo;
});

function envioFalso() {
  return mock.fn<typeof sendEmail>(async () => ({ status: "sent", id: "x" }) as const);
}

const valido = { nome: "Ana Lima", email: "ana@empresa.com", empresa: "Empresa", mensagem: "Contratamos 10 devs/mês." };

describe("pedirDemonstracao", () => {
  it("manda para o contato padrão, com o responder indo para quem pediu", async () => {
    delete env.CONTATO_EMAIL;
    const enviar = envioFalso();
    const r = await pedirDemonstracao(valido, enviar);
    assert.deepEqual(r, { ok: true, envio: "sent" });
    const args = enviar.mock.calls[0].arguments[0];
    assert.equal(args.to, CONTATO_PADRAO);
    assert.equal(args.replyTo, "ana@empresa.com");
    assert.match(args.subject, /Ana Lima \(Empresa\)/);
    const html = await render(args.template);
    assert.match(html, /Contratamos 10 devs/);
    assert.match(html, /ana@empresa\.com/);
  });

  it("respeita CONTATO_EMAIL", async () => {
    env.CONTATO_EMAIL = "outro@totti.ia.br";
    const enviar = envioFalso();
    await pedirDemonstracao(valido, enviar);
    assert.equal(enviar.mock.calls[0].arguments[0].to, "outro@totti.ia.br");
  });

  it("recusa e-mail inválido e nome vazio, sem enviar", async () => {
    const enviar = envioFalso();
    const r = await pedirDemonstracao({ nome: " ", email: "nao-e-email" }, enviar);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(Object.keys(r.campos).sort(), ["email", "nome"]);
    assert.equal(enviar.mock.callCount(), 0);
  });

  it("empresa e mensagem são opcionais", async () => {
    const enviar = envioFalso();
    const r = await pedirDemonstracao({ nome: "Ana", email: "ana@x.com" }, enviar);
    assert.equal(r.ok, true);
    assert.equal(enviar.mock.calls[0].arguments[0].subject, "Demonstração do Totti: Ana");
  });

  it("robô que preenche o campo escondido recebe ok, mas nada é enviado", async () => {
    const enviar = envioFalso();
    const r = await pedirDemonstracao({ ...valido, site: "http://spam" }, enviar);
    assert.deepEqual(r, { ok: true, envio: "ignorado" });
    assert.equal(enviar.mock.callCount(), 0);
  });

  it("quebra de linha no nome não chega ao assunto", async () => {
    const enviar = envioFalso();
    await pedirDemonstracao({ ...valido, nome: "Ana\r\nBcc: x@y.com" }, enviar);
    assert.doesNotMatch(enviar.mock.calls[0].arguments[0].subject, /[\r\n]/);
  });
});
