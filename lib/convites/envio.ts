/** O envio de um convite da fila: salva o convite e manda o e-mail (só para quem recebe de verdade). Só servidor. */
import { sendTriagemConvite } from "@/lib/email";
import { criarConvite, salvarConvite } from "@/lib/convites/store";
import type { Enviador } from "@/lib/convites/fila";

export const enviarConviteDoLote: Enviador = async (lote, item) => {
  const convite = {
    ...criarConvite({
      vagaId: lote.vagaId,
      configId: lote.configId,
      cargo: lote.cargo,
      mode: lote.mode,
      durationMin: lote.durationMin,
      languages: lote.languages,
      candidato: { nome: item.nome, email: item.email },
      ...(item.testador ? { testador: true } : {}),
    }),
    // O token nasceu com o item: reenviar não muda o link.
    token: item.token,
  };

  // Guarda de segurança: nunca chamar o provedor de e-mail para endereços de demonstração.
  if (!item.real) {
    await salvarConvite({ ...convite, status: "simulado" });
    return {
      status: "simulado",
      motivo: item.testador ? "limite de e-mails de teste atingido; use o link" : "sem envio de e-mail (demonstração)",
    };
  }

  await salvarConvite(convite);
  const envio = await sendTriagemConvite({
    candidateName: item.nome,
    to: item.email,
    roleTitle: lote.cargo,
    mode: lote.mode,
    durationMin: lote.durationMin,
    languages: lote.languages,
    scheduleUrl: `${lote.base}/agendar/${item.token}`,
  });
  if (envio.status === "simulated") {
    await salvarConvite({ ...convite, status: "simulado" });
    return { status: "simulado", motivo: envio.reason };
  }
  return { status: "enviado" };
};
