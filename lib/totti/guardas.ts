// As travas da fala do Totti, iguais no live coding e no quadro. Funções puras, aplicadas logo antes de a fala sair.
// O prompt (lib/totti/persona.ts) diz como ele fala; o modelo rápido escorrega mesmo assim, e aqui fica o que o
// código confere: cumprimento fora da abertura, validação, eco, reação vazia repetida, pergunta repetida e pergunta
// de condução vaga. `aplicarGuardas` encadeia todas e diz quais agiram, para o log de cada sala.
// O que é de uma sala só (ids do grafo no quadro, filtro de spoiler no live coding) continua na sala.
import { comMaiuscula, frasesDe, frasesSemPergunta, normalizar, sobreposicao, tokens, type Sala } from "./texto";
import { foiInterrompida, semMarcaDeInterrupcao } from "./interrupcao";

// ---------------------------------------------------------------------------------------------------------------
// Convite para seguir
// ---------------------------------------------------------------------------------------------------------------

const MATERIAL: Record<Sala, string> = { codigo: "o código", quadro: "o desenho" };

/**
 * Em que pé a entrevista está, para o convite. No fechamento (lib/totti/fechamento.ts), e depois de ele dizer que
 * terminou, ninguém manda o candidato seguir com o código ou com o desenho: ali não entra convite nenhum.
 */
export type MomentoDoConvite = "trabalho" | "fechamento";

/**
 * Os convites que devolvem a vez, os mesmos nas duas salas (só o material muda). Os três primeiros são os de
 * sempre; os outros existem para o convite não se repetir de uma fala para a outra (o mesmo "Continua daí." várias
 * vezes seguidas soa como gravação).
 */
export function convitesPara(sala: Sala): string[] {
  return [
    "Pode continuar de onde parou.",
    "Continua daí.",
    `Pode seguir com ${MATERIAL[sala]}.`,
    "Fica à vontade para seguir.",
    "Pode retomar de onde estava.",
    "Segue no seu ritmo.",
  ];
}

/**
 * O convite que o Totti ainda não usou nas falas recentes. Sem histórico, ou com todos já usados, vale a escolha
 * de sempre (pelo tamanho do texto); com histórico, anda a partir dela até achar um que não foi dito.
 */
export function escolherConvite(texto: string, jaDitas: string[], sala: Sala, momento: MomentoDoConvite = "trabalho"): string {
  if (momento === "fechamento") return "";
  const convites = convitesPara(sala);
  const ditas = jaDitas.map(normalizar);
  const inicio = texto.length % 3;
  for (let i = 0; i < convites.length; i++) {
    const convite = convites[(inicio + i) % convites.length];
    const marca = normalizar(convite);
    if (!ditas.some((d) => d.includes(marca))) return convite;
  }
  return convites[inicio];
}

/** A primeira das opções que o Totti ainda não disse (ou a menos recente, se já disse todas). */
export function falaNaoRepetida(opcoes: string[], jaDitas: string[]): string {
  const ditas = jaDitas.map((t) => t.trim());
  const nova = opcoes.find((o) => !ditas.includes(o));
  if (nova) return nova;
  return [...opcoes].sort((a, b) => ditas.lastIndexOf(a) - ditas.lastIndexOf(b))[0];
}

/** A frase devolve a vez: um próximo passo dirigido ao candidato (o mesmo critério do scripts/validar-conversa.ts). */
export const PROXIMO_PASSO = /^(pode|podemos|vamos|me (conta|conte|mostra|mostre|explica|explique|diz|diga|fala|fale)|mostra|mostre|explica|explique|conta|conte|segue|siga|continua|continue|desenha|desenhe|marca|marque|aponta|aponte|começa|comece|escolhe|escolha|traz|traga|fica à vontade|fique à vontade|quando quiser|é só)/i;

/** A fala já termina devolvendo a vez: numa pergunta ou num próximo passo (também depois de uma vírgula). */
export function devolveAVez(texto: string): boolean {
  const ultima = (frasesDe(texto.trim()).at(-1) ?? "").trim();
  const oracoes = [ultima, ultima.split(/,\s+/).at(-1) ?? ""];
  return ultima.endsWith("?") || oracoes.some((o) => PROXIMO_PASSO.test(o.replace(/^(e|então|agora|com isso|beleza|certo),?\s+/i, "")));
}

/**
 * Toda fala termina com a bola com ele. O modelo às vezes para no fato ("Isso, um bilhão por mês.") e o candidato
 * fica sem saber se é a vez dele: aí entra um convite curto no fim.
 */
export function comVezDevolvida(texto: string, jaDitas: string[], sala: Sala, momento: MomentoDoConvite = "trabalho"): string {
  const t = texto.trim();
  if (!t || devolveAVez(t)) return t;
  return [t, escolherConvite(t, jaDitas, sala, momento)].filter(Boolean).join(" ");
}

const ANTES_DO_CONVITE = "(?:(?:ent[ãa]o|agora|beleza|certo|t[áa]|e|a[íi]),?\\s+)?";
const CONVITES_DE_SEGUIR = [
  new RegExp(`^${ANTES_DO_CONVITE}(?:voc[êe]\\s+)?pode(?:mos)?\\s+(?:seguir|continuar|retomar|voltar|prosseguir|ir em frente|come[çc]ar)(?:\\s.*)?$`, "i"),
  new RegExp(`^${ANTES_DO_CONVITE}(?:segue|siga|continua|continue|retoma|retome|volta|volte)(?:\\s+(?:da[íi]|a[íi]|de onde\\s.*|com\\s.*|no seu ritmo|em frente|(?:para|pra|ao|pro)\\s.*))?$`, "i"),
  new RegExp(`^${ANTES_DO_CONVITE}(?:vai em frente|fi(?:ca|que) [àa] vontade (?:para|pra) (?:seguir|continuar|retomar|come[çc]ar)(?:\\s.*)?)$`, "i"),
];

/** A oração manda o candidato seguir com o trabalho ("pode seguir com o desenho", "continua daí"). */
function eConviteDeSeguir(oracao: string): boolean {
  const o = oracao.trim().replace(/[.!…]+$/, "");
  return CONVITES_DE_SEGUIR.some((c) => c.test(o));
}

/**
 * A fala sem o convite para seguir com o código ou com o desenho, que o modelo põe no fim por hábito. Serve para o
 * fechamento: quem ouviu "só preciso fechar uns pontos" não pode ouvir "pode seguir com o desenho" em seguida.
 * Pergunta nenhuma é tirada aqui.
 */
export function semConviteDeSeguir(texto: string): string {
  const frases = frasesDe(texto.trim()).flatMap((frase) => {
    const f = frase.trim();
    if (f.endsWith("?")) return [f];
    const oracoes = f.split(/,\s+/);
    const ficam = oracoes.filter((o) => !eConviteDeSeguir(o));
    if (ficam.length === oracoes.length) return [f];
    if (!ficam.length) return [];
    const junto = ficam.join(", ");
    return [/[.!?…]$/.test(junto) ? junto : `${junto}.`];
  });
  return frases.join(" ").trim();
}

/**
 * Depois de um "não sei" ou de um "pula", a fala não termina em pergunta: o modelo às vezes fecha com uma
 * pergunta de condução ("quer olhar outra parte?") e o candidato, que acabou de soltar o assunto, fica com outra
 * cobrança. Tira a frase com interrogação do fim e põe um convite curto.
 */
export function semPerguntaNoFim(texto: string, jaDitas: string[], sala: Sala, momento: MomentoDoConvite = "trabalho"): string {
  const t = texto.trim();
  if (!t.endsWith("?")) return t;
  const frases = frasesDe(t);
  while (frases.length && frases[frases.length - 1].endsWith("?")) frases.pop();
  return [...frases, escolherConvite(t, jaDitas, sala, momento)].filter(Boolean).join(" ");
}

/**
 * Como `semPerguntaNoFim`, mas sem colar um convite pronto quando ainda sobra fala: "Tranquilo, seguimos." já
 * devolve a vez. O convite fixo só entra se a fala era só a pergunta.
 */
export function semPerguntaNoFimSeSobrar(texto: string, sala: Sala, momento: MomentoDoConvite = "trabalho"): string {
  const t = texto.trim();
  if (!t.endsWith("?")) return t;
  const frases = frasesDe(t);
  while (frases.length && frases[frases.length - 1].endsWith("?")) frases.pop();
  if (frases.length) return frases.join(" ");
  const convites = convitesPara(sala);
  return momento === "fechamento" ? "" : convites[t.length % convites.length];
}

// ---------------------------------------------------------------------------------------------------------------
// Reação curta
// ---------------------------------------------------------------------------------------------------------------

/** Fala que é só uma reação, sem conteúdo ("Hm.", "Tá.", "Certo, beleza."). */
const SO_REACAO = /^(?:(?:h+m+|hum+|uhum|aham|ta|certo|ok|okay|beleza|entendi|saquei|anotado|sei|show|legal|blz)\s*)+$/;

export function eSoReacao(texto: string | undefined): boolean {
  const t = normalizar(texto ?? "");
  return t.length > 0 && SO_REACAO.test(t);
}

/** A palavra de reconhecimento que abre a fala ("Saquei. E o custo?" → "saquei"). */
const RECONHECIMENTO_NO_COMECO = /^(uhum|hum|hm+|saquei|entendi|entendido|certo|beleza|ok|t[áa]|legal|show|ah|ent[ãa]o)(?=[\s,.!]|$)[,.!]?\s*/i;

function reconhecimentoQueAbre(texto: string | undefined): string | undefined {
  return texto?.trim().match(RECONHECIMENTO_NO_COMECO)?.[1]?.toLowerCase();
}

/** Reações neutras para pôr no lugar de uma fala que era só validação ("Perfeito." → "Certo."). */
const REACOES_NEUTRAS = ["Certo.", "Tá.", "Entendi.", "Saquei."];

/** Uma reação curta e neutra que não repete a que abriu a última fala do Totti. */
export function reacaoNeutra(falasDoTotti: string[] = []): string {
  const ultima = reconhecimentoQueAbre(falasDoTotti.at(-1));
  return REACOES_NEUTRAS.find((r) => reconhecimentoQueAbre(r) !== ultima) ?? REACOES_NEUTRAS[0];
}

/** Reações ao pedido de tempo ("calma, deixa eu pensar"): curtas, sem convite. Só a primeira vez na entrevista. */
const REACOES_AO_PENSAR = ["Claro, fica à vontade.", "Claro, sem pressa."];

/** A reação ao pedido de tempo que o Totti ainda não disse. */
export function reacaoAoPensar(falasDoTotti: string[] = []): string {
  return falaNaoRepetida(REACOES_AO_PENSAR, falasDoTotti);
}

/**
 * Reação vazia repetida. "Hm." atrás de "Hm." vira bordão na voz: a segunda reação vazia seguida não sai (a vez já
 * é dele). E a fala não abre com o mesmo reconhecimento da fala anterior, nem com outro quando a sala acabou de
 * soltar um "uhum": era o "entendi, entendi, entendi".
 */
export function semReacaoRepetida(texto: string, falasDoTotti: string[] = [], reconheceu = false): string {
  const t = texto.trim();
  const anterior = falasDoTotti.at(-1);
  if (eSoReacao(t) && eSoReacao(anterior)) return "";
  const abre = reconhecimentoQueAbre(t);
  if (!abre || (!reconheceu && abre !== reconhecimentoQueAbre(anterior))) return t;
  let resto = t;
  for (let i = 0; i < 2 && RECONHECIMENTO_NO_COMECO.test(resto); i++) resto = resto.replace(RECONHECIMENTO_NO_COMECO, "");
  // Só a reação ("Saquei."): sem ela não sobra fala; fica como está.
  return resto.length < 3 ? t : comMaiuscula(resto);
}

// ---------------------------------------------------------------------------------------------------------------
// Cumprimento e reapresentação fora da abertura
// ---------------------------------------------------------------------------------------------------------------

/** "Oi", "Olá", "Bom dia" abrindo a fala. */
const SAUDACAO_NO_COMECO = /^\s*(?:oi+e?|ol[áa]|bom dia|boa tarde|boa noite)(?=[\s,.!?…]|$)[\s,.!?…]*/i;
/** A primeira oração da fala, até a primeira pontuação. */
const PRIMEIRA_ORACAO = /^\s*([^,.!?;:…—–]+)([,.!?;:…—–]+|$)\s*/;
/** "Tudo bem?", "Como vai?": cumprimento quando vem atrás de um "oi" ou em forma de pergunta. */
const COMO_VAI = /^(?:tudo (?:bem|bom|certo|joia|tranquilo)|como vai|como (?:voce|vc|ce) (?:esta|ta|vai)|beleza|tranquilo)(?: (?:com voce|contigo|por ai|ai|voce))?$/;
const REAPRESENTACAO = /\b(?:eu sou|sou|aqui e|aqui quem fala e|me chamo|meu nome e)(?: o)? totti\b/;
/** O candidato cumprimentou (ou perguntou quem fala): responder ao cumprimento é o natural. */
const CANDIDATO_CUMPRIMENTOU = /^(?:oi+e?|ola|opa|bom dia|boa tarde|boa noite|e ai|tudo (?:bem|bom|certo)|como vai)\b|\b(?:seu nome|quem e voce|como voce se chama|com quem (?:eu )?(?:falo|estou falando|to falando))\b/;

/**
 * Fora da abertura, a fala não começa cumprimentando nem se apresentando de novo ("Oi, tudo bem? Como você está
 * pensando em abordar esse problema?", com dois minutos de entrevista). O cumprimento sai e fica o resto; se só
 * havia o cumprimento, não sobra nada. "E aí, qual é a ideia?" e "Tudo bem, seguimos." não são cumprimento.
 */
export function semCumprimento(texto: string, falaDoCandidato = ""): string {
  if (CANDIDATO_CUMPRIMENTOU.test(normalizar(falaDoCandidato))) return texto.trim();
  let resto = texto.trim();
  let saudou = false;
  const saudacao = resto.match(SAUDACAO_NO_COMECO);
  if (saudacao) {
    resto = resto.slice(saudacao[0].length);
    saudou = true;
  }
  for (let i = 0; i < 3; i++) {
    const m = resto.match(PRIMEIRA_ORACAO);
    if (!m) break;
    const oracao = normalizar(m[1]);
    const pergunta = m[2].includes("?");
    const depois = normalizar(resto.slice(m[0].length).match(PRIMEIRA_ORACAO)?.[1] ?? "");
    // "E aí?" e "E aí, tudo bem?" cumprimentam; "E aí, qual é a ideia?" só puxa o assunto.
    const eAi = oracao === "e ai" && (pergunta || COMO_VAI.test(depois));
    const comoVai = COMO_VAI.test(oracao) && (saudou || pergunta);
    if (!eAi && !comoVai) break;
    resto = resto.slice(m[0].length);
    saudou = true;
  }
  const frases = frasesDe(resto);
  while (frases.length && REAPRESENTACAO.test(normalizar(frases[0]))) {
    frases.shift();
    saudou = true;
  }
  return saudou ? comMaiuscula(frases.join(" ")) : texto.trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------------------------------------------

const ELOGIAVEL = "pergunta|ideia|escolha|sacada|resposta|justificativa|abordagem|observacao|solucao|colocacao|decisao|ponto|raciocinio|trabalho|explicacao";
/**
 * Uma oração que só julga o que o candidato fez ou disse. De propósito ficam de fora as reações neutras ("certo",
 * "tá", "entendi", "legal") e o "isso" solto, que confirma um fato que ele perguntou.
 */
const VALIDACAO = new RegExp(
  "^(?:" + [
    "(?:e |eh )?isso (?:mesmo|ai)",
    "(?:muito |mto )?boa",
    "(?:muito |mto )(?:bom|bem)",
    `(?:muito |mto )?(?:boa|bom|otim[oa]|excelente|bel[oa]) (?:${ELOGIAVEL})\\b.*`,
    "bem (?:pensado|colocado|observado|lembrado|explicado)",
    "otim[oa]",
    "perfeit[oa]",
    "excelente",
    "maravilha",
    "sensacional",
    "faz (?:todo |muito |total |bastante )?(?:o )?sentido(?: sim| mesmo| isso)?",
    "(?:esta |ta )?(?:corret[oa]|certissim[oa]|corretissim[oa])",
    "exato",
    "exatamente",
    "mandou bem",
    "parabens",
    "gostei",
  ].join("|") + ")$",
);

/**
 * Tira as orações que só validam ("Boa.", "Faz sentido,", "Perfeito!"), em qualquer ponto da fala. O Totti não
 * julga: quem ouve "boa" numa resposta e silêncio na outra lê a entrevista pelas reações dele. O que faz parte de
 * uma pergunta fica ("Faz sentido para você usar uma fila aqui?", "Faz sentido?").
 */
export function semValidacao(texto: string): string {
  const mantidas: string[] = [];
  for (const frase of frasesDe(texto)) {
    const [, corpo, pontuacao] = frase.match(/^([\s\S]*?)([.!?…]*)$/) ?? [];
    const pergunta = pontuacao.includes("?");
    const oracoes = corpo.split(/,\s+|;\s+|\s+[—–]\s+/);
    const semJuizo = oracoes.filter((o) => !VALIDACAO.test(normalizar(o)));
    if (semJuizo.length === oracoes.length) mantidas.push(frase);
    // "Faz sentido?" e "Faz sentido, né?" perguntam; não é o Totti validando.
    else if (pergunta && normalizar(semJuizo.join(" ")).split(" ").filter(Boolean).length < 2) mantidas.push(frase);
    else if (semJuizo.length) mantidas.push(comMaiuscula(semJuizo.join(", ")) + pontuacao);
  }
  return mantidas.join(" ").trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Eco
// ---------------------------------------------------------------------------------------------------------------

/** Começos que só devolvem ao candidato o que ele acabou de dizer ("Entendi que…", "Então você…", "Ou seja…"). */
const ABERTURA_DE_ECO =
  /^(?:eu entendi\b|entendi (?:que|entao|voce|vc)\b|se (?:eu )?entendi\b|pelo que (?:eu )?entendi\b|pelo que voce (?:disse|falou)\b|(?:ok |certo |ta |beleza )?entao voce\b|voce (?:disse|falou|comentou|mencionou|explicou|colocou|quer|vai|pretende|esta|ta|escolheu|decidiu)\b|ou seja\b|resumindo\b)/;
/** Parte das palavras de conteúdo da frase que já estavam na fala do candidato para contar como eco. */
const LIMIAR_ECO = 0.7;
/** Frase que responde ("Sim, …", "Pode …", "São …"): usa as palavras da pergunta e não é eco. */
const RESPOSTA_DIRETA = /^(?:sim|nao|isso|pode|claro|sao|da|tem|fica|vai|depende|e)\b/;

/** O começo da palavra, para "terminou" e "terminei" contarem como a mesma. */
const radical = (t: string) => (t.length > 5 ? t.slice(0, 5) : t);

function eEco(frase: string, falaDoCandidato: string, candidatoPerguntou: boolean): boolean {
  if (eSoReacao(frase)) return false;
  if (ABERTURA_DE_ECO.test(normalizar(frase))) return true;
  // Resposta a uma pergunta dele fica de fora pelas palavras: confirmar usa as mesmas.
  if (candidatoPerguntou) return false;
  const daFrase = [...tokens(frase)].map(radical);
  const daFala = new Set([...tokens(falaDoCandidato)].map(radical));
  const comum = daFrase.filter((t) => daFala.has(t)).length;
  return daFrase.length >= 1 && comum / daFrase.length >= LIMIAR_ECO;
}

/**
 * Tira a primeira frase quando ela só repete o que o candidato acabou de dizer ("Contador com base 62.",
 * "Entendi que você vai usar Postgres."). Ele sabe o que disse: o eco soa robô e gasta o tempo dele. Se a fala
 * inteira era o eco ("Terminou.", depois de "acho que terminei"), ela não sai.
 */
export function semEcoNoComeco(texto: string, falaDoCandidato: string, candidatoPerguntou = false): string {
  const frases = frasesDe(texto);
  if (!frases.length || frases[0].endsWith("?")) return texto.trim();
  const perguntou = candidatoPerguntou || falaDoCandidato.trim().endsWith("?");
  if (!eEco(frases[0], falaDoCandidato, perguntou)) return texto.trim();
  if (frases.length >= 2) return frases.slice(1).join(" ").trim();
  return perguntou || RESPOSTA_DIRETA.test(normalizar(frases[0])) ? texto.trim() : "";
}

// ---------------------------------------------------------------------------------------------------------------
// Pergunta repetida e pergunta de condução vaga
// ---------------------------------------------------------------------------------------------------------------

/** A partir daqui a pergunta nova é a mesma de uma já feita. Mais baixo que LIMIAR_DUPLICADA: é a pergunta inteira, não a nota. */
export const LIMIAR_PERGUNTA_REPETIDA = 0.5;

/**
 * A fala termina numa pergunta que o Totti já fez (ou no assunto de uma): numa entrevista real ele perguntou como o
 * banco aguentava o volume, ouviu a resposta e perguntou como escalar a mesma ida ao banco. O candidato reclamou.
 */
export function perguntaJaFeita(fala: string, anteriores: string[]): boolean {
  const pergunta = frasesDe(fala.trim()).filter((f) => f.trim().endsWith("?")).at(-1);
  if (!pergunta) return false;
  return anteriores.some((a) => sobreposicao(pergunta, a) >= LIMIAR_PERGUNTA_REPETIDA || sobreposicao(fala, a) >= LIMIAR_PERGUNTA_REPETIDA);
}

/**
 * Pergunta que só devolve a condução ao candidato ("quer detalhar algo?", "o que mais você gostaria de adicionar?",
 * "quer seguir para outra parte?"). O prompt proíbe, e o modelo rápido faz mesmo assim: quem acabou de dizer que
 * terminou ouve isso e não sabe o que fazer. Estrutural: verbo de vontade + verbo de condução, sem assunto.
 */
const CONDUCAO = /\b(quer|queria|gostaria|prefere|deseja|o que mais|algo mais|mais alguma coisa|alguma outra|qual (parte|ponto)|outra parte)\b[^?]*\b(detalhar|adicionar|acrescentar|seguir|continuar|pontuar|aprofundar|revisar|mudar|ajustar|olhar|explorar|comentar|falar)\b[^?]*\?\s*$/i;

export function perguntaDeConducao(fala: string): boolean {
  const pergunta = frasesDe(fala.trim()).filter((f) => f.trim().endsWith("?")).at(-1);
  return !!pergunta && CONDUCAO.test(pergunta);
}

// ---------------------------------------------------------------------------------------------------------------
// Por quê
// ---------------------------------------------------------------------------------------------------------------

/** Perguntas de porquê para a escolha curta dele (`pedePorque`, lib/totti/turno.ts), quando a fala não pergunta nada. */
export const PERGUNTAS_DE_PORQUE = ["Por quê?", "Por que essa opção?", "E por que essa e não a outra?"];

/** A última pergunta da fala é de porquê ("Por que no backend?", "Por quê?"). */
export function ePerguntaDePorque(fala: string): boolean {
  const pergunta = frasesDe(fala.trim()).filter((f) => f.trim().endsWith("?")).at(-1);
  return !!pergunta && /\bpor que\b/.test(normalizar(pergunta));
}

/**
 * A pergunta de porquê que o Totti ainda não fez: a que não é a última pergunta de nenhuma das falas recentes. Só a
 * pergunta conta (a reação que vem antes não), porque o "Tá. Por quê?" de agora não pode voltar como "Por quê?".
 */
export function perguntaDePorque(falasDoTotti: string[]): string {
  const ultimasPerguntas = falasDoTotti.map((t) => frasesDe(t.trim()).filter((f) => f.endsWith("?")).at(-1) ?? "");
  return falaNaoRepetida(PERGUNTAS_DE_PORQUE, ultimasPerguntas);
}

// ---------------------------------------------------------------------------------------------------------------
// Português claro
// ---------------------------------------------------------------------------------------------------------------

/**
 * Termos em inglês que o Totti troca pelo português na fala (decisão H, #129). Só estes: o resto (Kafka, cache, API)
 * é o nome usual da área e fica como está.
 */
const TROCAS_DE_TERMO: Record<string, string> = {
  courier: "entregador", couriers: "entregadores", rider: "entregador", riders: "entregadores",
};

/**
 * A fala com os termos da tabela trocados pelo português ("courier" → "entregador"). Palavra inteira, sem diferença
 * de maiúscula, e a inicial maiúscula da palavra é mantida. Não troca um termo que a descrição da vaga usa
 * (`termosDaVaga`): ali o nome é o que a empresa escreveu. Sem a descrição, troca todos.
 */
export function emPortugues(texto: string, termosDaVaga = ""): string {
  const daVaga = new Set(normalizar(termosDaVaga).split(" "));
  return texto.replace(/[\p{L}\p{N}_]+/gu, (palavra) => {
    const minuscula = palavra.toLowerCase();
    const troca = TROCAS_DE_TERMO[minuscula];
    if (!troca || daVaga.has(minuscula)) return palavra;
    return palavra[0] !== palavra[0].toLowerCase() ? comMaiuscula(troca) : troca;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Todas juntas
// ---------------------------------------------------------------------------------------------------------------

/** O que a sala sabe sobre o momento da fala. Cada trava só age com o dado de que precisa. */
export type ContextoDaFala = {
  /** A última fala do candidato (a que o Totti está respondendo), se houver. */
  falaDoCandidato?: string;
  /** A fala dele tem uma pergunta para o Totti (a transcrição quase nunca põe o "?"). */
  candidatoPerguntou?: boolean;
  /** O que o Totti já disse, mais antigas primeiro. */
  falasDoTotti?: string[];
  /** Perguntas que ele já ouviu (do Totti na conversa, da análise). Sem a lista, a trava de repetição não age. */
  perguntasJaFeitas?: string[];
  /** A fala é a apresentação: aí cumprimentar e dizer o nome é o certo. */
  abertura?: boolean;
  /** A sala acabou de soltar um "uhum": a fala não abre com outro reconhecimento. */
  reconheceu?: boolean;
  /** false desliga a trava da pergunta de condução vaga (ligada por padrão). */
  barrarConducao?: boolean;
};

export type Trava = "cumprimento" | "validacao" | "eco" | "reacao_repetida" | "pergunta_repetida" | "pergunta_de_conducao" | "promessa_vazia";

/** Promessa de olhar sem comentário nem pergunta: não pode ser a fala inteira do Totti. */
export function promessaVazia(fala: string): boolean {
  const texto = normalizar(fala).replace(/[.!?,;:]+$/g, "").trim();
  if (!texto || texto.includes("?") || texto.split(/\s+/).length > 12) return false;
  return /\b(vou olhar|vou dar uma olhada|deixa eu (dar uma olhada|olhar|ver|analisar)|ja te falo|vou analisar|vou ver|deixa eu conferir|so um instante que eu olho o que voce fez)\b/.test(texto);
}

/** Detecta o pedido para olhar que precisa virar comentário e pergunta nesta fala. */
export function pediuParaOlhar(fala: string): boolean {
  return /\b(?:da uma olhada|d[aá] uma olhada|olha (?:a[ií]|isso)|pode olhar|olha o desenho|olha o c[oó]digo|comenta (?:a[ií]|isso)|o que acha do desenho|o que acha do c[oó]digo)(?:\s|[?.!,]|$)/i.test(fala);
}

/**
 * Passa a fala por todas as travas, na ordem, e devolve o que sobrou com o nome de cada trava que agiu. Texto
 * vazio quer dizer que a fala não sai (era só cumprimento, só eco, só a segunda reação vazia ou só a pergunta
 * barrada). A exceção é a fala que era só validação: no lugar do "Perfeito." entra uma reação neutra, porque ali
 * ele queria reagir e o silêncio diria outra coisa.
 */
export function aplicarGuardas(fala: string, contexto: ContextoDaFala = {}): { texto: string; travas: Trava[] } {
  const travas: Trava[] = [];
  const falasDoTotti = contexto.falasDoTotti ?? [];
  let texto = semMarcaDeInterrupcao(fala.trim());
  // Pergunta cortada pelo candidato não foi feita: retomá-la não é repetir.
  const perguntasJaFeitas = contexto.perguntasJaFeitas?.filter((p) => !foiInterrompida(p));
  const passo = (trava: Trava, depois: string) => {
    if (depois !== texto) travas.push(trava);
    texto = depois;
  };

  if (texto && !contexto.abertura) passo("cumprimento", semCumprimento(texto, contexto.falaDoCandidato));
  if (texto) {
    const semJuizo = semValidacao(texto);
    passo("validacao", semJuizo || reacaoNeutra(falasDoTotti));
  }
  if (texto && promessaVazia(texto)) passo("promessa_vazia", "");
  if (texto && contexto.falaDoCandidato) passo("eco", semEcoNoComeco(texto, contexto.falaDoCandidato, contexto.candidatoPerguntou));
  if (texto) {
    const repetida = texto.endsWith("?") && !!perguntasJaFeitas?.length && perguntaJaFeita(texto, perguntasJaFeitas);
    if (repetida) passo("pergunta_repetida", frasesSemPergunta(texto));
    else if (contexto.barrarConducao !== false && perguntaDeConducao(texto)) passo("pergunta_de_conducao", frasesSemPergunta(texto));
  }
  // Por último: o que sobrou depois das outras travas pode ser só a reação ("Hm. Quer detalhar algo?" → "Hm.").
  if (texto) passo("reacao_repetida", semReacaoRepetida(texto, falasDoTotti, contexto.reconheceu));
  return { texto, travas };
}
