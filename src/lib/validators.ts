/**
 * validators.ts — Schemas Zod centralizados para todas as entidades do CRM Jurídico
 *
 * REGRAS:
 * - Todo campo opcional deve ter .nullable() ou .optional() explícito.
 * - Nunca usar `as any` em mutations — use .parse() ou .safeParse() desses schemas.
 * - Campos sensíveis (CPF, CNPJ, e-mail, telefone) têm sanitização embutida.
 */

import { z } from "zod";
import { DEADLINE_KIND_VALUES, DEADLINE_PRIORITY_VALUES } from "@/lib/deadline";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";

// ─────────────────────────────────────────────
// Primitivos reutilizáveis
// ─────────────────────────────────────────────

/** CPF (11 dígitos) ou CNPJ (14 dígitos) — aceita formatado ou limpo */
export const docSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ""))
  .pipe(
    z.string().refine(
      (v) => v === "" || v.length === 11 || v.length === 14,
      { message: "Documento deve ser CPF (11 dígitos) ou CNPJ (14 dígitos)" },
    ),
  )
  .optional()
  .nullable();

/** Telefone do WhatsApp: salva E.164 com `+`; números nacionais usam Brasil como padrão. */
export const phoneSchema = z
  .string()
  .transform((value, context) => {
    if (!value.trim()) return "";
    try {
      return `+${normalizeWhatsAppPhone(value)}`;
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Telefone inválido.",
      });
      return z.NEVER;
    }
  })
  .optional()
  .nullable();

/** E-mail opcional mas válido quando informado */
export const emailSchema = z
  .string()
  .email({ message: "E-mail inválido" })
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null));

/** UUID v4 */
export const uuidSchema = z.string().uuid({ message: "ID inválido" });

/** Valor em centavos (inteiro, ≥ 0) */
export const centsSchema = z
  .number({ invalid_type_error: "Valor deve ser numérico" })
  .int()
  .nonnegative({ message: "Valor não pode ser negativo" })
  .optional()
  .nullable();

/** Data ISO 8601 */
export const isoDateSchema = z
  .string()
  .datetime({ message: "Data inválida (use ISO 8601)" })
  .optional()
  .nullable();

// ─────────────────────────────────────────────
// Clientes
// ─────────────────────────────────────────────

/**
 * O banco usa PF/PJ como representação canônica.
 * Entradas legadas em minúsculas continuam aceitas na borda da aplicação.
 */
export const clientTypeSchema = z
  .string({ required_error: "Tipo de cliente é obrigatório" })
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(
    z.enum(["PF", "PJ"], {
      errorMap: () => ({ message: "Tipo deve ser 'PF' ou 'PJ'" }),
    }),
  );

export const clientStatusSchema = z.enum(
  [
    "novo_contato",
    "triagem",
    "consulta_agendada",
    "proposta",
    "contrato",
    "em_andamento",
    "encerrado",
  ],
  { errorMap: () => ({ message: "Status de cliente inválido" }) },
);

const clientValueCentsSchema = z
  .number({ invalid_type_error: "Honorário estimado deve ser numérico" })
  .int("Honorário estimado deve ser informado em centavos")
  .nonnegative("Honorário estimado não pode ser negativo")
  .optional()
  .default(0);

const clientStateSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/, "Estado deve conter a sigla com 2 letras"))
  .optional()
  .nullable();

export const clientCreateSchema = z
  .object({
    name: z.string().trim().min(2, "Nome deve ter ao menos 2 caracteres").max(200),
    type: clientTypeSchema,
    status: clientStatusSchema.default("novo_contato"),
    email: emailSchema,
    phone: phoneSchema,
    doc: docSchema,
    area: z.string().trim().max(100).optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
    owner: z.string().trim().max(200).optional().nullable(),
    value_cents: clientValueCentsSchema,
    address: z.string().trim().max(300).optional().nullable(),
    city: z.string().trim().max(100).optional().nullable(),
    state: clientStateSchema,
    is_hot: z.boolean().optional().default(false),
  })
  .strict();

/**
 * Mudanças de etapa não passam pelo update genérico. Elas usam
 * move_client_stage(), que aplica lock otimista e auditoria na mesma transação.
 */
export const clientUpdateSchema = clientCreateSchema.omit({ status: true }).partial().strict();

export type ClientCreate = z.output<typeof clientCreateSchema>;
export type ClientUpdate = z.output<typeof clientUpdateSchema>;

// ─────────────────────────────────────────────
// Processos (Cases)
// ─────────────────────────────────────────────

export const caseStatusSchema = z.enum([
  "ativo",
  "suspenso",
  "recurso",
  "arquivado",
  "ganho",
  "perdido",
  // Valores legados mantidos durante a normalização gradual dos dados.
  "novo",
  "em_andamento",
  "aguardando_cliente",
  "aguardando_tribunal",
  "encerrado_ganho",
  "encerrado_perdido",
], { errorMap: () => ({ message: "Status de processo inválido" }) });

export const caseAreaSchema = z.enum([
  "civel",
  "civil",
  "trabalhista",
  "tributario",
  "familia",
  "criminal",
  "previdenciario",
  "empresarial",
  "administrativo",
  "consumidor",
  "outro",
], { errorMap: () => ({ message: "Área jurídica inválida" }) }).optional().nullable();

const casePartySchema = z.object({
  name: z.string().trim().min(1, "Nome da parte é obrigatório").max(200),
  role: z.string().trim().max(100).optional().nullable(),
});

export const caseCreateSchema = z.object({
  title:        z.string().trim().min(3, "Título deve ter ao menos 3 caracteres").max(300),
  number:       z.string().max(50).optional().nullable(),
  area:         caseAreaSchema,
  status:       caseStatusSchema.default("ativo"),
  client_id:    uuidSchema.optional().nullable(),
  responsible:  z.string().max(200).optional().nullable(),
  description:  z.string().max(5000).optional().nullable(),
  value_cents:  centsSchema,
  court:        z.string().max(200).optional().nullable(),
  tribunal:     z.string().max(50).optional().nullable(),
  parties:      z.array(casePartySchema).max(100, "Limite de 100 partes por processo").optional(),
});

export const caseUpdateSchema = caseCreateSchema.partial();

export type CaseCreate = z.output<typeof caseCreateSchema>;
export type CaseUpdate = z.output<typeof caseUpdateSchema>;

// ─────────────────────────────────────────────
// Prazos / Agenda (Deadlines)
// ─────────────────────────────────────────────

export const deadlineKindSchema = z.enum(DEADLINE_KIND_VALUES, {
  errorMap: () => ({ message: "Tipo de prazo inválido" }),
});

export const deadlinePrioritySchema = z
  .enum(DEADLINE_PRIORITY_VALUES)
  .optional()
  .nullable();

export const deadlineCreateSchema = z.object({
  title:     z.string().min(2, "Título obrigatório").max(300),
  kind:      deadlineKindSchema,
  due_at:    z.string().datetime({ message: "Data/hora inválida" }),
  priority:  deadlinePrioritySchema,
  case_id:   uuidSchema.optional().nullable(),
  client_id: uuidSchema.optional().nullable(),
  notes:     z.string().max(2000).optional().nullable(),
  done:      z.boolean().optional().default(false),
});

export const deadlineUpdateSchema = deadlineCreateSchema.partial();

export type DeadlineCreate = z.output<typeof deadlineCreateSchema>;
export type DeadlineUpdate = z.output<typeof deadlineUpdateSchema>;

// ─────────────────────────────────────────────
// Lançamentos Financeiros
// ─────────────────────────────────────────────

export const entryKindSchema = z.enum(["receita", "despesa"], {
  errorMap: () => ({ message: "Tipo deve ser 'receita' ou 'despesa'" }),
});

export const entryStatusSchema = z.enum([
  "pendente", "pago", "recebido", "cancelado", "atrasado",
], { errorMap: () => ({ message: "Status financeiro inválido" }) });

export const financialEntryCreateSchema = z.object({
  description:  z.string().min(2, "Descrição obrigatória").max(500),
  kind:         entryKindSchema,
  status:       entryStatusSchema.default("pendente"),
  amount_cents: z.number().int().positive({ message: "Valor deve ser positivo" }),
  due_date:     z.string().optional().nullable(),
  client_id:    uuidSchema.optional().nullable(),
  case_id:      uuidSchema.optional().nullable(),
  category:     z.string().max(100).optional().nullable(),
  payment_method: z.string().max(100).optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
});

export const financialEntryUpdateSchema = financialEntryCreateSchema.partial();

export const financialPaymentCreateSchema = z.object({
  entry_id:     uuidSchema,
  tenant_id:    uuidSchema,
  amount_cents: z.number().int().positive({ message: "Valor deve ser positivo" }),
  method:       z.string().max(100).optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  paid_at:      z.string().datetime({ message: "Data de pagamento inválida" }),
});

export type FinancialEntryCreate = z.output<typeof financialEntryCreateSchema>;
export type FinancialEntryUpdate = z.output<typeof financialEntryUpdateSchema>;
export type FinancialPaymentCreate = z.output<typeof financialPaymentCreateSchema>;

// ─────────────────────────────────────────────
// Helpers de validação seguros
// ─────────────────────────────────────────────

/**
 * Valida e lança exceção com mensagem amigável.
 * Use em mutationFn de React Query.
 */
export function parseOrThrow<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  data: unknown,
  context?: string,
): z.output<TSchema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.errors.map((error) => error.message).join("; ");
    throw new Error(context ? `[${context}] ${messages}` : messages);
  }
  return result.data;
}

/**
 * Valida sem lançar exceção — retorna { ok, data, error }.
 * Use em validação de formulários.
 */
export function safeValidate<T>(schema: z.ZodSchema<T>, data: unknown) {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true as const, data: result.data, error: null };
  const messages = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
  return { ok: false as const, data: null, error: messages };
}
