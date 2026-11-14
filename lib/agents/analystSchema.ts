/** Saída estruturada do Analyst. O LLM responde só com JSON nesse formato. */
import { z } from "zod";

export const AnalystQuestion = z.object({
  question: z.string(),
  kind: z.enum(["explicar", "sondar", "desafio"]).optional(),
  /** Critério da config que a pergunta explora. */
  criterionId: z.string().optional(),
  /** Tema pra aprofundar se a resposta vier rasa — sempre o mesmo assunto da pergunta. */
  followUpTopic: z.string(),
  /** 2–5 palavras pro balão ("o loop interno", "sua escolha de abordagem"). */
  topicLabel: z.string(),
  priority: z.number().min(0).max(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});
export type AnalystQuestion = z.infer<typeof AnalystQuestion>;

/** Pergunta do foco da vaga (pressão, escala, uso de IA). Amarrada ao código quando dá: aí traz as linhas do trecho. */
export const FocusQuestion = z.object({
  question: z.string(),
  followUpTopic: z.string(),
  topicLabel: z.string(),
  startLine: z.number().int().min(1).nullable().optional(),
  endLine: z.number().int().min(1).nullable().optional(),
});
export type FocusQuestion = z.infer<typeof FocusQuestion>;

export const AnalystOutput = z.object({
  /** O que o candidato provavelmente está tentando fazer agora, em uma frase, sem citar erro. */
  candidateThinking: z.string().optional(),
  approach: z.string(),
  timeComplexity: z.string(),
  spaceComplexity: z.string(),
  progress: z.enum(["nao_comecou", "em_andamento", "funcional", "otimizado"]),
  /**
   * Um trecho coerente ficou pronto desde a última análise (uma função terminada, a primeira versão completa, uma
   * correção que fecha): só então a pergunta vira balão, passado o piso (#130, item 11). No meio de uma linha ou de um
   * bloco pela metade, false.
   */
  parteFechada: z.boolean().optional(),
  suspiciousLines: z
    .array(z.object({ startLine: z.number().int(), endLine: z.number().int(), reason: z.string() }))
    .max(5),
  /** Observações curtas pra rubrica, ligadas a um critério da config. */
  evidence: z
    .array(z.object({ criterionId: z.string(), note: z.string(), spontaneous: z.boolean().optional() }))
    .max(5),
  questions: z.array(AnalystQuestion).max(2),
  /** Só quando o prompt pede um FOCO PENDENTE. */
  focusQuestion: FocusQuestion.nullable().optional(),
});
export type AnalystOutput = z.infer<typeof AnalystOutput>;
