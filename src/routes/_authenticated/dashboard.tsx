import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileClock,
  FolderSearch2,
  Landmark,
  LayoutDashboard,
  RefreshCw,
  Scale,
  Settings2,
  TrendingUp,
  UserPlus,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsDashboard } from "@/hooks/use-metrics";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PERIOD_LABELS, useGlobalFilters, type PeriodKey } from "@/lib/global-filters";
import { fmtBRL, fmtBRLCompact } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Centro de Operações — Advora" }] }),
  component: Dashboard,
});

type DashboardDestination = "/agenda" | "/config" | "/crm" | "/financeiro" | "/processos";

type UpcomingDeadline = {
  id: string;
  title: string;
  due_at: string;
  kind: string;
  case_id: string | null;
  cases: { number: string | null } | null;
};

type RecentCase = {
  id: string;
  title: string;
  number: string | null;
  status: string;
  area: string | null;
  client_id: string | null;
  updated_at: string;
  clients: { name: string | null } | null;
};

const PERIOD_OPTIONS = Object.entries(PERIOD_LABELS) as [PeriodKey, string][];
const MONTH_ABBR = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const financialChartConfig = {
  Receita: { label: "Receita", color: "var(--chart-1)" },
  Despesa: { label: "Despesa", color: "var(--chart-5)" },
} satisfies ChartConfig;

const countChartConfig = {
  value: { label: "Processos", color: "var(--chart-1)" },
} satisfies ChartConfig;

const statusLabels: Record<string, string> = {
  active: "Ativo",
  ativo: "Ativo",
  arquivado: "Arquivado",
  concluido: "Concluído",
  encerrado: "Encerrado",
  ganho: "Ganho",
  lost: "Perdido",
  perdido: "Perdido",
  recurso: "Em recurso",
  suspenso: "Suspenso",
  won: "Ganho",
};

function bucketLabel(bucket: string) {
  const [year = "", month = "1"] = bucket.split("-");
  const index = Math.max(0, Math.min(11, Number(month) - 1));
  return `${MONTH_ABBR[index]}/${year.slice(2)}`;
}

function humanize(value: string | null | undefined) {
  if (!value) return "Não informado";
  const normalized = value.toLowerCase();
  if (statusLabels[normalized]) return statusLabels[normalized];
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function greetingForHour(hour: number) {
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function formatUpdatedAt(date: Date | null) {
  if (!date) return "Aguardando primeira atualização";
  return `Atualizado às ${new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)}`;
}

function formatDeadline(dateValue: string) {
  const date = new Date(dateValue);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function deadlineDistance(dateValue: string) {
  const now = new Date();
  const due = new Date(dateValue);
  const differenceHours = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60));

  if (differenceHours <= 0) return "Vence agora";
  if (differenceHours < 24) return `Em ${differenceHours}h`;
  const days = Math.ceil(differenceHours / 24);
  return `Em ${days} ${days === 1 ? "dia" : "dias"}`;
}

function Dashboard() {
  const { profile } = useAuth();
  const { filters, setFilter } = useGlobalFilters();
  const tenantId = profile?.tenant_id ?? null;
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "profissional";
  const metrics = useMetricsDashboard();
  const { data: dashboardMetrics, viewState } = metrics;

  const upcomingQuery = useQuery<UpcomingDeadline[]>({
    queryKey: ["dash", "upcoming", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deadlines")
        .select("id, title, due_at, kind, case_id, cases(number)")
        .is("deleted_at", null)
        .eq("done", false)
        .gte("due_at", new Date().toISOString())
        .order("due_at", { ascending: true })
        .limit(6);

      if (error) throw error;
      return (data ?? []) as unknown as UpcomingDeadline[];
    },
    staleTime: 15_000,
    retry: 2,
  });

  const recentCasesQuery = useQuery<RecentCase[]>({
    queryKey: ["dash", "recent-cases", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("id, title, number, status, area, client_id, updated_at, clients(name)")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(6);

      if (error) throw error;
      return (data ?? []) as unknown as RecentCase[];
    },
    staleTime: 15_000,
    retry: 2,
  });

  useRealtimeTables(
    ["deadlines", "cases"],
    [
      ["dash", "upcoming", tenantId],
      ["dash", "recent-cases", tenantId],
    ],
  );

  const financial = dashboardMetrics?.financeiro;
  const cases = dashboardMetrics?.processos;
  const clients = dashboardMetrics?.clientes;
  const agenda = dashboardMetrics?.agenda;

  const revenueHistory = useMemo(
    () =>
      (financial?.series ?? []).map((bucket) => ({
        label: bucketLabel(bucket.bucket),
        Receita: bucket.receita / 100,
        Despesa: bucket.despesa / 100,
      })),
    [financial?.series],
  );

  const areaDistribution = useMemo(
    () =>
      Object.entries(cases?.by_area ?? {})
        .sort(([, left], [, right]) => right - left)
        .slice(0, 7)
        .map(([name, value]) => ({ name: humanize(name), value })),
    [cases?.by_area],
  );

  const statusDistribution = useMemo(
    () =>
      Object.entries(cases?.by_status ?? {})
        .sort(([, left], [, right]) => right - left)
        .slice(0, 7)
        .map(([name, value]) => ({ name: humanize(name), value })),
    [cases?.by_status],
  );

  const responsibleDistribution = useMemo(
    () =>
      Object.entries(cases?.by_resp ?? {})
        .sort(([, left], [, right]) => right - left)
        .slice(0, 7)
        .map(([name, value]) => ({
          name: name === "sem-responsavel" ? "Sem responsável" : humanize(name),
          value,
        })),
    [cases?.by_resp],
  );

  const historySummary = useMemo(
    () =>
      revenueHistory.reduce(
        (summary, item) => ({
          revenue: summary.revenue + item.Receita,
          expense: summary.expense + item.Despesa,
        }),
        { revenue: 0, expense: 0 },
      ),
    [revenueHistory],
  );

  const retryDashboard = () => {
    viewState.retry();
    void upcomingQuery.refetch();
    void recentCasesQuery.refetch();
  };

  const today = new Date();
  const todayLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(today);

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-4 py-5 sm:px-6 sm:py-6 xl:px-8">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <LayoutDashboard className="size-4 text-primary" />
            Centro de operações
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {greetingForHour(today.getHours())}, {firstName}
          </h1>
          <p className="mt-1.5 text-sm capitalize text-muted-foreground">
            {todayLabel}. Prioridades, resultados e execução em um só lugar.
          </p>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <SyncStatus kind={viewState.kind} lastUpdatedAt={viewState.lastUpdatedAt} />

          <div className="min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Período financeiro
            </span>
            <div
              className="hidden rounded-lg border bg-card p-1 shadow-sm sm:flex"
              role="radiogroup"
              aria-label="Período dos indicadores financeiros"
            >
              {PERIOD_OPTIONS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={filters.period === key}
                  onClick={() => setFilter("period", key)}
                  className={cn(
                    "min-h-8 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    filters.period === key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <Select
              value={filters.period}
              onValueChange={(value) => setFilter("period", value as PeriodKey)}
            >
              <SelectTrigger
                className="w-full bg-card sm:hidden"
                aria-label="Período dos indicadores financeiros"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" className="h-10 bg-card" asChild>
            <Link to="/config">
              <Settings2 />
              Personalizar painel
            </Link>
          </Button>
        </div>
      </header>

      {viewState.kind === "stale" && (
        <DegradedBanner
          message={
            viewState.errorMessage ??
            "Não foi possível atualizar agora. Exibindo os últimos dados disponíveis."
          }
          updatedAt={viewState.lastUpdatedAt}
          onRetry={retryDashboard}
        />
      )}

      {viewState.kind === "error" && !dashboardMetrics ? (
        <DashboardError onRetry={retryDashboard} />
      ) : viewState.kind === "loading" && !dashboardMetrics ? (
        <DashboardSkeleton />
      ) : dashboardMetrics ? (
        <>
          <section aria-labelledby="attention-title">
            <SectionHeading
              id="attention-title"
              eyebrow="Prioridade"
              title="Atenção agora"
              description="Itens que merecem ação imediata do escritório."
            />
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
              <AttentionCard
                icon={AlertCircle}
                label="Prazos vencidos"
                value={String(agenda?.atraso ?? 0)}
                helper={
                  (agenda?.atraso ?? 0) > 0 ? "Requer revisão imediata" : "Nenhum prazo vencido"
                }
                to="/agenda"
                tone={(agenda?.atraso ?? 0) > 0 ? "danger" : "success"}
              />
              <AttentionCard
                icon={Clock3}
                label="Risco nas próximas 48h"
                value={String(agenda?.risco_48h ?? 0)}
                helper="Prazos próximos do limite"
                to="/agenda"
                tone={(agenda?.risco_48h ?? 0) > 0 ? "warning" : "success"}
              />
              <AttentionCard
                icon={Scale}
                label="Audiências de hoje"
                value={String(agenda?.audiencias_hoje ?? 0)}
                helper="Agenda operacional de hoje"
                to="/agenda"
                tone="brand"
              />
              <AttentionCard
                icon={CircleDollarSign}
                label="Recebimentos vencidos"
                value={fmtBRLCompact(financial?.overdue_receivable ?? 0)}
                helper="Valores em aberto e atrasados"
                to="/financeiro"
                tone={(financial?.overdue_receivable ?? 0) > 0 ? "danger" : "success"}
              />
            </div>
          </section>

          <section aria-labelledby="kpi-title">
            <SectionHeading
              id="kpi-title"
              eyebrow="Visão executiva"
              title="Indicadores principais"
              description={`Finanças em “${viewState.period.label}”; operação no estado atual.`}
            />
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                icon={TrendingUp}
                label="Receita recebida"
                value={fmtBRL(financial?.rev_12 ?? 0)}
                helper={`Período financeiro: ${viewState.period.label}`}
                to="/financeiro"
              />
              <KpiCard
                icon={WalletCards}
                label="Total a receber"
                value={fmtBRL(financial?.open_receivable ?? 0)}
                helper={`${(financial?.delinquency_pct ?? 0).toFixed(1)}% em atraso`}
                to="/financeiro"
              />
              <KpiCard
                icon={BriefcaseBusiness}
                label="Processos ativos"
                value={String(cases?.active.value ?? 0)}
                helper={`${cases?.stale_30d ?? 0} sem movimentação há 30+ dias`}
                to="/processos"
              />
              <KpiCard
                icon={UserPlus}
                label="Novos clientes"
                value={String(clients?.new_month ?? 0)}
                helper={`${clients?.active ?? 0} clientes ativos atualmente`}
                to="/crm"
              />
            </div>
          </section>

          <section
            className="grid gap-4 xl:grid-cols-12"
            aria-label="Desempenho financeiro e agenda crítica"
          >
            <Surface className="xl:col-span-8">
              <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Tendência
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">Histórico financeiro · 12 meses</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Receita recebida e despesas pagas, independentemente do seletor acima.
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <ChartKey color="var(--chart-1)" label="Receita" />
                  <ChartKey color="var(--chart-5)" label="Despesa" />
                </div>
              </div>

              <div className="p-4 sm:p-6">
                {revenueHistory.length > 0 ? (
                  <>
                    <p className="sr-only">
                      Nos últimos 12 meses, a receita somou {fmtBRL(historySummary.revenue * 100)} e
                      as despesas somaram {fmtBRL(historySummary.expense * 100)}.
                    </p>
                    <div className="overflow-x-auto pb-2">
                      <ChartContainer
                        config={financialChartConfig}
                        className="h-[290px] min-w-[620px] w-full aspect-auto"
                      >
                        <AreaChart
                          data={revenueHistory}
                          margin={{ top: 12, right: 12, left: 4, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
                              <stop
                                offset="5%"
                                stopColor="var(--color-Receita)"
                                stopOpacity={0.3}
                              />
                              <stop offset="95%" stopColor="var(--color-Receita)" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="expense-fill" x1="0" y1="0" x2="0" y2="1">
                              <stop
                                offset="5%"
                                stopColor="var(--color-Despesa)"
                                stopOpacity={0.22}
                              />
                              <stop offset="95%" stopColor="var(--color-Despesa)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                          <XAxis
                            dataKey="label"
                            axisLine={false}
                            tickLine={false}
                            tickMargin={10}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            width={72}
                            tickFormatter={(value) => fmtBRLCompact(Number(value) * 100)}
                          />
                          <ChartTooltip
                            cursor={{ stroke: "var(--chart-grid)" }}
                            content={
                              <ChartTooltipContent
                                formatter={(value, name) => (
                                  <div className="flex min-w-36 items-center justify-between gap-4">
                                    <span className="text-muted-foreground">{String(name)}</span>
                                    <span className="font-mono font-semibold tabular-nums text-foreground">
                                      {fmtBRL(Number(value) * 100)}
                                    </span>
                                  </div>
                                )}
                              />
                            }
                          />
                          <Area
                            type="monotone"
                            dataKey="Receita"
                            stroke="var(--color-Receita)"
                            strokeWidth={2.5}
                            fill="url(#revenue-fill)"
                            activeDot={{ r: 5 }}
                          />
                          <Area
                            type="monotone"
                            dataKey="Despesa"
                            stroke="var(--color-Despesa)"
                            strokeWidth={2.25}
                            fill="url(#expense-fill)"
                            activeDot={{ r: 5 }}
                          />
                        </AreaChart>
                      </ChartContainer>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={Landmark}
                    title="Ainda não há histórico financeiro"
                    description="Registre receitas e despesas confirmadas para acompanhar a evolução mensal."
                    actionLabel="Abrir financeiro"
                    to="/financeiro"
                  />
                )}
              </div>
            </Surface>

            <Surface className="xl:col-span-4">
              <div className="flex items-start justify-between gap-4 border-b p-5 sm:p-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Agenda crítica
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">Próximos prazos</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Seis compromissos mais próximos.
                  </p>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/agenda" aria-label="Ver agenda completa">
                    Ver agenda <ArrowRight />
                  </Link>
                </Button>
              </div>
              <div className="min-h-[338px] p-3 sm:p-4">
                {upcomingQuery.isPending ? (
                  <ListSkeleton rows={5} />
                ) : upcomingQuery.isError ? (
                  <BlockError
                    title="Não foi possível carregar os prazos"
                    onRetry={() => void upcomingQuery.refetch()}
                  />
                ) : upcomingQuery.data.length === 0 ? (
                  <EmptyState
                    icon={CalendarClock}
                    title="Nenhum prazo futuro"
                    description="Quando um prazo for cadastrado, ele aparecerá nesta lista."
                    actionLabel="Abrir agenda"
                    to="/agenda"
                    compact
                  />
                ) : (
                  <ul className="space-y-1">
                    {upcomingQuery.data.map((deadline) => (
                      <li key={deadline.id}>
                        <Link
                          to="/agenda"
                          className="group flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <div className="mt-0.5 rounded-lg bg-brand-soft p-2 text-primary">
                            <FileClock className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="line-clamp-2 text-sm font-medium leading-5">
                                {deadline.title}
                              </p>
                              <span className="shrink-0 text-xs font-semibold text-primary">
                                {deadlineDistance(deadline.due_at)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {humanize(deadline.kind)} · {formatDeadline(deadline.due_at)}
                              {deadline.cases?.number ? ` · ${deadline.cases.number}` : ""}
                            </p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Surface>
          </section>

          <section aria-labelledby="execution-title">
            <SectionHeading
              id="execution-title"
              eyebrow="Operação atual"
              title="Execução diária"
              description="Acompanhe a carteira que está se movimentando e os pontos de atenção."
            />
            <div className="grid gap-4 xl:grid-cols-12">
              <Surface className="xl:col-span-8">
                <div className="flex items-center justify-between gap-4 border-b p-5 sm:p-6">
                  <div>
                    <h3 className="font-semibold">Processos atualizados recentemente</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Últimas alterações visíveis para o seu perfil.
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/processos">
                      Ver processos <ArrowRight />
                    </Link>
                  </Button>
                </div>
                <div className="p-3 sm:p-4">
                  {recentCasesQuery.isPending ? (
                    <ListSkeleton rows={5} />
                  ) : recentCasesQuery.isError ? (
                    <BlockError
                      title="Não foi possível carregar os processos"
                      onRetry={() => void recentCasesQuery.refetch()}
                    />
                  ) : recentCasesQuery.data.length === 0 ? (
                    <EmptyState
                      icon={FolderSearch2}
                      title="Nenhum processo cadastrado"
                      description="Cadastre o primeiro processo para acompanhar a operação do escritório."
                      actionLabel="Cadastrar processo"
                      to="/processos"
                      compact
                    />
                  ) : (
                    <ul className="divide-y">
                      {recentCasesQuery.data.map((caseItem) => (
                        <li key={caseItem.id}>
                          <Link
                            to="/processos"
                            className="grid gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                          >
                            <div className="min-w-0">
                              <p className="line-clamp-1 text-sm font-medium">{caseItem.title}</p>
                              <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                                {caseItem.clients?.name || "Cliente não informado"}
                                {caseItem.number ? ` · ${caseItem.number}` : ""}
                                {caseItem.area ? ` · ${humanize(caseItem.area)}` : ""}
                              </p>
                            </div>
                            <StatusPill status={caseItem.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Surface>

              <Surface className="xl:col-span-4">
                <div className="border-b p-5 sm:p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Saúde da carteira
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">Pontos de controle</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Retrato operacional atual, sem filtro de período.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
                  <CompactMetric
                    label="Sem mov. 30d+"
                    value={String(cases?.stale_30d ?? 0)}
                    icon={FileClock}
                    tone={(cases?.stale_30d ?? 0) > 0 ? "warning" : "success"}
                  />
                  <CompactMetric
                    label="Processos críticos"
                    value={String(cases?.critical.value ?? 0)}
                    icon={AlertTriangle}
                    tone={(cases?.critical.value ?? 0) > 0 ? "danger" : "success"}
                  />
                  <CompactMetric
                    label="Concluídos hoje"
                    value={String(agenda?.concluidos_hoje ?? 0)}
                    icon={CheckCircle2}
                    tone="success"
                  />
                  <CompactMetric
                    label="Próximos 7 dias"
                    value={String(agenda?.proximos_7d ?? 0)}
                    icon={CalendarDays}
                    tone="brand"
                  />
                </div>
              </Surface>
            </div>
          </section>

          <details className="group rounded-2xl border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Diagnóstico
                </p>
                <h2 className="mt-1 text-lg font-semibold">Análises complementares</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Distribuição por área, status, responsável e clientes.
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                Explorar
                <ChevronDown className="size-5 transition-transform group-open:rotate-180" />
              </div>
            </summary>

            <div className="border-t p-4 sm:p-6">
              <div className="grid gap-4 xl:grid-cols-3">
                <DistributionChart
                  title="Processos por área"
                  description="Áreas com maior volume atual."
                  data={areaDistribution}
                />
                <DistributionChart
                  title="Processos por status"
                  description="Situação atual da carteira."
                  data={statusDistribution}
                />
                <DistributionChart
                  title="Processos por responsável"
                  description="Distribuição da carga entre a equipe."
                  data={responsibleDistribution}
                />
              </div>

              <div className="mt-4 rounded-xl border bg-background/55 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">Principais clientes</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Receita confirmada acumulada no resumo atual.
                    </p>
                  </div>
                  <Users className="size-5 text-primary" />
                </div>
                {(dashboardMetrics.top_clientes ?? []).length === 0 ? (
                  <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                    Ainda não há receita confirmada por cliente.
                  </p>
                ) : (
                  <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {dashboardMetrics.top_clientes.slice(0, 6).map((client, index) => (
                      <li
                        key={client.id}
                        className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-primary">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-1 text-sm font-medium">{client.name}</p>
                          <p className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                            {fmtBRL(client.total)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}

function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-card shadow-sm", className)}>
      {children}
    </div>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {eyebrow}
      </p>
      <div className="mt-1 flex flex-col gap-1 lg:flex-row lg:items-baseline lg:justify-between">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function SyncStatus({
  kind,
  lastUpdatedAt,
}: {
  kind: "loading" | "ready" | "refreshing" | "stale" | "error";
  lastUpdatedAt: Date | null;
}) {
  const state = {
    loading: {
      label: "Carregando dados",
      className: "bg-muted text-muted-foreground",
      icon: RefreshCw,
      spin: true,
    },
    ready: {
      label: formatUpdatedAt(lastUpdatedAt),
      className: "bg-success/10 text-success",
      icon: CheckCircle2,
      spin: false,
    },
    refreshing: {
      label: "Atualizando indicadores",
      className: "bg-warning/15 text-warning-foreground",
      icon: RefreshCw,
      spin: true,
    },
    stale: {
      label: "Exibindo dados anteriores",
      className: "bg-warning/15 text-warning-foreground",
      icon: AlertTriangle,
      spin: false,
    },
    error: {
      label: "Dados indisponíveis",
      className: "bg-destructive/10 text-destructive",
      icon: AlertCircle,
      spin: false,
    },
  }[kind];

  const Icon = state.icon;
  return (
    <div
      className={cn(
        "flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium",
        state.className,
      )}
      role="status"
      aria-live="polite"
    >
      <Icon className={cn("size-4", state.spin && "animate-spin")} />
      {state.label}
    </div>
  );
}

function DegradedBanner({
  message,
  updatedAt,
  onRetry,
}: {
  message: string;
  updatedAt: Date | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">{message}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{formatUpdatedAt(updatedAt)}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" className="bg-background" onClick={onRetry}>
        <RefreshCw />
        Tentar novamente
      </Button>
    </div>
  );
}

function AttentionCard({
  icon: Icon,
  label,
  value,
  helper,
  to,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  helper: string;
  to: DashboardDestination;
  tone: "brand" | "danger" | "success" | "warning";
}) {
  const tones = {
    brand: "bg-brand-soft text-primary",
    danger: "bg-destructive/10 text-destructive",
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning-foreground",
  };

  return (
    <Link
      to={to}
      className="group rounded-2xl border bg-card p-4 shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${label}: ${value}. ${helper}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("rounded-xl p-2.5", tones[tone])}>
          <Icon className="size-5" />
        </div>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <p className="mt-4 text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-mono text-2xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">{helper}</p>
    </Link>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  helper,
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  helper: string;
  to: DashboardDestination;
}) {
  return (
    <Link
      to={to}
      className="group min-h-36 rounded-2xl border bg-card p-5 shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${label}: ${value}. ${helper}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl bg-brand-soft p-2.5 text-primary">
          <Icon className="size-5" />
        </div>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <p className="mt-4 text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-mono text-[clamp(1.5rem,2.2vw,2rem)] font-semibold leading-tight tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{helper}</p>
    </Link>
  );
}

function CompactMetric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: "brand" | "danger" | "success" | "warning";
}) {
  const tones = {
    brand: "bg-brand-soft text-primary",
    danger: "bg-destructive/10 text-destructive",
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning-foreground",
  };

  return (
    <div className="rounded-xl border bg-background/55 p-4">
      <div className={cn("mb-3 inline-flex rounded-lg p-2", tones[tone])}>
        <Icon className="size-4" />
      </div>
      <p className="font-mono text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className =
    {
      active: "bg-success/10 text-success",
      ativo: "bg-success/10 text-success",
      arquivado: "bg-muted text-muted-foreground",
      concluido: "bg-success/10 text-success",
      encerrado: "bg-muted text-muted-foreground",
      ganho: "bg-success/10 text-success",
      lost: "bg-destructive/10 text-destructive",
      perdido: "bg-destructive/10 text-destructive",
      recurso: "bg-brand-soft text-primary",
      suspenso: "bg-warning/15 text-warning-foreground",
      won: "bg-success/10 text-success",
    }[normalized] ?? "bg-muted text-muted-foreground";

  return (
    <span className={cn("w-fit rounded-full px-2.5 py-1 text-xs font-semibold", className)}>
      {humanize(status)}
    </span>
  );
}

function ChartKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="size-2.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function DistributionChart({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: { name: string; value: number }[];
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="rounded-xl border bg-background/55 p-4 sm:p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {data.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Sem dados suficientes para esta análise.
        </p>
      ) : (
        <>
          <p className="sr-only">
            {title}: {data.map((item) => `${item.name}, ${item.value}`).join("; ")}. Total de{" "}
            {total}.
          </p>
          <ChartContainer config={countChartConfig} className="mt-4 h-[250px] w-full aspect-auto">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 14, bottom: 0, left: 8 }}
            >
              <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
              <XAxis type="number" axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                axisLine={false}
                tickLine={false}
                width={100}
                tick={{ fontSize: 12 }}
              />
              <ChartTooltip
                cursor={{ fill: "var(--brand-soft)" }}
                content={<ChartTooltipContent hideLabel />}
              />
              <Bar
                dataKey="value"
                fill="var(--color-value)"
                radius={[0, 6, 6, 0]}
                maxBarSize={20}
              />
            </BarChart>
          </ChartContainer>
        </>
      )}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  to,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  to: DashboardDestination;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-64 flex-col items-center justify-center px-5 text-center",
        compact && "min-h-52",
      )}
    >
      <div className="rounded-2xl bg-brand-soft p-3 text-primary">
        <Icon className="size-6" />
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
      <Button variant="outline" size="sm" className="mt-4 bg-background" asChild>
        <Link to={to}>{actionLabel}</Link>
      </Button>
    </div>
  );
}

function BlockError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
      <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
        <AlertCircle className="size-6" />
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">Verifique sua conexão e tente novamente.</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCw />
        Tentar novamente
      </Button>
    </div>
  );
}

function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[520px] flex-col items-center justify-center rounded-2xl border bg-card px-6 text-center shadow-sm">
      <div className="rounded-2xl bg-destructive/10 p-4 text-destructive">
        <AlertCircle className="size-8" />
      </div>
      <h2 className="mt-5 text-xl font-semibold">Não foi possível carregar o Dashboard</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        Os dados não foram alterados. Tente novamente; se o problema persistir, verifique a conexão
        com o Supabase.
      </p>
      <Button className="mt-5" onClick={onRetry}>
        <RefreshCw />
        Tentar novamente
      </Button>
    </div>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2 p-1" aria-label="Carregando lista">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl p-3">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-label="Carregando indicadores do Dashboard">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-36 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-40 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-[440px] rounded-2xl xl:col-span-8" />
        <Skeleton className="h-[440px] rounded-2xl xl:col-span-4" />
      </div>
    </div>
  );
}
