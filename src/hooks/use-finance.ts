import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import { FinRow } from "@/lib/metrics";

export type Entry = FinRow & {
  id: string;
  description: string;
  clients?: { name: string } | null;
};
export type CaseLite = { id: string; area: string | null; responsible: string | null };
export type ClientLite = { id: string; name: string };
export type PaymentRow = { id: string; entry_id: string; amount_cents: number; paid_at: string; method: string | null; notes: string | null };
export type AuditRow = { id: string; entry_id: string | null; action: string; created_at: string; actor_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
export type NotificationRow = { id: string; kind: string; title: string; body: string | null; entry_id: string | null; read_at: string | null; created_at: string };
export type DreSettingsRow = { tenant_id: string; apply_cogs: boolean; enabled_categories: string[]; category_map: Record<string, string> };

export function useFinance() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const tenantId = profile?.tenant_id ?? null;

  useRealtimeTables(
    ["financial_entries", "cases", "clients", "financial_audit_log", "notifications", "dre_settings", "financial_payments"],
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
      const { data, error } = await supabase
        .from("financial_entries")
        .select("id,description,amount_cents,kind,status,due_date,paid_at,client_id,case_id,paid_amount_cents,settlement_status,category,payment_method,clients(name)")
        .order("due_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as Entry[];
    },
  });

  const casesQ = useQuery({
    queryKey: ["fin", "cases", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("cases").select("id,area,responsible");
      if (error) throw error;
      return (data ?? []) as CaseLite[];
    },
  });

  const clientsQ = useQuery({
    queryKey: ["fin", "clients", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as ClientLite[];
    },
  });

  const dreCfgQ = useQuery({
    queryKey: ["fin", "dre_settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: DreSettingsRow | null; error: unknown }> } } } })
        .from("dre_settings").select("*").eq("tenant_id", tenantId!).maybeSingle();
      if (error) throw error;
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
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  const notifQ = useQuery({
    queryKey: ["fin", "notifications", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { order: (k: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: NotificationRow[] | null; error: unknown }> } } } })
        .from("notifications").select("id,kind,title,body,entry_id,read_at,created_at")
        .order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async (payload: Partial<Entry>) => {
      const { error } = await supabase.from("financial_entries").insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
      toast.success("Lançamento criado");
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("financial_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
      toast.success("Lançamento removido");
    },
    onError: (err) => toast.error(err.message),
  });

  const markAllNotificationsRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fin", "notifications", tenantId] });
      toast.success("Notificações marcadas como lidas");
    },
    onError: (err) => toast.error(err.message),
  });

  const saveDreSettings = useMutation({
    mutationFn: async (payload: { apply_cogs: boolean; enabled_categories: string[]; category_map: Record<string, string> }) => {
      const { error } = await supabase.from("dre_settings").upsert({
        tenant_id: tenantId,
        apply_cogs: payload.apply_cogs,
        enabled_categories: payload.enabled_categories,
        category_map: payload.category_map,
      }, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fin", "dre_settings", tenantId] });
      toast.success("Configuração do DRE atualizada");
    },
    onError: (err) => toast.error(err.message),
  });

  const createPayment = useMutation({
    mutationFn: async (payload: {
      tenant_id: string;
      entry_id: string;
      amount_cents: number;
      method: string;
      notes: string | null;
      paid_at: string;
    }) => {
      const { error } = await supabase.from("financial_payments").insert(payload);
      if (error) throw error;
    },
    onSuccess: (_data, payload) => {
      qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
      qc.invalidateQueries({ queryKey: ["fin", "audit", tenantId] });
      qc.invalidateQueries({ queryKey: ["fin", "payments", payload.entry_id] });
      toast.success("Baixa registrada");
    },
    onError: (err) => toast.error(err.message),
  });

  const reconcile = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase.rpc("reconcile_financial_entry", { _entry_id: entryId });
      if (error) throw error;
    },
    onSuccess: (_data, entryId) => {
      qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
      qc.invalidateQueries({ queryKey: ["fin", "audit", tenantId] });
      qc.invalidateQueries({ queryKey: ["fin", "payments", entryId] });
      toast.success("Lançamento conciliado");
    },
    onError: (err) => toast.error(err.message),
  });

  return {
    entries: entriesQ.data ?? [],
    cases: casesQ.data ?? [],
    clients: clientsQ.data ?? [],
    dreConfigData: dreCfgQ.data,
    auditLogs: auditQ.data ?? [],
    notifications: notifQ.data ?? [],
    isLoading: entriesQ.isLoading || casesQ.isLoading || clientsQ.isLoading,
    create,
    remove,
    markAllNotificationsRead,
    saveDreSettings,
    createPayment,
    reconcile,
  };
}

export function useFinancialPayments(entryId: string | null) {
  return useQuery({
    queryKey: ["fin", "payments", entryId],
    enabled: !!entryId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_payments")
        .select("id,entry_id,amount_cents,paid_at,method,notes")
        .eq("entry_id", entryId!)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PaymentRow[];
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
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });
}
