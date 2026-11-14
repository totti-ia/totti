/** Saída estruturada do Interviewer: uma fala por turno. */
import { z } from "zod";

export const ProbeKindSchema = z.enum([
  "espontaneo",
  "respondeu_bem",
  "parcial",
  "errou",
  "nao_conseguiu",
  "com_dica",
  "recusou",
]);

// Campos de controle com padrão: o modelo de conversa (rápido, sem raciocínio) às vezes os omite, e um campo
// esquecido não pode custar um reparo de JSON.
export const InterviewerOutput = z.object({
  /**
   * false quando a fala do candidato não pede resposta (ele está pensando em voz alta, ainda explicando,
   * ou só confirmou): o entrevistador continua ouvindo e reply fica "". Ausente vale true.
   */
  respond: z.boolean().optional(),
  /** O candidato avisou que concluiu uma etapa do trabalho e quer avançar (pela intenção, não por palavra fixa). */
  concluded: z.boolean().optional(),
  /**
   * O candidato quer encerrar a ENTREVISTA inteira ("terminei", "quero sair", "pode encerrar"), não só uma parte: o
   * fechamento passa pelos critérios que faltam (até 2 perguntas) e se despede (#130, item 9).
   */
  finish: z.boolean().optional(),
  /** Com finish: ele precisa sair agora ("tenho que ir já"). O fechamento vai direto à despedida, sem perguntas. */
  urgent: z.boolean().optional(),
  /** Ele pediu tempo para pensar ("calma, tô pensando", "deixa eu pensar"): não é resposta nem pergunta (#130, item 7). */
  pediuTempo: z.boolean().optional(),
  /**
   * Ele fez uma pergunta ou pediu esclarecimento que espera resposta, mesmo sem "?" ("não entendi o que é um par"). No
   * fechamento, a pergunta é respondida antes de qualquer despedida (#130, item 8).
   */
  candidatoPerguntou: z.boolean().optional(),
  /** A fala, como um entrevistador humano falaria: 1–2 frases curtas. */
  reply: z.string().default(""),
  /** Linhas pra grifar junto com a fala, ou null quando não fala de um trecho. */
  highlight: z.object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1) }).nullable().default(null),
  /** true quando a conversa terminou (assunto respondido, ou o candidato quer voltar a codar). */
  end: z.boolean().default(false),
  /** true se esta fala entregou a dica leve disponível. */
  gaveHint: z.boolean().default(false),
  /** Observação curta pra rubrica sobre a última resposta do candidato, ou null. */
  evidence: z.object({ criterionId: z.string(), note: z.string() }).nullable().default(null),
  /** Num desafio: o candidato topou tentar agora. `summary` diz o que ele vai tentar ("melhorar a complexidade de tempo"). */
  challenge: z.object({ accepted: z.boolean(), summary: z.string() }).nullable().optional(),
  /** Como ele se saiu no critério sondado. Preencher ao fechar (ou quando a resposta já mostrar). */
  probeOutcome: z.object({ criterionId: z.string(), kind: ProbeKindSchema, note: z.string() }).nullable().optional(),
});
export type InterviewerOutput = z.infer<typeof InterviewerOutput>;
