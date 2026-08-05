import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import { PERIOD_LABELS, useGlobalFilters, type PeriodKey } from "@/lib/global-filters";
import { formatDateOnly } from "@/lib/global-filter-utils";

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
  audiencias_hoje: number;
  audiencias_yday: number;
  prazos_hoje: number;
  prazos_yday: number;
  compromissos_hoje: number;
  compromissos_yday: number;
  risco_48h: number;
  vencendo_hoje: number;
  vencendo_amanha: number;
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
  rev_month: number;
  rev_prev: number;
  rev_year: number;
  rev_12: number;
  exp_month: number;
  exp_year: number;
  open_receivable: number;
  overdue_receivable: number;
  open_payable: number;
  overdue_payable: number;
  delinquency_pct: number;
  ticket_avg: number;
  profit_month: number;
  profit_year: number;
  series: { bucket: string; receita: number; despesa: number }[];
};

export type FinancialReports = {
  meta: {
    schemaVersion: number;
    generatedAt: string;
    timezone: string;
    currency: "BRL";
    basis: "cash";
    agingAsOf: string;
  };
  period: { from: string; to: string; timezone: string };
  dre: {
    receitaBruta: number;
    deducoes: number;
    receitaLiquida: number;
    custos: number;
    lucroBruto: number;
    desOp: number;
    resultadoOperacional: number;
    desFin: number;
    resultado: number;
    margem: number;
    buckets: Record<string, number>;
    config: { applyCogs: boolean; enabledCategories: string[] };
  };
  cashFlow: {
    daily: { bucket: string; entradas: number; saidas: number; saldo: number }[];
    direct: {
      entradasOp: number;
      saidasOp: number;
      caixaGerado: number;
      byMethod: Record<string, { entradas: number; saidas: number }>;
    };
    indirect: {
      available: false;
      reason: "requires_competence_ledger";
    };
  };
  aging: {
    key: "not_due" | "days_1_30" | "days_31_60" | "days_61_90" | "days_90_plus" | "no_due_date";
    value: number;
    count: number;
  }[];
  groups: {
    clients: FinancialReportGroup[];
    cases: FinancialReportGroup[];
    areas: FinancialReportGroup[];
    responsibles: FinancialReportGroup[];
  };
};

export type FinancialReportGroup = {
  id?: string | null;
  name: string;
  value: number;
  revenue: number;
  expense: number;
  net: number;
  count: number;
};

export type FinancialReportFilterDimension = "client" | "area" | "responsible";
export type FinancialReportFilterOption = { id: string; label: string };

export type DashboardMetrics = {
  financeiro: FinanceiroMetrics;
  processos: ProcessosMetrics;
  agenda: AgendaMetrics;
  clientes: {
    total: number;
    active: number;
    inactive: number;
    pf: number;
    pj: number;
    new_month: number;
  };
  top_clientes: { id: string; name: string; total: number }[];
};

export type DashboardPeriod = {
  key: PeriodKey;
  label: string;
  from: string;
  to: string;
  /**
   * The current database contract applies `_from`/`_to` to financial entries.
   * Process, agenda and client aggregates remain an operational snapshot.
   */
  scope: "financial";
};

export type DashboardViewState = {
  kind: "loading" | "ready" | "refreshing" | "stale" | "error";
  period: DashboardPeriod;
  lastUpdatedAt: Date | null;
  isUsingPreviousData: boolean;
  errorMessage: string | null;
  retry: () => void;
};

export type NotificationsSummary = { total: number; unread: number };

function useMetric<T>(
  name:
    | "metrics_processos"
    | "metrics_agenda"
    | "metrics_crm"
    | "metrics_comunicacoes"
    | "metrics_dashboard"
    | "notifications_summary",
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

export const useMetricsProcessos = () =>
  useMetric<ProcessosMetrics>("metrics_processos", ["cases", "deadlines", "financial_entries"]);
export const useMetricsAgenda = () => useMetric<AgendaMetrics>("metrics_agenda", ["deadlines"]);
export const useMetricsCrm = () => useMetric<CrmMetrics>("metrics_crm", ["clients"]);
export const useMetricsComunicacoes = () =>
  useMetric<ComunicacoesMetrics>("metrics_comunicacoes", ["whatsapp_conversations"]);
export const useNotificationsSummary = () =>
  useMetric<NotificationsSummary>("notifications_summary", ["notifications"]);

type DashboardQueryPayload = {
  metrics: DashboardMetrics;
  financialScopeApplied: boolean;
};

export type DashboardMetricsResult = {
  data: DashboardMetrics | undefined;
  error: Error | null;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  isRefetching: boolean;
  viewState: DashboardViewState;
};

/**
 * Dashboard aggregates with an honest period contract.
 *
 * `metrics_dashboard()` remains the source of truth for the operational
 * snapshot. The selected range is sent to `metrics_financeiro()` and replaces
 * only the financial slice. If that scoped RPC fails, the unfiltered financial
 * slice from the dashboard RPC is retained and the UI receives `stale` rather
 * than losing the whole dashboard.
 */
export function useMetricsDashboard(): DashboardMetricsResult {
  const { profile } = useAuth();
  const { filters, range } = useGlobalFilters();
  const tenant = profile?.tenant_id ?? null;
  const from = formatDateOnly(range.start);
  const to = formatDateOnly(range.end);
  const key = ["metrics_dashboard", tenant, from, to] as const;

  useRealtimeTables(
    ["cases", "clients", "deadlines", "financial_entries"],
    [["metrics_dashboard", tenant]],
  );

  const query = useQuery<DashboardQueryPayload, Error>({
    queryKey: key,
    enabled: !!tenant,
    queryFn: async () => {
      const [dashboardResult, financialResult] = await Promise.all([
        supabase.rpc("metrics_dashboard"),
        supabase.rpc("metrics_financeiro", { _from: from, _to: to }),
      ]);

      if (dashboardResult.error || !dashboardResult.data) {
        throw new Error("Não foi possível carregar os indicadores do dashboard.");
      }

      const base = dashboardResult.data as DashboardMetrics;
      if (financialResult.error || !financialResult.data) {
        return { metrics: base, financialScopeApplied: false };
      }

      return {
        metrics: {
          ...base,
          financeiro: financialResult.data as FinanceiroMetrics,
        },
        financialScopeApplied: true,
      };
    },
    /**
     * Preserve the last period while a new one loads, but never carry cached
     * data across tenants.
     */
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === tenant ? previousData : undefined,
    staleTime: 15_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
  });

  const lastSuccessRef = useRef<{ tenant: string | null; at: number | null }>({
    tenant: null,
    at: null,
  });
  if (tenant && query.data && !query.isPlaceholderData && query.dataUpdatedAt > 0) {
    lastSuccessRef.current = { tenant, at: query.dataUpdatedAt };
  }
  const lastUpdatedTimestamp = query.isPlaceholderData
    ? lastSuccessRef.current.tenant === tenant
      ? lastSuccessRef.current.at
      : null
    : query.dataUpdatedAt || null;

  const period: DashboardPeriod = {
    key: filters.period,
    label: PERIOD_LABELS[filters.period],
    from,
    to,
    scope: "financial",
  };
  const hasData = !!query.data;
  const degraded = hasData && query.data.financialScopeApplied === false;
  const kind: DashboardViewState["kind"] =
    query.isPending && !hasData
      ? "loading"
      : query.isError && !hasData
        ? "error"
        : query.isError || degraded
          ? "stale"
          : query.isFetching && hasData
            ? "refreshing"
            : "ready";
  const errorMessage =
    kind === "error"
      ? "Não foi possível carregar o dashboard. Tente novamente."
      : degraded
        ? "O período financeiro não pôde ser atualizado. Exibindo o último resumo disponível."
        : query.isError
          ? "Não foi possível atualizar agora. Exibindo os últimos dados disponíveis."
          : null;

  return {
    data: query.data?.metrics,
    error: query.error,
    isLoading: query.isPending && !hasData,
    isError: query.isError,
    isFetching: query.isFetching,
    isRefetching: query.isRefetching,
    viewState: {
      kind,
      period,
      lastUpdatedAt: lastUpdatedTimestamp ? new Date(lastUpdatedTimestamp) : null,
      isUsingPreviousData: query.isPlaceholderData,
      errorMessage,
      retry: () => {
        void query.refetch();
      },
    },
  };
}

export function useMetricsFinanceiro(
  opts: { from?: string; to?: string; clientId?: string; area?: string; responsible?: string } = {},
) {
  const { profile } = useAuth();
  const tenant = profile?.tenant_id ?? null;
  const key = [
    "metrics_financeiro",
    tenant,
    opts.from ?? null,
    opts.to ?? null,
    opts.clientId ?? null,
    opts.area ?? null,
    opts.responsible ?? null,
  ];
  useRealtimeTables(["financial_entries", "financial_payments", "financial_payment_reversals", "cases"], [key]);
  return useQuery<FinanceiroMetrics>({
    queryKey: key,
    enabled: !!tenant,
    queryFn: async () => {
      const args: Record<string, string> = {};
      if (opts.from) args._from = opts.from;
      if (opts.to) args._to = opts.to;
      if (opts.clientId) args._client_id = opts.clientId;
      if (opts.area) args._area = opts.area;
      if (opts.responsible) args._responsible = opts.responsible;
      const { data, error } = await supabase.rpc("metrics_financeiro", args);
      if (error) throw error;
      return data as FinanceiroMetrics;
    },
    staleTime: 15_000,
  });
}

export function useFinancialReports(
  opts: { from: string; to: string; clientId?: string; area?: string; responsible?: string },
) {
  const { profile } = useAuth();
  const tenant = profile?.tenant_id ?? null;
  const key = [
    "financial_reports",
    tenant,
    opts.from,
    opts.to,
    opts.clientId ?? null,
    opts.area ?? null,
    opts.responsible ?? null,
  ];
  useRealtimeTables(
    [
      "financial_entries",
      "financial_payments",
      "financial_payment_reversals",
      "cases",
      "clients",
      "profiles",
      "dre_settings",
    ],
    [key],
  );
  return useQuery<FinancialReports>({
    queryKey: key,
    enabled: !!tenant,
    queryFn: async () => {
      const args: Record<string, string> = { _from: opts.from, _to: opts.to };
      if (opts.clientId) args._client_id = opts.clientId;
      if (opts.area) args._area = opts.area;
      if (opts.responsible) args._responsible = opts.responsible;
      const { data, error } = await supabase.rpc("financial_reports", args);
      if (error) throw error;
      return data as unknown as FinancialReports;
    },
    staleTime: 15_000,
  });
}

export function useFinancialReportFilterOptions(
  dimension: FinancialReportFilterDimension,
  search: string,
) {
  const { profile } = useAuth();
  const tenant = profile?.tenant_id ?? null;
  const normalizedSearch = search.trim();
  const key = ["financial_report_filter_options", tenant, dimension, normalizedSearch] as const;
  useRealtimeTables(["financial_entries", "cases", "clients", "profiles"], [key]);

  return useQuery<FinancialReportFilterOption[]>({
    queryKey: key,
    enabled: !!tenant,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("financial_report_filter_options", {
        _dimension: dimension,
        _search: normalizedSearch || undefined,
        _limit: 50,
      });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
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
