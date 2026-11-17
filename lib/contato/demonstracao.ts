// Pedido de demonstração vindo da landing: valida, e manda um e-mail para o time (CONTATO_EMAIL).
// O "responder" desse e-mail vai direto para quem pediu, então a conversa para marcar a reunião segue no e-mail.
import { createElement } from "react";
import { z } from "zod";
import { sendEmail } from "@/lib/email/send";
import { PedidoDeDemonstracaoEmail } from "@/lib/email/templates/PedidoDeDemonstracao";
import type { EmailSendResult } from "@/lib/email/types";
import { CONTATO_PADRAO } from "@/lib/contato/constantes";

export { CONTATO_PADRAO };

export const pedidoSchema = z.object({
  nome: z.string().trim().min(2, "Diga seu nome.").max(120),
  email: z.string().trim().email("E-mail inválido.").max(200),
  empresa: z.string().trim().max(120).optional().default(""),
  mensagem: z.string().trim().max(2000).optional().default(""),
  /** Armadilha para robô: campo escondido no formulário. Gente de verdade deixa vazio. */
  site: z.string().optional().default(""),
});

export type PedidoDeDemonstracao = z.infer<typeof pedidoSchema>;

export type ResultadoPedido =
  | { ok: true; envio: EmailSendResult["status"] | "ignorado" }
  | { ok: false; erro: "invalido"; campos: Record<string, string> };

type Enviar = typeof sendEmail;

export function destinoDoContato(): string {
  return process.env.CONTATO_EMAIL?.trim() || CONTATO_PADRAO;
}

/** Tira quebras de linha (o nome vai no assunto, e assunto com \n vira injeção de cabeçalho). */
const umaLinha = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export async function pedirDemonstracao(entrada: unknown, enviar: Enviar = sendEmail): Promise<ResultadoPedido> {
  const lido = pedidoSchema.safeParse(entrada);
  if (!lido.success) {
    const campos: Record<string, string> = {};
    for (const i of lido.error.issues) campos[String(i.path[0])] ??= i.message;
    return { ok: false, erro: "invalido", campos };
  }
  const p = lido.data;
  // Robô preencheu o campo escondido: responde ok (para não ensinar o robô) e não envia nada.
  if (p.site.trim()) return { ok: true, envio: "ignorado" };

  const nome = umaLinha(p.nome);
  const empresa = umaLinha(p.empresa);
  const r = await enviar({
    to: destinoDoContato(),
    subject: `Demonstração do Totti: ${nome}${empresa ? ` (${empresa})` : ""}`,
    template: createElement(PedidoDeDemonstracaoEmail, { ...p, nome, empresa }),
    templateName: "pedido-demonstracao",
    fromDisplayName: "Landing do Totti",
    replyTo: p.email,
  });
  return { ok: true, envio: r.status };
}
