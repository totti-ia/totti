import "../../tema-recrutador.css";

/** Relatório é tela da recrutadora: papel e tinta, igual a /vagas. */
export default function RelatorioLayout({ children }: { children: React.ReactNode }) {
  return <div className="tema-recrutador min-h-dvh">{children}</div>;
}
