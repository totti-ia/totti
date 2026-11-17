import { permanentRedirect } from "next/navigation";

/** A antiga tela de boas-vindas virou a landing na raiz; links antigos continuam funcionando. */
export default function Page() {
  permanentRedirect("/");
}
