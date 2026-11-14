// Senha do painel da recrutadora (opcional: só liga com PAINEL_SENHA). Ver lib/painel/acesso.ts.
//
// Protege só o lado da recrutadora: o painel de vagas, a pré-entrevista com o Totti, os relatórios e as rotas que
// os alimentam. O candidato (link do e-mail, agendar, entrevista, voz, eventos) fica de fora de propósito.
import { NextResponse, type NextRequest } from "next/server";
import {
  CABECALHO_AUTENTICADO,
  NOME_DO_COOKIE,
  VALIDADE_DO_COOKIE_S,
  valorDoCookie,
  validarAcesso,
} from "@/lib/painel/acesso";

export const config = {
  matcher: [
    "/vagas",
    "/vagas/:path*",
    "/pre-entrevista",
    "/pre-entrevista/:path*",
    "/relatorio/:path*",
    "/report",
    "/report/:path*",
    "/api/report",
    "/api/report/:path*",
    // Estado interno da sessão (notas do analista, fila de perguntas) e o contexto de uma pergunta: só o
    // painel e as telas de desenvolvimento. O candidato tem o próprio sessionId no navegador.
    "/api/state",
    "/api/blip/:id/context",
    "/api/decisao",
    "/api/pre-entrevista/:path*",
    "/api/config",
    "/api/configs/:path*",
    // Só a criação de convites (o painel); as rotas /api/convites/[token]/... são do candidato.
    "/api/convites",
    // Lote de convites em fila (progresso, falhas e reenvio): também só o painel.
    "/api/convites/lote/:path*",
  ],
};

export async function middleware(req: NextRequest) {
  // Quem não passa por aqui não pode forjar o cabeçalho: ele sempre sai da requisição antes de decidir.
  const cabecalhos = new Headers(req.headers);
  cabecalhos.delete(CABECALHO_AUTENTICADO);

  const senha = process.env.PAINEL_SENHA;
  const acesso = await validarAcesso(senha, {
    authorization: req.headers.get("authorization"),
    cookie: req.cookies.get(NOME_DO_COOKIE)?.value,
  });

  if (!acesso.liberado) {
    return new NextResponse("Acesso restrito ao painel.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Painel da recrutadora", charset="UTF-8"', "Cache-Control": "no-store" },
    });
  }

  // Sem PAINEL_SENHA o painel é aberto por design (demo): quem chega aqui está liberado, e o relatório confia no cabeçalho.
  cabecalhos.set(CABECALHO_AUTENTICADO, "1");
  const resposta = NextResponse.next({ request: { headers: cabecalhos } });
  if (senha && acesso.gravarCookie) {
    resposta.cookies.set(NOME_DO_COOKIE, await valorDoCookie(senha), {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: VALIDADE_DO_COOKIE_S,
    });
  }
  return resposta;
}
