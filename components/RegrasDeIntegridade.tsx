import type { InterviewConfig } from "@/lib/contracts";

export default function RegrasDeIntegridade({ regraDeIa }: Pick<InterviewConfig, "regraDeIa">) {
  return (
    <p className="text-sm leading-relaxed text-texto-suave">
      Pode consultar documentação de sintaxe. {regraDeIa === "permitida"
        ? "Pode usar IA como ferramenta, explicando o que usou e as decisões que tomou."
        : "Resolva o desafio sem assistência de IA."} Registramos colagens, saídas da janela, o código, o desenho e a fala.
      Não gravamos câmera, tela nem teclas. Esses registros são evidências para revisão humana e não alteram a nota.
    </p>
  );
}
