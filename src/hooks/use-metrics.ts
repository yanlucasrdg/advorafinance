import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeTables } from "@/hooks/use-realtime-table";

/**
 * All metric hooks read straight from Postgres RPC functions
 * (defined in migrations). Zero front-end aggregation.
 *
 * Every hook subscribes to the tables that back its metric so React Query
 * invalidates automatically on any insert/update/delete.
 */

type Delta = { value: number; prev: number | null };

export type ProcessosMetrics = {
  active: Delta;
  value_cause: Delta;
  critical: Delta;
  success_pct: number | null;
  won: number;
  lost: number;
  fees: Delta;
  moves_today: Delta;
  stale_30d: number;
  by_status: Record<string, number>;
  by_area: Record<string, number>;
  by_resp: Record<string, number>;
};

export type AgendaMetrics = {
  audiencias_hoje: number; audiencias_yday: number;
  prazos_hoje: number; prazos_yday: number;
  compromissos_hoje: number; compromissos_yday: number;
  risco_48h: number;
  vencendo_hoje: number; vencendo_amanha: number;
  atraso: number;
  concluidos_hoje: number;
  proximos_7d: number;
};

export type CrmMetrics = {
  by_stage: Record<string, { count: number; value: number }>;
  total: number;
  leads: number;
  ativos: number;
  encerrados: number;
  pipeline_value: number;
  conv_pct: number | null;
  fechados_mes: number;
};

export type ComunicacoesMetrics = {
  total: number;
  novas: number;
  minhas: number;
  nao_lidas: number;
  outros: number;
};

export type FinanceiroMetrics = {
  rev_month: number; rev_prev: number; rev_year: number; rev_12: number;
  exp_month: number; exp_year: number;
  open_receivable: number; overdue_receivable: number;
  open_payable: number; overdue_payable: number;
  delinquency_pct: number; ticket_avg: number;
  profit_month: number; profit_year: number;
  series: { bucket: string; receita: number; despesa: number }[];
};

export type DashboardMetrics = {
  financeiro: FinanceiroMetrics;
  processos: ProcessosMetrics;
  agenda: AgendaMetrics;
  clientes: { total: number; active: number; inactive: number; pf: number; pj: number; new_month: number };
  top_clientes: { id: string; name: string; total: number }[];
};

export type NotificationsSummary = { total: number; unread: number };

function useMetric<T>(name:
  | "metrics_processos" | "metrics_agenda" | "metrics_crm"
  | "metrics_comunicacoes" | "metrics_dashboard" | "notifications_summary",
  tables: string[],
) {
  const { profile } = useAuth();
  const tenant = profile?.tenant_id ?? null;
  useRealtimeTables(tables, [[name, tenant]]);
  return useQuery<T>({
    queryKey: [name, tenant],
    enabled: !!tenant,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(name);
      if (error) throw error;
      return data as T;
    },
    staleTime: 15_000,
  });
}

export const useMetricsProcessos    = () => useMetric<ProcessosMetrics>("metrics_processos", ["cases", "deadlines", "financial_entries"]);
export const useMetricsAgenda       = () => useMetric<AgendaMetrics>("metrics_agenda", ["deadlines"]);
export const useMetricsCrm          = () => useMetric<CrmMetrics>("metrics_crm", ["cases"]);
export const useMetricsComunicacoes = () => useMetric<ComunicacoesMetrics>("metrics_comunicacoes", ["whatsapp_conversations"]);
export const useMetricsDashboard    = () => useMetric<DashboardMetrics>("metrics_dashboard", ["cases", "clients", "deadlines", "financial_entries"]);
export const useNotificationsSummary = () => useMetric<NotificationsSummary>("notifications_summary", ["notifications"]);

export function useMetricsFinanceiro(from?: string, to?: string) {
  const { profile } = useAuth();
  const tenant = profile?.tenant_id ?? null;
  useRealtimeTables(["financial_entries"], [["metrics_financeiro", tenant, from ?? null, to ?? null]]);
  return useQuery<FinanceiroMetrics>({
    queryKey: ["metrics_financeiro", tenant, from ?? null, to ?? null],
    enabled: !!tenant,
    queryFn: async () => {
      const args: Record<string, string> = {};
      if (from) args._from = from;
      if (to) args._to = to;
      const { data, error } = await supabase.rpc("metrics_financeiro", args);
      if (error) throw error;
      return data as FinanceiroMetrics;
    },
    staleTime: 15_000,
  });
}

export function pctDelta(curr: number, prev: number | null): number | null {
  if (prev === null || prev === undefined) return null;
  if (!prev) return curr ? 100 : null;
  return ((curr - prev) / prev) * 100;
}

export function formatDelta(pct: number | null): string | null {
  if (pct === null) return null;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}
