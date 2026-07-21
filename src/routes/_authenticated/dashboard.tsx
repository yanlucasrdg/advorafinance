import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase, Users, DollarSign, Clock, TrendingUp, TrendingDown,
  ArrowUpRight, Sparkles, Activity, Target, AlertTriangle, CheckCircle2,
  Wallet, Scale, PieChart as PieIcon, CalendarDays, Radio,
} from "lucide-react";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from "recharts";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import { useGlobalFilters, PERIOD_LABELS, type PeriodKey } from "@/lib/global-filters";
import {
  financeKpis, caseKpis, clientKpis, agendaKpis,
  revenueByMonth, pctDelta, fmtBRL, fmtBRLCompact,
  type FinRow, type CaseRow, type ClientRow, type DeadlineRow,
} from "@/lib/metrics";
import { useMetricsDashboard } from "@/hooks/use-metrics";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Centro de Operações — Advora" }] }),
  component: Dashboard,
});

const PIE_COLORS = ["#5B4CF0", "#7C6BFF", "#16A34A", "#F59E0B", "#DC2626", "#0EA5E9", "#8B5CF6", "#EC4899"];
const TOOLTIP_STYLE = {
  background: "#FFFFFF",
  border: "1px solid #E5E7EB",
  borderRadius: 12,
  fontSize: 12,
  color: "#111827",
  boxShadow: "0 8px 24px -8px rgba(17,24,39,0.10)",
  padding: "8px 12px",
};

function Dashboard() {
  const { profile } = useAuth();
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "advogado(a)";
  const tenantId = profile?.tenant_id ?? null;
  const { filters, setFilter } = useGlobalFilters();

  // ---- Queries ----
  const finQ = useQuery({
    queryKey: ["dash", "financial", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_entries")
        .select("amount_cents,kind,status,due_date,paid_at,client_id,case_id");
      if (error) throw error;
      return (data ?? []) as FinRow[];
    },
  });

  const casesQ = useQuery({
    queryKey: ["dash", "cases", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("id,status,area,responsible,value_cents,last_movement_at,distribution_date,created_at,client_id");
      if (error) throw error;
      return (data ?? []) as CaseRow[];
    },
  });

  const clientsQ = useQuery({
    queryKey: ["dash", "clients", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id,type,status,created_at");
      if (error) throw error;
      return (data ?? []) as ClientRow[];
    },
  });

  const deadlinesQ = useQuery({
    queryKey: ["dash", "deadlines", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("deadlines").select("id,due_at,done,kind");
      if (error) throw error;
      return (data ?? []) as DeadlineRow[];
    },
  });

  const upcomingQ = useQuery({
    queryKey: ["dash", "upcoming", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deadlines")
        .select("id, title, due_at, kind, case_id, cases(number)")
        .eq("done", false)
        .gte("due_at", new Date().toISOString())
        .order("due_at", { ascending: true })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as {
        id: string; title: string; due_at: string; kind: string;
        cases: { number: string | null } | null;
      }[];
    },
  });

  const recentQ = useQuery({
    queryKey: ["dash", "recent-cases", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("id, title, number, status, area, client_id, updated_at, clients(name)")
        .order("updated_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as {
        id: string; title: string; number: string | null; status: string; area: string | null;
        clients: { name: string | null } | null;
      }[];
    },
  });

  // Realtime → invalidate all dashboard queries
  useRealtimeTables(
    ["financial_entries", "cases", "clients", "deadlines"],
    [["dash", "financial", tenantId], ["dash", "cases", tenantId], ["dash", "clients", tenantId], ["dash", "deadlines", tenantId], ["dash", "upcoming", tenantId], ["dash", "recent-cases", tenantId]],
  );

  const loading = finQ.isLoading || casesQ.isLoading || clientsQ.isLoading || deadlinesQ.isLoading;

  // ---- Derived ----
  // Server-side aggregates (source of truth for KPIs)
  const { data: dashM } = useMetricsDashboard();
  const fin = useMemo(() => financeKpis(finQ.data ?? []), [finQ.data]);
  const cs = useMemo(() => caseKpis(casesQ.data ?? []), [casesQ.data]);
  const cl = useMemo(() => clientKpis(clientsQ.data ?? []), [clientsQ.data]);
  const ag = useMemo(() => agendaKpis(deadlinesQ.data ?? []), [deadlinesQ.data]);

  const revenue12 = useMemo(() => revenueByMonth(finQ.data ?? [], 12), [finQ.data]);
  const revDelta = pctDelta(dashM?.financeiro.rev_month ?? fin.revMonth, dashM?.financeiro.rev_prev ?? fin.revPrev);


  const areaDist = useMemo(() =>
    Object.entries(cs.byArea)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value })),
    [cs.byArea]);

  const statusDist = useMemo(() =>
    Object.entries(cs.byStatus).map(([name, value]) => ({ name, value })),
    [cs.byStatus]);

  const revByResp = useMemo(() => {
    // aggregate paid revenue by case.responsible using casesQ + finQ
    const caseById = new Map((casesQ.data ?? []).map((c) => [c.id, c]));
    const byResp: Record<string, number> = {};
    (finQ.data ?? []).forEach((r) => {
      if (r.kind !== "receita" || r.status !== "pago" || !r.case_id) return;
      const c = caseById.get(r.case_id);
      const key = c?.responsible?.trim() || "Sem responsável";
      byResp[key] = (byResp[key] ?? 0) + r.amount_cents;
    });
    return Object.entries(byResp)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, cents]) => ({ name, value: cents / 100 }));
  }, [finQ.data, casesQ.data]);

  const topClients = useMemo(() => {
    const map: Record<string, number> = fin.clientRev;
    const clientNames = new Map<string, string>();
    // No client name in finQ; look it up via clientsQ list if present later.
    // Fallback: show ids truncated.
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, cents]) => ({ id, name: clientNames.get(id) ?? id.slice(0, 8), value: cents }));
  }, [fin]);

  // ---- KPI cards (only real data; empty state when zero) ----
  const kpis = [
  const F = dashM?.financeiro;
  const P = dashM?.processos;
  const C = dashM?.clientes;
  const A = dashM?.agenda;
  const kpis = [
    {
      label: "Receita do mês",
      value: fmtBRL(F?.rev_month ?? fin.revMonth),
      delta: revDelta !== null ? `${revDelta >= 0 ? "+" : ""}${revDelta.toFixed(1)}%` : null,
      deltaUp: revDelta !== null ? revDelta >= 0 : undefined,
      sub: "vs mês anterior",
      icon: DollarSign, iconColor: "text-success", iconBg: "bg-success/10",
    },
    {
      label: "Receita YTD",
      value: fmtBRLCompact(F?.rev_year ?? fin.revYear),
      delta: null, sub: "acumulado no ano",
      icon: Wallet, iconColor: "text-primary", iconBg: "bg-primary/10",
    },
    {
      label: "A Receber",
      value: fmtBRL(F?.open_receivable ?? fin.openReceivable),
      delta: (F?.overdue_receivable ?? fin.overdueReceivable) > 0 ? fmtBRLCompact(F?.overdue_receivable ?? fin.overdueReceivable) : "0",
      deltaUp: (F?.overdue_receivable ?? fin.overdueReceivable) === 0,
      sub: "vencido",
      icon: TrendingUp, iconColor: "text-warning", iconBg: "bg-warning/10",
    },
    {
      label: "Inadimplência",
      value: `${(F?.delinquency_pct ?? fin.delinquencyPct).toFixed(1)}%`,
      delta: null, sub: "do a receber",
      icon: AlertTriangle,
      iconColor: (F?.delinquency_pct ?? fin.delinquencyPct) > 20 ? "text-destructive" : "text-warning",
      iconBg: (F?.delinquency_pct ?? fin.delinquencyPct) > 20 ? "bg-destructive/10" : "bg-warning/10",
    },
    {
      label: "Ticket médio",
      value: fmtBRL(F?.ticket_avg ?? fin.ticketAvg),
      delta: null, sub: "receita YTD",
      icon: Target, iconColor: "text-[color:oklch(0.55_0.18_240)]", iconBg: "bg-[oklch(0.55_0.18_240/0.10)]",
    },
    {
      label: "Processos ativos",
      value: String(P?.active.value ?? cs.byStatus.ativo ?? 0),
      delta: (P?.stale_30d ?? cs.stale30) > 0 ? `${P?.stale_30d ?? cs.stale30}` : null,
      deltaUp: (P?.stale_30d ?? cs.stale30) === 0,
      sub: "sem mov. 30d+",
      icon: Briefcase, iconColor: "text-primary", iconBg: "bg-primary/10",
    },
    {
      label: "Valor em causa",
      value: fmtBRLCompact(P?.value_cause.value ?? cs.valueInCause),
      delta: null, sub: `${P ? Object.values(P.by_status).reduce((a,b)=>a+b,0) : cs.total} processos`,
      icon: Scale, iconColor: "text-[color:oklch(0.55_0.15_180)]", iconBg: "bg-[oklch(0.55_0.15_180/0.10)]",
    },
    {
      label: "Clientes",
      value: String(C?.total ?? cl.total),
      delta: (C?.new_month ?? cl.newMonth) ? `+${C?.new_month ?? cl.newMonth}` : "0",
      deltaUp: (C?.new_month ?? cl.newMonth) > 0,
      sub: "novos no mês",
      icon: Users, iconColor: "text-[color:oklch(0.55_0.18_290)]", iconBg: "bg-[oklch(0.55_0.18_290/0.10)]",
    },
    {
      label: "Prazos 7d",
      value: String(A?.proximos_7d ?? ag.next7),
      delta: (A?.atraso ?? ag.overdue) > 0 ? `${A?.atraso ?? ag.overdue}` : null,
      deltaUp: (A?.atraso ?? ag.overdue) === 0,
      sub: "vencidos",
      icon: Clock, iconColor: "text-destructive", iconBg: "bg-destructive/10",
    },
    {
      label: "Concluídos hoje",
      value: String(A?.concluidos_hoje ?? ag.done),
      delta: null, sub: "prazos",
      icon: CheckCircle2, iconColor: "text-success", iconBg: "bg-success/10",
    },
  ];


  const upcoming = upcomingQ.data ?? [];
  const recent = recentQ.data ?? [];

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1440px] mx-auto">
      {/* Hero + Filtros */}
      <header className="flex flex-wrap items-end justify-between gap-6 animate-fade-up">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
            <span className="size-1.5 rounded-full bg-success animate-pulse-soft" />
            <Radio className="size-3" /> Tempo real · {firstName}
          </div>
          <h1 className="text-[28px] sm:text-[32px] leading-[1.1] font-bold tracking-tight mt-2 text-foreground">
            Centro de Operações
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((p) => (
            <button
              key={p}
              onClick={() => setFilter("period", p)}
              className={`px-3 h-8 text-xs font-medium rounded-md transition ${
                filters.period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </header>

      {/* KPIs — grid grande */}
      <section className="stagger grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="group relative overflow-hidden rounded-2xl border border-border bg-card p-4 hover-lift min-h-[110px]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold truncate">{k.label}</p>
                {loading ? (
                  <div className="h-6 w-24 skeleton" />
                ) : (
                  <p className="text-[20px] font-bold tracking-tight tabular-nums truncate leading-none text-foreground">{k.value}</p>
                )}
                {k.delta && (
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
                      k.deltaUp === true ? "text-success bg-success/10" : k.deltaUp === false ? "text-destructive bg-destructive/10" : "text-muted-foreground bg-secondary"
                    }`}>
                      {k.deltaUp === true && <TrendingUp className="size-2.5" />}
                      {k.deltaUp === false && <TrendingDown className="size-2.5" />}
                      {k.delta}
                    </span>
                    <span className="text-muted-foreground truncate">{k.sub}</span>
                  </div>
                )}
                {!k.delta && <div className="text-[10px] text-muted-foreground truncate">{k.sub}</div>}
              </div>
              <div className={`size-8 rounded-lg ${k.iconBg} grid place-items-center shrink-0`}>
                <k.icon className={`size-4 ${k.iconColor}`} strokeWidth={2} />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Analytics: receita 12m + por área */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-[15px] tracking-tight">Receita vs Despesa — 12 meses</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Baseado em pagamentos realizados</p>
            </div>
          </div>
          <div className="h-[240px]">
            {loading ? <div className="h-full skeleton rounded-xl" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenue12.map(b => ({ label: b.label, Receita: b.receita / 100, Despesa: b.despesa / 100 }))} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5B4CF0" stopOpacity={0.4} /><stop offset="100%" stopColor="#5B4CF0" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#DC2626" stopOpacity={0.25} /><stop offset="100%" stopColor="#DC2626" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} width={52} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Area type="monotone" dataKey="Receita" stroke="#5B4CF0" strokeWidth={2.5} fill="url(#rev)" />
                  <Area type="monotone" dataKey="Despesa" stroke="#DC2626" strokeWidth={2} fill="url(#exp)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <h2 className="font-semibold text-[15px] tracking-tight flex items-center gap-2">
            <PieIcon className="size-4 text-primary" /> Processos por área
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">Distribuição atual</p>
          {loading ? <div className="h-[220px] skeleton rounded-xl" /> : areaDist.length === 0 ? (
            <EmptyBlock label="Sem processos cadastrados" />
          ) : (
            <>
              <div className="h-[180px]">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={areaDist} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={3} stroke="#FFFFFF" strokeWidth={2}>
                      {areaDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 mt-2">
                {areaDist.slice(0, 5).map((a, i) => (
                  <li key={a.name} className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-2 text-muted-foreground truncate">
                      <span className="size-2 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="capitalize truncate">{a.name}</span>
                    </span>
                    <span className="tabular-nums font-medium">{a.value}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      {/* Segunda linha: status processos + receita por advogado + clientes PF/PJ */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass rounded-2xl p-5">
          <h2 className="font-semibold text-[15px] tracking-tight">Processos por status</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">Snapshot atual</p>
          {loading ? <div className="h-[180px] skeleton rounded-xl" /> : statusDist.length === 0 ? (
            <EmptyBlock label="Sem processos" />
          ) : (
            <div className="h-[180px]">
              <ResponsiveContainer>
                <BarChart data={statusDist} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#E5E7EB" horizontal={false} />
                  <XAxis type="number" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} width={80} tickFormatter={(v) => String(v).charAt(0).toUpperCase() + String(v).slice(1)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="value" fill="#5B4CF0" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="glass rounded-2xl p-5">
          <h2 className="font-semibold text-[15px] tracking-tight">Receita por advogado</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">Top 6 · YTD</p>
          {loading ? <div className="h-[180px] skeleton rounded-xl" /> : revByResp.length === 0 ? (
            <EmptyBlock label="Sem receita paga vinculada a processos" />
          ) : (
            <div className="h-[180px]">
              <ResponsiveContainer>
                <BarChart data={revByResp} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="name" stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} interval={0} tickFormatter={(v) => String(v).split(" ")[0]} />
                  <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} width={50} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)} />
                  <Bar dataKey="value" fill="#16A34A" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="glass rounded-2xl p-5">
          <h2 className="font-semibold text-[15px] tracking-tight">Clientes</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">Ativos vs inativos · PF vs PJ</p>
          {loading ? <div className="h-[180px] skeleton rounded-xl" /> : cl.total === 0 ? (
            <EmptyBlock label="Sem clientes cadastrados" />
          ) : (
            <div className="grid grid-cols-2 gap-3 h-full">
              <MiniStat label="Ativos" value={cl.active} tone="success" />
              <MiniStat label="Inativos" value={cl.inactive} tone="muted" />
              <MiniStat label="Pessoa Física" value={cl.pf} tone="primary" />
              <MiniStat label="Pessoa Jurídica" value={cl.pj} tone="violet" />
            </div>
          )}
        </div>
      </section>

      {/* Prazos + Processos recentes */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-[15px] tracking-tight flex items-center gap-2"><CalendarDays className="size-4 text-primary" /> Próximos prazos</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Ordenados por vencimento</p>
            </div>
            <Link to="/agenda" className="text-xs text-primary hover:underline inline-flex items-center gap-1">Ver todos <ArrowUpRight className="size-3" /></Link>
          </div>
          {upcomingQ.isLoading ? (
            <ul className="space-y-3">{[...Array(4)].map((_, i) => <li key={i} className="h-14 skeleton" />)}</ul>
          ) : upcoming.length === 0 ? (
            <EmptyBlock label="Sem prazos cadastrados" />
          ) : (
            <ul className="space-y-2">
              {upcoming.map((p) => {
                const d = new Date(p.due_at);
                const hours = (d.getTime() - Date.now()) / 3600000;
                const critical = hours < 48;
                const day = d.toLocaleDateString("pt-BR", { day: "2-digit" });
                const mon = d.toLocaleDateString("pt-BR", { month: "short" }).toUpperCase().replace(".", "");
                return (
                  <li key={p.id} className="row-hover flex items-start gap-4 p-3 rounded-xl border border-transparent hover:border-border/40">
                    <div className={`shrink-0 w-12 h-14 rounded-lg grid place-items-center text-center ${critical ? "bg-destructive/10 border border-destructive/30" : "bg-primary/10 border border-primary/20"}`}>
                      <div>
                        <div className={`text-base font-bold leading-none ${critical ? "text-destructive" : "text-primary"}`}>{day}</div>
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">{mon}</div>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-tight truncate flex items-center gap-2">
                        {p.title}
                        {critical && <AlertTriangle className="size-3 text-destructive shrink-0" />}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {p.cases?.number && <span className="font-mono">{p.cases.number} · </span>}
                        <span className="capitalize">{p.kind}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-[15px] tracking-tight flex items-center gap-2"><Briefcase className="size-4 text-primary" /> Processos recentes</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Últimas atualizações</p>
            </div>
            <Link to="/processos" className="text-xs text-primary hover:underline inline-flex items-center gap-1">Ver todos <ArrowUpRight className="size-3" /></Link>
          </div>
          {recentQ.isLoading ? (
            <ul className="space-y-3">{[...Array(4)].map((_, i) => <li key={i} className="h-14 skeleton" />)}</ul>
          ) : recent.length === 0 ? (
            <EmptyBlock label="Sem processos cadastrados" />
          ) : (
            <ul className="divide-y divide-border/40">
              {recent.map((c) => (
                <li key={c.id} className="row-hover py-3 px-2 -mx-2 first:pt-0 last:pb-0 rounded-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] text-muted-foreground truncate">{c.number ?? "Sem nº"}</div>
                      <div className="text-sm font-medium leading-tight truncate mt-0.5">{c.title}</div>
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {c.clients?.name ?? "—"}{c.area ? ` · ${c.area}` : ""}
                      </div>
                    </div>
                    <StatusPill status={c.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Insights derivados dos dados */}
      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Insights operacionais
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Calculados a partir dos seus dados</p>
          </div>
        </div>
        <div className="stagger grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <InsightCard
            icon={revDelta >= 0 ? TrendingUp : TrendingDown}
            tone={revDelta >= 0 ? "success" : "destructive"}
            title={revDelta >= 0 ? "Receita em crescimento" : "Receita em queda"}
            body={`Receita do mês ${revDelta >= 0 ? "subiu" : "caiu"} ${Math.abs(revDelta).toFixed(1)}% em relação ao mês anterior.`}
          />
          <InsightCard
            icon={AlertTriangle}
            tone={fin.overdueReceivable > 0 ? "destructive" : "success"}
            title="Contas vencidas"
            body={fin.overdueReceivable > 0 ? `${fmtBRL(fin.overdueReceivable)} em títulos vencidos a receber.` : "Nenhum título vencido. Cobrança em dia."}
          />
          <InsightCard
            icon={Clock}
            tone={cs.stale30 > 0 ? "warning" : "success"}
            title="Processos parados"
            body={cs.stale30 > 0 ? `${cs.stale30} processos ativos sem movimentação há 30+ dias.` : "Todos os processos ativos tiveram movimentação recente."}
          />
          <InsightCard
            icon={Activity}
            tone="primary"
            title="Pipeline de prazos"
            body={`${ag.next7} prazos vencem nos próximos 7 dias · ${ag.overdue} vencidos.`}
          />
        </div>

        {topClients.length > 0 && (
          <div className="glass rounded-2xl p-6">
            <h3 className="text-sm font-semibold tracking-tight mb-3">Top clientes por receita paga</h3>
            <ul className="divide-y divide-border/40">
              {topClients.map((c, i) => (
                <li key={c.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="inline-flex items-center gap-3 min-w-0">
                    <span className="size-6 rounded-md bg-primary/10 text-primary text-[11px] font-semibold grid place-items-center">{i + 1}</span>
                    <span className="font-mono text-xs text-muted-foreground truncate">{c.name}</span>
                  </span>
                  <span className="tabular-nums font-semibold">{fmtBRL(c.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="h-[180px] grid place-items-center text-center px-4">
      <div>
        <div className="size-10 rounded-full bg-muted/50 mx-auto grid place-items-center mb-2"><PieIcon className="size-4 text-muted-foreground" /></div>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "success" | "muted" | "primary" | "violet" }) {
  const toneClass = {
    success: "text-success bg-success/10",
    muted: "text-muted-foreground bg-muted/40",
    primary: "text-primary bg-primary/10",
    violet: "text-[color:oklch(0.55_0.18_290)] bg-[oklch(0.55_0.18_290/0.10)]",
  }[tone];
  return (
    <div className={`rounded-xl p-3 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function InsightCard({ icon: Icon, tone, title, body }: { icon: typeof TrendingUp; tone: "success" | "warning" | "destructive" | "primary"; title: string; body: string }) {
  const map = {
    success: "bg-success/10 text-success ring-success/20",
    warning: "bg-warning/10 text-warning ring-warning/20",
    destructive: "bg-destructive/10 text-destructive ring-destructive/20",
    primary: "bg-primary/10 text-primary ring-primary/20",
  }[tone];
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5 hover-lift">
      <div className={`size-9 rounded-lg grid place-items-center mb-3 ring-1 ${map}`}>
        <Icon className="size-4" />
      </div>
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{body}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const map: Record<string, string> = {
    ativo: "bg-success/10 text-success border-success/30",
    encerrado: "bg-muted text-muted-foreground border-border",
    suspenso: "bg-warning/10 text-warning border-warning/30",
    arquivado: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 px-2 h-6 rounded-full text-[10px] font-medium border ${map[s] ?? "bg-secondary text-secondary-foreground border-border"}`}>
      <span className="size-1.5 rounded-full bg-current" />
      <span className="capitalize">{status}</span>
    </span>
  );
}
