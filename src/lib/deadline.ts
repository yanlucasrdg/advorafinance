export const DEADLINE_KIND_VALUES = [
  "audiencia",
  "prazo_processual",
  "reuniao",
  "tarefa",
  "primeiro_atendimento",
  "followup",
  "vencimento",
  "protocolo",
  "compromisso",
  "outro",
] as const;

export type DeadlineKind = (typeof DEADLINE_KIND_VALUES)[number];

export const DEADLINE_KIND_LABELS: Record<DeadlineKind, string> = {
  audiencia: "Audiência",
  prazo_processual: "Prazo processual",
  reuniao: "Reunião",
  tarefa: "Tarefa",
  primeiro_atendimento: "Primeiro atendimento",
  followup: "Acompanhamento",
  vencimento: "Vencimento",
  protocolo: "Protocolo",
  compromisso: "Compromisso",
  outro: "Outro",
};

export const DEADLINE_PRIORITY_VALUES = ["low", "medium", "high", "critical"] as const;
export type DeadlinePriority = (typeof DEADLINE_PRIORITY_VALUES)[number];

export const DEADLINE_PRIORITY_LABELS: Record<DeadlinePriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

export function deadlineErrorMessage(
  error: unknown,
  fallback = "Não foi possível atualizar o prazo.",
): string {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (/DEADLINE_VERSION_CONFLICT/i.test(message)) {
    return "Este prazo foi alterado por outra pessoa. Os dados foram atualizados.";
  }
  if (/DEADLINE_NOT_FOUND/i.test(message)) {
    return "Este prazo não está mais disponível.";
  }
  if (/DEADLINE_AUTH_REQUIRED|JWT|session/i.test(message)) {
    return "Sua sessão expirou. Entre novamente para continuar.";
  }
  if (/DEADLINE_(TITLE|KIND|PRIORITY|DATE|CASE|CLIENT|PATCH)_INVALID/i.test(message)) {
    return "Revise os dados do prazo e tente novamente.";
  }

  return fallback;
}

