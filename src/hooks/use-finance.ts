/**
 * use-finance.ts — Hook Financeiro com validação Zod e correções de auditoria
 *
 * Correções desta versão (Auditoria 2026-07-25):
 * - Validação Zod em create, createPayment
 * - markAllNotificationsRead agora filtra por tenant_id (fix crítico)
 * - Listas operacionais limitadas a 500; relatórios usam RPCs agregadas sem truncamento
 * - Tipagens explícitas sem `as any`
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import { FinRow } from "@/lib/metrics";
import {
  financialEntryCreateSchema,
  financialPaymentCreateSchema,
  parseOrThrow,
  type FinancialEntryCreate,
  type FinancialPaymentCreate,
} from "@/lib/validators";

export type Entry = FinRow & {
  id: string;
  description: string;
  clients?: { name: string } | null;
};
export type CaseLite = { id: string; area: string | null; responsible: string | null };
export type ClientLite = { id: string; name: string };
export type PaymentReversalRow = {
  id: string;
  amount_cents: number;
  reason: string;
  reversed_at: string;
  created_by: string | null;
};
export type PaymentRow = {
  id: string;
  entry_id: string;
  amount_cents: number;
  paid_at: string;
  method: string | null;
  notes: string | null;
  financial_payment_reversals: PaymentReversalRow[];
  reversed_amount_cents: number;
};
export type AuditRow = { id: string; entry_id: string | null; action: string; created_at: string; actor_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
export type NotificationRow = { id: string; kind: string; title: string; body: string | null; entry_id: string | null; read_at: string | null; created_at: string };
export type DreSettingsRow = { tenant_id: string; apply_cogs: boolean; enabled_categories: string[]; category_map: Record<string, string> };

export function useFinance() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const tenantId = profile?.tenant_id ?? null;
  const invalidateFinancialSummaries = () => {
    void qc.invalidateQueries({ queryKey: ["metrics_financeiro"] });
    void qc.invalidateQueries({ queryKey: ["financial_reports"] });
  };

  useRealtimeTables(
    ["financial_entries", "cases", "clients", "financial_audit_log", "notifications", "dre_settings", "financial_payments", "financial_payment_reversals"],
    [
      ["fin", "entries", tenantId],
      ["fin", "cases", tenantId],
      ["fin", "clients", tenantId],
      ["fin", "dre_settings", tenantId],
      ["fin", "audit", tenantId],
      ["fin", "notifications", tenantId],
      ["fin", "payments", tenantId],
    ],
  );

  const entriesQ = useQuery({
    queryKey: ["fin", "entries", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      // Esta coleção alimenta somente tabelas/ações operacionais. Totais e
      // relatórios são calculados no banco por financial_reports/metrics_financeiro.
      const { data, error } = await supabase
        .from("financial_entries")
        .select("id,description,amount_cents,kind,status,due_date,paid_at,client_id,case_id,paid_amount_cents,settlement_status,category,payment_method,clients(name)")
        .is("deleted_at", null)
        .order("due_date", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Entry[];
    },
  });

  const casesQ = useQuery({
    queryKey: ["fin", "cases", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("cases").select("id,area,responsible").is("deleted_at", null).limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as CaseLite[];
    },
  });

  const clientsQ = useQuery({
    queryKey: ["fin", "clients", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id,name").is("deleted_at", null).order("name").limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as ClientLite[];
    },
  });

  const dreCfgQ = useQuery({
    queryKey: ["fin", "dre_settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (k: string, v: string) => {
              maybeSingle: () => Promise<{ data: DreSettingsRow | null; error: { message: string } | null }>;
            };
          };
        };
      }).from("dre_settings").select("*").eq("tenant_id", tenantId!).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const auditQ = useQuery({
    queryKey: ["fin", "audit", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_audit_log")
        .select("id,entry_id,action,created_at,actor_id,before,after")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  const notifQ = useQuery({
    queryKey: ["fin", "notifications", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (k: string, v: string) => {
              order: (k: string, o: { ascending: boolean }) => {
                limit: (n: number) => Promise<{ data: NotificationRow[] | null; error: { message: string } | null }>;
              };
            };
          };
        };
      }).from("notifications").select("id,kind,title,body,entry_id,read_at,created_at")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async (raw: Partial<Entry>) => {
      // ✅ Valida schema antes de inserir — elimina mass assignment
      const payload: FinancialEntryCreate = parseOrThrow(financialEntryCreateSchema, raw, "Criar Lançamento");
      const { error } = await supabase.from("financial_entries").insert({
        ...payload,
        tenant_id: tenantId,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
      invalidateFinancialSummaries();
      toast.success("Lançamento criado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("soft_delete_financial_entry", { p_entry_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
      invalidateFinancialSummaries();
      toast.success("Lançamento removido");
    },
    onError: (err: Error) => {
      const message = /FINANCIAL_ENTRY_HAS_PAYMENTS/i.test(err.message)
        ? "Lançamentos com pagamentos não podem ser removidos. Cancele ou estorne pela rotina financeira."
        : /FINANCIAL_ENTRY_RECONCILED/i.test(err.message)
          ? "Lançamentos conciliados não podem ser removidos."
          : "Não foi possível remover o lançamento.";
      toast.error(message);
    },
  });

  const markAllNotificationsRead = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Sessão expirada.");
      // ✅ Agora filtra por tenant_id (fix crítico de auditoria)
      const { error } = await (supabase as unknown as {
        from: (t: string) => {
          update: (v: Record<string, string>) => {
            eq: (k: string, v: string) => {
              is: (k: string, v: null) => Promise<{ error: { message: string } | null }>;
            };
          };
        };
      }).from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .is("read_at", null);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fin", "notifications", tenantId] });
      toast.success("Notificações marcadas como lidas");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveDreSettings = useMutation({
    mutationFn: async (payload: { apply_cogs: boolean; enabled_categories: string[]; category_map: Record<string, string> }) => {
      if (!tenantId) throw new Error("Sessão expirada.");
      const { error } = await supabase.from("dre_settings").upsert({
        tenant_id:          tenantId,
        apply_cogs:         payload.apply_cogs,
        enabled_categories: payload.enabled_categories,
        category_map:       payload.category_map,
      }, { onConflict: "tenant_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fin", "dre_settings", tenantId] });
      invalidateFinancialSummaries();
      toast.success("Configuração do DRE atualizada");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createPayment = useMutation({
    mutationFn: async (raw: {
      tenant_id: string; entry_id: string; amount_cents: number;
      method: string; notes: string | null; paid_at: string;
    }) => {
      // ✅ Valida antes de inserir
      const payload: FinancialPaymentCreate = parseOrThrow(financialPaymentCreateSchema, raw, "Registrar Baixa");
      const { error } = await supabase.from("financial_payments").insert(payload as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, payload) => {
      qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
      qc.invalidateQueries({ queryKey: ["fin", "audit", tenantId] });
      qc.invalidateQueries({ queryKey: ["fin", "payments", payload.entry_id] });
      invalidateFinancialSummaries();
      toast.success("Baixa registrada");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reconcile = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase.rpc("reconcile_financial_entry", { _entry_id: entryId });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, entryId) => {
      qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
      qc.invalidateQueries({ queryKey: ["fin", "audit", tenantId] });
      qc.invalidateQueries({ queryKey: ["fin", "payments", entryId] });
      invalidateFinancialSummaries();
      toast.success("Lançamento conciliado");
    },
    onError: (err: Error) => {
      const message = /FINANCIAL_ENTRY_NOT_FULLY_PAID/i.test(err.message)
        ? "O lançamento precisa estar integralmente pago antes da conciliação."
        : /ROLE_ACCESS_DENIED/i.test(err.message)
          ? "Somente proprietário ou administrador pode conciliar lançamentos."
          : "Não foi possível conciliar o lançamento.";
      toast.error(message);
    },
  });

  const reversePayment = useMutation({
    mutationFn: async ({ paymentId, reason, amountCents }: { paymentId: string; reason: string; amountCents?: number }) => {
      const { data, error } = await supabase.rpc("reverse_financial_payment", {
        p_payment_id: paymentId,
        p_reason: reason.trim(),
        p_amount_cents: amountCents,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (entry) => {
      qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
      qc.invalidateQueries({ queryKey: ["fin", "audit", tenantId] });
      qc.invalidateQueries({ queryKey: ["fin", "payments", entry.id] });
      invalidateFinancialSummaries();
      toast.success("Baixa estornada com registro de auditoria");
    },
    onError: (err: Error) => {
      const message = /FINANCIAL_ENTRY_RECONCILED/i.test(err.message)
        ? "Lançamentos conciliados não podem ter baixas estornadas."
        : /FINANCIAL_REVERSAL_REASON_REQUIRED/i.test(err.message)
          ? "Informe um motivo com pelo menos 5 caracteres."
          : /FINANCIAL_REVERSAL_AMOUNT_INVALID|FINANCIAL_REVERSAL_EXCEEDS_ENTRY_PAID/i.test(err.message)
            ? "O valor do estorno é inválido para esta baixa."
            : /ROLE_ACCESS_DENIED/i.test(err.message)
              ? "Somente proprietário ou administrador pode estornar baixas."
              : "Não foi possível estornar a baixa.";
      toast.error(message);
    },
  });

  return {
    entries:       entriesQ.data ?? [],
    cases:         casesQ.data ?? [],
    clients:       clientsQ.data ?? [],
    dreConfigData: dreCfgQ.data,
    auditLogs:     auditQ.data ?? [],
    notifications: notifQ.data ?? [],
    isLoading:     entriesQ.isLoading || casesQ.isLoading || clientsQ.isLoading,
    isError:       entriesQ.isError,
    error:         entriesQ.error,
    create,
    remove,
    markAllNotificationsRead,
    saveDreSettings,
    createPayment,
    reconcile,
    reversePayment,
  };
}

export function useFinancialPayments(entryId: string | null) {
  return useQuery({
    queryKey: ["fin", "payments", entryId],
    enabled: !!entryId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_payments")
        .select("id,entry_id,amount_cents,paid_at,method,notes,financial_payment_reversals(id,amount_cents,reason,reversed_at,created_by)")
        .eq("entry_id", entryId!)
        .order("paid_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((payment) => {
        const reversals = payment.financial_payment_reversals ?? [];
        return {
          ...payment,
          financial_payment_reversals: reversals,
          reversed_amount_cents: reversals.reduce((total, reversal) => total + reversal.amount_cents, 0),
        } satisfies PaymentRow;
      });
    },
  });
}

export function useFinancialAuditEntry(entryId: string | null) {
  return useQuery({
    queryKey: ["fin", "audit_entry", entryId],
    enabled: !!entryId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_audit_log")
        .select("id,entry_id,action,created_at,actor_id,before,after")
        .eq("entry_id", entryId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AuditRow[];
    },
  });
}
