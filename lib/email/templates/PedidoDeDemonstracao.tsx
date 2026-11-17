import { Heading, Text } from "@react-email/components";
import { EmailLayout, emailTypography } from "@/lib/email/templates/layout";
import type { PedidoDeDemonstracao } from "@/lib/contato/demonstracao";

/** E-mail interno (vai para o time): alguém pediu uma demonstração pela landing. Responder cai em quem pediu. */
export function PedidoDeDemonstracaoEmail(p: PedidoDeDemonstracao) {
  return (
    <EmailLayout simples signature="Landing do Totti">
      <Heading as="h2" style={emailTypography.heading}>
        Pedido de demonstração
      </Heading>
      <Text style={emailTypography.body}>
        <strong>{p.nome}</strong>
        {p.empresa ? ` (${p.empresa})` : ""} quer ver o Totti. Responda este e-mail para marcar a reunião.
      </Text>
      <Text style={emailTypography.label}>E-mail</Text>
      <Text style={emailTypography.body}>{p.email}</Text>
      {p.empresa && (
        <>
          <Text style={emailTypography.label}>Empresa</Text>
          <Text style={emailTypography.body}>{p.empresa}</Text>
        </>
      )}
      {p.mensagem && (
        <>
          <Text style={emailTypography.label}>Mensagem</Text>
          <Text style={{ ...emailTypography.body, whiteSpace: "pre-wrap" }}>{p.mensagem}</Text>
        </>
      )}
    </EmailLayout>
  );
}
