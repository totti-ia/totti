/** Rubrica do kit de system design (seção 7.2): 6 critérios, notas de 1 a 4. Só no servidor. */
import type { Criterio } from "./tipos";

export const RUBRICA_SYSTEM_DESIGN: Criterio[] = [
  {
    id: "requisitos",
    nome: "Requisitos e escopo",
    provocadoPor: "escopo",
    niveis: {
      1: "Começou a desenhar sem perguntar nada",
      2: "Perguntou pouco, esqueceu a escala",
      3: "Levantou funcionalidades e escala",
      4: "Levantou, priorizou e definiu o que fica fora",
    },
  },
  {
    id: "componentes_fluxo",
    nome: "Componentes e fluxo",
    niveis: {
      1: "Componentes soltos, fluxo confuso",
      2: "Fluxo principal existe, com lacunas",
      3: "Fluxo completo e coerente",
      4: "Completo, com responsabilidades bem separadas",
    },
  },
  {
    id: "escalabilidade",
    nome: "Escalabilidade",
    provocadoPor: "mudanca",
    niveis: {
      1: "Não considerou carga",
      2: "Citou escalar sem dizer como",
      3: "Cache, réplica e balanceamento onde faz sentido",
      4: "Identificou gargalos com números e atacou cada um",
    },
  },
  {
    id: "dados_consistencia",
    nome: "Dados e consistência",
    niveis: {
      1: "Escolheu o banco sem critério",
      2: "Escolha razoável sem justificar",
      3: "Justificou o modelo de dados e a consistência",
      4: "Discutiu particionamento, consistência e casos de falha",
    },
  },
  {
    id: "tradeoffs",
    nome: "Trade-offs",
    niveis: {
      1: "Não justifica escolhas",
      2: "Justifica quando perguntado, de forma vaga",
      3: "Justifica com prós e contras",
      4: "Compara alternativas espontaneamente",
    },
  },
  {
    id: "comunicacao",
    nome: "Comunicação",
    provaSoPorFala: true,
    niveis: {
      1: "Respostas confusas ou evasivas",
      2: "Responde em parte, sem justificar",
      3: "Responde com clareza e justifica",
      4: "Responde com precisão e antecipa o que o entrevistador vai perguntar",
    },
  },
];
