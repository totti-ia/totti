import { render } from "@react-email/render";
import type { ReactElement } from "react";
import type { EmailSendResult } from "@/lib/email/types";

type SendArgs = {
  to: string;
  subject: string;
  template: ReactElement;
  fromDisplayName?: string;
  /** Nome do template, só pra log (sem PII). */
  templateName?: string;
  /** Sobrepõe o EMAIL_REPLY_TO (ex.: pedido de demonstração, onde "responder" vai para quem pediu). */
  replyTo?: string;
};

/** Subconjunto do cliente de envio usado aqui (permite injetar um fake nos testes). */
export type EmailClient = {
  emails: {
    send(payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
      replyTo?: string;
    }): Promise<{ data: { id: string } | null; error: unknown }>;
  };
};

/**
 * Texto puro: o html-to-text põe títulos em CAIXA ALTA por padrão, e grito em caixa alta pesa
 * contra nos filtros de spam. Mantém o título como foi escrito.
 */
const htmlToTextOptions = {
  selectors: ["h1", "h2", "h3"].map((selector) => ({ selector, options: { uppercase: false } })),
};

/** Falha real de envio/renderização; as rotas traduzem pra 502. */
export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/**
 * Cliente padrão: chama a API REST do Resend direto via fetch em vez do SDK
 * (`resend.emails.send`). O SDK manda `Content-Type: application/json` sem
 * `charset=utf-8`, e isso faz o backend deles corromper acentos e outros
 * caracteres multi-byte no corpo do email. Declarando o charset manualmente o
 * problema desaparece.
 */
export const resendFetchClient: EmailClient = {
  emails: {
    async send({ replyTo, ...payload }) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) return { data: null, error: new Error("RESEND_API_KEY não configurada") };

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ ...payload, ...(replyTo ? { reply_to: replyTo } : {}) }),
      });

      const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok || !json?.id) {
        return { data: null, error: new Error(json?.message ?? `Resend respondeu ${res.status}`) };
      }
      return { data: { id: json.id }, error: null };
    },
  },
};

/**
 * Manda o email. Só simula (sem enviar) quando RESEND_API_KEY não está
 * configurada E NODE_ENV !== "production". Qualquer outra falha vira
 * EmailDeliveryError. Logs trazem só metadados — nunca o HTML (PII).
 */
export async function sendEmail(
  { to, subject, template, templateName = "unknown", fromDisplayName, replyTo: replyToArg }: SendArgs,
  /** Seam de teste: cliente alternativo (padrão: Resend via fetch). */
  client: EmailClient = resendFetchClient,
): Promise<EmailSendResult> {
  const configuredFrom = process.env.EMAIL_FROM ?? "Time de Recrutamento <onboarding@resend.dev>";
  const address = configuredFrom.match(/<([^<>]+)>/)?.[1] ?? configuredFrom;
  // Entre aspas: a vírgula de "Ana, do time de recrutamento" é caractere especial no cabeçalho From (RFC 5322).
  const from = fromDisplayName ? `"${fromDisplayName.replace(/["\\]/g, "\\$&")}" <${address}>` : configuredFrom;
  const replyTo = replyToArg || process.env.EMAIL_REPLY_TO || undefined;
  const domain = to.split("@")[1] ?? "?";

  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production") {
    console.warn(`[email:simulated] template=${templateName} dominio=${domain} (RESEND_API_KEY ausente)`);
    return { status: "simulated", reason: "RESEND_API_KEY não configurada" };
  }

  try {
    const [html, text] = await Promise.all([render(template), render(template, { plainText: true, htmlToTextOptions })]);
    const { data, error } = await client.emails.send({ from, to, subject, html, text, replyTo });
    if (error) throw error;
    return { status: "sent", id: data!.id };
  } catch (err) {
    const reason = errorMessage(err);
    console.error(`[email:error] template=${templateName} dominio=${domain} erro=${reason}`);
    throw new EmailDeliveryError(reason);
  }
}
