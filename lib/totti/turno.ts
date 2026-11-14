// A leitura do turno do Totti único: o que o candidato quis dizer e o que o Totti faz com isso, igual nas duas salas.
//
// O live coding e o quadro pedem ao modelo a mesma leitura (ele perguntou? respondeu? não sabe? terminou? quer
// encerrar?), mas cada um num formato de saída próprio. Aqui há um tipo só (`LeituraDoTurno`), um adaptador para
// cada sala (os schemas que os modelos preenchem não mudam) e as decisões que valem nas duas, em funções puras:
//   - pergunta clara do candidato nunca fica sem resposta;
//   - quem respondeu a uma pergunta do Totti não ouve só um "Tá.";
//   - depois de "não sei" ou "pula" não vem pergunta nova na mesma fala;
//   - "terminei" dito com as mãos paradas conta como conclusão mesmo que o modelo não tenha marcado.
// Este arquivo não importa nada de `lib/agente` nem de `lib/agents`: as salas é que importam daqui.
import { comVezDevolvida, eSoReacao, escolherConvite, falaNaoRepetida, semPerguntaNoFimSeSobrar } from "./guardas";
import { frasesDe, normalizar, type Sala } from "./texto";

export const INTENCOES = ["perguntou", "respondeu", "nao_sabe", "pulou", "concluiu", "encerrar", "pensando_alto", "conversa", "outro"] as const;
export type Intencao = (typeof INTENCOES)[number];

/** O que o modelo leu da fala do candidato e o que o Totti responde, sem nada que seja de uma sala só. */
export type LeituraDoTurno = {
  /** O Totti fala (true) ou continua ouvindo (false). */
  responder: boolean;
  /** A fala do Totti ("" quando ele fica quieto). */
  texto: string;
  /** O que o candidato quis com a fala dele. */
  intencao: Intencao;
  /** Ele avisou que terminou a etapa ou o trabalho. */
  concluiu: boolean;
  /** Ele pediu para encerrar a entrevista inteira. */
  encerrar: boolean;
  /** A fala do Totti termina em pergunta (a vez volta com uma cobrança, não com um convite). */
  perguntou: boolean;
  /** O gesto da sala (linhas grifadas ou marcas no desenho). O núcleo não lê: só carrega. */
  apontar?: unknown;
  /**
   * O modelo leu que o candidato fez uma pergunta (ou pediu esclarecimento) que espera resposta, mesmo sem "?". Só a
   * sala que pede isso (o quadro, no v2) o traz; ausente, o fechamento segue como antes. Diferente de `intencao`
   * "perguntou", que sai do regex `candidatoPerguntou` quando o modelo não marcou nada.
   */
  candidatoPerguntou?: boolean;
};

/** O mínimo que as duas salas sabem dizer sobre o momento da conversa. */
export type SituacaoDoTurno = {
  sala: Sala;
  /** A fala do candidato que o Totti está respondendo. */
  falaDoCandidato: string;
  /** Havia uma pergunta do Totti em aberto: a pergunta ativa, o balão, ou a última fala dele terminou em "?". */
  respondiaAoTotti: boolean;
  /** As falas recentes do Totti, da mais antiga para a mais nova (para variar o convite). */
  falasDoTotti?: string[];
  /** Quantas vezes ele já tinha dito que terminou, antes desta fala. Quem decide o que fazer com isso é o fechamento. */
  conclusoes?: number;
  /** Há quantos segundos ele não mexe no material (não digita, não desenha). Ausente: a sala não sabe. */
  paradoHaS?: number;
  /** Ele travou no trabalho e o Totti está ajudando: ali uma pergunta ("onde travou?", "quer uma dica?") é ajuda. */
  ajudando?: boolean;
  /**
   * (Quadro) A última fala do Totti já devolveu a vez e, desde então, o candidato não desenhou: só disse uma reação
   * ou pediu tempo. Ali não entra convite de novo (o "Pode seguir." repetido soa como gravação). Ausente: a regra
   * de sempre (live coding e quadro sem essa informação).
   */
  semAcaoDesdeOConvite?: boolean;
};

// ---------------------------------------------------------------------------------------------------------------
// O que a fala do candidato mostra, sem modelo
// ---------------------------------------------------------------------------------------------------------------

const PEDIDO_OU_DUVIDA =
  /\b(o que (que )?(tu|voc[êe]) (acha|achou|pensa|diz)|tu acha|voc[êe] acha|t[áa] certo|est[áa] certo|t[áa] bom assim|faz sentido|pode ser assim|posso (usar|fazer|come[çc]ar|seguir|pesquisar)|(voc[êe] |tu )?(pode|podia|poderia) me (explicar|ajudar|dizer|falar)|me explica|n[ãa]o entendi|qual (é|e) (a|o)|[ée] de (abertura|fechamento)|quanto tempo|vou ser (penalizado|prejudicado|avaliado)|como (vai|vou) ser avaliado|tenho que|preciso (usar|tratar|considerar)|qual (é|e) a|devo)\b/;
const CONFIRMACAO_NO_FIM = /\b(n[ée]|certo|beleza|ok)\s*$/;

/**
 * A fala do candidato tem algum sinal de pergunta para o Totti. A transcrição quase nunca põe o "?", e o modelo
 * rápido ignorava "o que que tu achou" no fim de uma explicação para fazer a própria pergunta. O sinal é largo
 * de propósito (pega também o "né" do fim da frase): serve para avisar o modelo e para não tratar a resposta
 * como eco. Para obrigar uma resposta, vale `perguntouComClareza`.
 */
export function candidatoPerguntou(fala: string): boolean {
  const texto = fala.toLowerCase();
  return texto.includes("?") || PEDIDO_OU_DUVIDA.test(texto) || CONFIRMACAO_NO_FIM.test(texto.trim());
}

/** A pergunta dirigida ao Totti, que dispensa o "?": pede opinião, explicação, permissão ou uma regra da entrevista. */
const PERGUNTA_DIRETA =
  /\b(o que (que )?(tu|voc[êe]) (acha|achou|pensa|diz)|(tu|voc[êe]) (acha|achou) (que|bom|ruim|melhor)|(voc[êe] |tu )?(pode|podia|poderia) me (explicar|ajudar|dizer|falar)|me explica|posso (usar|fazer|come[çc]ar|seguir|pesquisar)|quanto tempo (falta|dura|tem|eu tenho|a gente tem|ainda)|vou ser (penalizado|prejudicado|avaliado)|como (vai|vou) ser avaliado)\b|\b(t[áa]|est[áa]) (certo|bom)( assim| isso)?\s*[.!?]?\s*$/;
/** O "?" que só pede confirmação no fim de quem está narrando ("aí eu ponho o cache aqui, né?"). */
const SO_CONFIRMACAO = /\b(n[ée]|certo|beleza|ok|t[áa]|sabe|entende|entendeu|sacou)\s*\?\s*$/;

/**
 * Ele fez uma pergunta ao Totti, sem dúvida: uma pergunta direta ("o que tu acha", "posso usar um dicionário")
 * ou uma frase que termina em "?" e não é só o "né?" de quem pensa alto. Esta nunca fica sem resposta.
 */
export function perguntouComClareza(fala: string): boolean {
  const texto = fala.toLowerCase().trim();
  if (PERGUNTA_DIRETA.test(texto)) return true;
  return texto.endsWith("?") && !SO_CONFIRMACAO.test(texto);
}

/** A escolha curta que pede o porquê: até três palavras. */
const MAX_PALAVRAS_DA_ESCOLHA = 3;
/** "Não sei" e "pula" não pedem porquê: o desfecho da pergunta já trata. */
const NAO_SABE_OU_PULA = /\b(nao sei|n sei|nao faco ideia|nao pensei|pula|pular|pulo|passa|passo)\b/;
/** Pediu tempo: não é escolha. */
const PEDIU_TEMPO = /\b(pensando|pensar|calma)\b/;
/**
 * Já traz a justificativa: não falta o porquê. "pra/para" só conta seguido de verbo no infinitivo ("pra escalar",
 * "para não travar"); como preposição ("pra fila", "para o back") não é justificativa.
 */
const JUSTIFICA = /\b(porque|pq|pois|ja que|(pra|para) (nao )?[a-z]+(ar|er|ir))\b/;

/**
 * A pergunta do Totti oferece alternativas ("No back ou no front?") e a resposta dele é só a escolha, de até três
 * palavras, sem justificativa: o porquê é o que falta ouvir. Pergunta sem alternativas não pede porquê, e uma
 * resposta vazia também não.
 */
export function pedePorque(perguntaDoTotti: string | undefined, respostaDoCandidato: string): boolean {
  const pergunta = (perguntaDoTotti ?? "").trim();
  if (!pergunta.endsWith("?")) return false;
  const ultima = frasesDe(pergunta).at(-1) ?? pergunta;
  if (!/\sou\s/.test(normalizar(ultima))) return false;
  const resposta = normalizar(respostaDoCandidato);
  const palavras = resposta ? resposta.split(" ").length : 0;
  if (palavras < 1 || palavras > MAX_PALAVRAS_DA_ESCOLHA) return false;
  return !NAO_SABE_OU_PULA.test(resposta) && !PEDIU_TEMPO.test(resposta) && !JUSTIFICA.test(resposta);
}

/** "Terminei", "acabei": só pode ser o trabalho. */
const CONCLUSAO_FORTE = /\b(terminei|acabei|finalizei|conclu[ií])\b/i;
/** "Pronto", "é isso": fecham o trabalho ou só a resposta a uma pergunta, depende do momento. */
const CONCLUSAO_FRACA =
  /\b(pronto|prontinho|n[ãa]o tenho mais nada)\b|(^|[\s,])(é|era) (s[óo] )?isso( a[íi]| mesmo)?( que eu (faria|tenho|tinha|queria( fazer| mostrar)?))?\s*[.!,]?\s*$/i;
/** "Pronto" e "é isso" só contam numa frase curta: numa frase longa são parte de outra coisa ("o cache já vem pronto do…"). */
const MAX_PALAVRAS_DA_CONCLUSAO_FRACA = 8;
/** O que desfaz a conclusão quando vem logo antes dela: "ainda não terminei", "quando eu acabar", "quase pronto". */
const NEGADA = /\b(n[ãa]o|nem|ainda|quase|quando|se|at[ée]|antes de|depois (de|que)|assim que|falta|deixa eu)\s+((eu|a gente|j[áa]|que|tinha|estou|est[áa]|t[ôo]|t[áa]|fica|ficar)\s+)*$/i;
/** O que mostra que ele segue trabalhando, quando vem depois dela: "terminei o cache, agora vou para a fila". */
const CONTINUA = /\b(agora|falta|faltou|faltando|mas|s[óo] que|depois|em seguida|pr[óo]xim[oa]|a[íi] (eu|vou|a gente)|vou (fazer|colocar|adicionar|desenhar|escrever|criar|montar|implementar|tratar|partir|passar))\b/i;
/** Menos que isto com as mãos paradas não diz nada: ele pode ter só tirado a mão para falar. */
export const PARADO_PARA_CONCLUIR_S = 3;

function concluiNaUltimaFrase(fala: string, padrao: RegExp, maxPalavras = Number.POSITIVE_INFINITY): boolean {
  const ultima = fala.trim().split(/(?<=[.!?;])\s+/).at(-1) ?? "";
  const achado = padrao.exec(ultima);
  if (!achado || ultima.split(/\s+/).length > maxPalavras) return false;
  const antes = ultima.slice(0, achado.index);
  const depois = ultima.slice(achado.index + achado[0].length);
  return !NEGADA.test(antes) && !CONTINUA.test(depois);
}

/**
 * A fala parece avisar que ele terminou ("terminei", "acho que é isso", "pronto"), na última frase e sem um
 * "ainda não" antes nem um "agora vou…" depois. É rede, não leitura: quem lê a intenção é o modelo, e este sinal
 * só vale junto com as mãos paradas (`sinalDeConclusao`). "Pronto" e "é isso" não contam quando ele respondia a
 * uma pergunta do Totti, porque ali fecham a resposta, não o trabalho.
 */
export function pareceConclusao(fala: string, respondiaAoTotti = false): boolean {
  if (concluiNaUltimaFrase(fala, CONCLUSAO_FORTE)) return true;
  return !respondiaAoTotti && concluiNaUltimaFrase(fala, CONCLUSAO_FRACA, MAX_PALAVRAS_DA_CONCLUSAO_FRACA);
}

/** O modelo não marcou a conclusão, mas ele disse que terminou e parou de mexer no material há alguns segundos. */
export function sinalDeConclusao(situacao: SituacaoDoTurno): boolean {
  return situacao.paradoHaS !== undefined && situacao.paradoHaS >= PARADO_PARA_CONCLUIR_S
    && pareceConclusao(situacao.falaDoCandidato, situacao.respondiaAoTotti);
}

// ---------------------------------------------------------------------------------------------------------------
// Adaptadores: a saída de cada sala vira a leitura comum, e a leitura decidida volta para a saída da sala
// ---------------------------------------------------------------------------------------------------------------

/** Os campos da saída do live coding (`InterviewerOutput`) que a leitura usa. O resto passa sem ser lido. */
export type SaidaDoLiveCoding = {
  respond?: boolean;
  reply: string;
  concluded?: boolean;
  finish?: boolean;
  gaveHint?: boolean;
  highlight?: unknown;
  probeOutcome?: { kind: string } | null;
  /** Ele pediu tempo para pensar (#130, item 7): não é resposta nem "não sei". */
  pediuTempo?: boolean;
  /** O modelo leu que ele perguntou (ver `LeituraDoTurno.candidatoPerguntou`; #130, item 8). */
  candidatoPerguntou?: boolean;
};

/** Os campos da saída do quadro (`SaidaPerguntar`) que a leitura usa. O resto passa sem ser lido. */
export type SaidaDoQuadro = {
  responder: boolean;
  texto: string;
  concluiu?: boolean;
  encerrar?: boolean;
  /** "pensando": ele pediu tempo para pensar (não é resposta; lib/agente/perguntar.ts trata). */
  desfecho?: "respondeu" | "nao_sabe" | "pulou" | "pensando" | null;
  visual?: unknown;
  /** O modelo leu que ele perguntou (ver `LeituraDoTurno.candidatoPerguntou`). */
  candidatoPerguntou?: boolean;
};

/** O que sobra para a intenção depois do que o modelo marcou: o que a fala e o momento mostram. */
function intencaoSemMarca(responder: boolean, situacao: SituacaoDoTurno): Intencao {
  if (candidatoPerguntou(situacao.falaDoCandidato)) return "perguntou";
  if (situacao.respondiaAoTotti) return "respondeu";
  return responder ? "conversa" : "pensando_alto";
}

function leitura(base: Omit<LeituraDoTurno, "perguntou">): LeituraDoTurno {
  const texto = base.texto.trim();
  return { ...base, texto, perguntou: base.responder && texto.endsWith("?") };
}

export function deSaidaDoLiveCoding(saida: SaidaDoLiveCoding, situacao: SituacaoDoTurno): LeituraDoTurno {
  const responder = saida.respond !== false && saida.reply.trim() !== "";
  // No live coding o "não soube" e o "preferiu voltar a codar" vêm no resultado da sondagem. Quando a fala oferece
  // ou entrega a dica, o assunto ainda está aberto: não é o "não sei" que encerra.
  const comDica = saida.gaveHint === true || /\bdica\b/i.test(saida.reply);
  const sondagem = situacao.respondiaAoTotti && !comDica ? saida.probeOutcome?.kind : undefined;
  const intencao: Intencao =
    saida.finish === true ? "encerrar"
    : saida.concluded === true ? "concluiu"
    : saida.pediuTempo === true ? "pensando_alto"
    : sondagem === "nao_conseguiu" ? "nao_sabe"
    : sondagem === "recusou" ? "pulou"
    : intencaoSemMarca(responder, situacao);
  return leitura({
    responder, texto: saida.reply, intencao, concluiu: saida.concluded === true, encerrar: saida.finish === true, apontar: saida.highlight,
    ...(saida.candidatoPerguntou !== undefined ? { candidatoPerguntou: saida.candidatoPerguntou } : {}),
  });
}

export function deSaidaDoQuadro(saida: SaidaDoQuadro, situacao: SituacaoDoTurno): LeituraDoTurno {
  const responder = saida.responder && saida.texto.trim() !== "";
  // O desfecho só vale quando havia pergunta do Totti em aberto: sem ela, não há assunto para encerrar.
  const desfecho = situacao.respondiaAoTotti ? saida.desfecho : undefined;
  const intencao: Intencao =
    saida.encerrar === true ? "encerrar"
    : saida.concluiu === true ? "concluiu"
    : saida.desfecho === "pensando" ? "pensando_alto"
    : desfecho === "nao_sabe" ? "nao_sabe"
    : desfecho === "pulou" ? "pulou"
    : desfecho === "respondeu" ? "respondeu"
    : intencaoSemMarca(responder, situacao);
  return leitura({
    responder, texto: saida.texto, intencao, concluiu: saida.concluiu === true, encerrar: saida.encerrar === true, apontar: saida.visual,
    ...(saida.candidatoPerguntou !== undefined ? { candidatoPerguntou: saida.candidatoPerguntou } : {}),
  });
}

/** A leitura decidida de volta na saída do live coding: só os campos comuns mudam. */
export function paraSaidaDoLiveCoding<S extends SaidaDoLiveCoding>(lida: LeituraDoTurno, original: S): S {
  return { ...original, respond: lida.responder, reply: lida.responder ? lida.texto : "", concluded: lida.concluiu, finish: lida.encerrar };
}

/** A leitura decidida de volta na saída do quadro: só os campos comuns mudam. */
export function paraSaidaDoQuadro<S extends SaidaDoQuadro>(lida: LeituraDoTurno, original: S): S {
  return { ...original, responder: lida.responder, texto: lida.responder ? lida.texto : "", concluiu: lida.concluiu, encerrar: lida.encerrar };
}

// ---------------------------------------------------------------------------------------------------------------
// Decisões comuns
// ---------------------------------------------------------------------------------------------------------------

export type RegraDoTurno = "sinal_de_conclusao" | "sem_pergunta_nova" | "vez_devolvida" | "pergunta_sem_resposta";

/**
 * No quadro a vez só volta pela voz: uma resposta que para num fato ("Isso, um bilhão por mês.") deixa os dois
 * esperando, então ali o convite entra sempre que a fala não devolve a vez. Na IDE o balão fecha e o grifo some
 * quando o assunto acaba, e o "Pode seguir." em toda fala cansava: lá o convite entra só quando a fala é uma
 * reação solta ("Tá.").
 */
const CONVITE_EM_TODA_RESPOSTA: Record<Sala, boolean> = { quadro: true, codigo: false };

/**
 * Ele fez uma pergunta clara e a leitura ficou quieta. A sala gera de novo, uma vez, com
 * `avisoDePerguntaSemResposta`; se ainda assim não vier fala, `comRespostaDeReserva` garante uma.
 */
export function ficouSemResposta(lida: LeituraDoTurno, situacao: SituacaoDoTurno): boolean {
  const calado = !lida.responder || lida.texto.trim() === "";
  // A pergunta que o modelo leu (`candidatoPerguntou`, sem "?") conta como clara, e não cai no "pediu para encerrar":
  // a pergunta vem antes do encerramento (lib/agente/perguntar.ts).
  const marcada = lida.candidatoPerguntou === true;
  return (!lida.encerrar || marcada) && calado && (marcada || perguntouComClareza(situacao.falaDoCandidato));
}

/** O recado para a segunda geração. `campo` é o nome do campo de responder no schema da sala. */
export function avisoDePerguntaSemResposta(campo: string): string {
  return `ATENÇÃO: ele te fez uma pergunta e você não respondeu. ${campo} = true: responda a ela agora.`;
}

/** Ditas quando ele perguntou com clareza e nenhuma geração trouxe resposta: melhor pedir de novo que ignorar. */
export const PEDIDOS_DE_REPETIR_A_PERGUNTA = ["Não peguei a sua pergunta. Pode repetir?", "Desculpa, perdi a sua pergunta. Pode falar de novo?"];

/** Depois da segunda geração: pergunta clara nunca fica sem resposta. */
export function comRespostaDeReserva(lida: LeituraDoTurno, situacao: SituacaoDoTurno): { leitura: LeituraDoTurno; regras: RegraDoTurno[] } {
  if (!ficouSemResposta(lida, situacao)) return { leitura: lida, regras: [] };
  const texto = falaNaoRepetida(PEDIDOS_DE_REPETIR_A_PERGUNTA, situacao.falasDoTotti ?? []);
  return { leitura: { ...lida, responder: true, texto, perguntou: true }, regras: ["pergunta_sem_resposta"] };
}

/**
 * As decisões que valem nas duas salas, sobre a leitura que o modelo devolveu (já com as travas da fala
 * aplicadas). Devolve a leitura decidida e o nome de cada regra que agiu, para o log da sala.
 */
export function decidirTurno(lida: LeituraDoTurno, situacao: SituacaoDoTurno): { leitura: LeituraDoTurno; regras: RegraDoTurno[] } {
  const regras: RegraDoTurno[] = [];
  let atual = lida;
  // Pedido para encerrar: quem fecha é a sala, com o fechamento. Nada mais a decidir aqui.
  if (atual.encerrar) return { leitura: atual, regras };

  if (!atual.concluiu && sinalDeConclusao(situacao)) {
    atual = { ...atual, concluiu: true, intencao: "concluiu" };
    regras.push("sinal_de_conclusao");
  }
  if (!atual.responder) return { leitura: atual, regras };

  const jaDitas = situacao.falasDoTotti ?? [];
  let texto = atual.texto;
  // "Não sei" ou "pula": ele soltou o assunto. Outra pergunta na mesma fala seria outra cobrança.
  const soltou = atual.intencao === "nao_sabe" || atual.intencao === "pulou";
  if (soltou && !situacao.ajudando) {
    const semPergunta = semPerguntaNoFimSeSobrar(texto, situacao.sala);
    if (semPergunta !== texto) regras.push("sem_pergunta_nova");
    texto = semPergunta;
  }
  // Ele acabou de responder a uma pergunta do Totti (ou de soltar o assunto): a réplica não para num "Tá." solto,
  // senão ele fica sem saber o que fazer.
  if (situacao.respondiaAoTotti || soltou) {
    const comVez = situacao.semAcaoDesdeOConvite ? texto
      : eSoReacao(texto) ? `${texto} ${escolherConvite(texto, jaDitas, situacao.sala)}`
      : CONVITE_EM_TODA_RESPOSTA[situacao.sala] ? comVezDevolvida(texto, jaDitas, situacao.sala)
      : texto;
    if (comVez !== texto) regras.push("vez_devolvida");
    texto = comVez;
  }
  return { leitura: { ...atual, texto, perguntou: texto.endsWith("?") }, regras };
}

/** Ele avisou que terminou e o Totti não tem o que dizer ainda: avisa que vai olhar, e a pergunta vem da análise. */
export function avisosDeQueVaiOlhar(sala: Sala): string[] {
  return [`Tá, deixa eu dar uma olhada ${sala === "codigo" ? "no código" : "no desenho"}.`, "Certo, só um instante que eu olho o que você fez."];
}
