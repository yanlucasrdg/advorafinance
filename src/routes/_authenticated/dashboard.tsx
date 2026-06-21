import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Briefcase, Users, DollarSign, Clock, TrendingUp, TrendingDown,
  ArrowUpRight, Sparkles, Activity, Target, AlertTriangle, CheckCircle2,
} from "lucide-react";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/components/data-table-shell";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Advora" }] }),
  component: Dashboard,
});

type Stats = {
  revenueMonth: number;
  revenuePrevMonth: number;
  receivable: number;
  receivableCount: number;
  activeCases: number;
  clients: number;
  deadlines7d: number;
  criticalDeadlines: number;
  doneLast7: number;
  upcoming: { id: string; title: string; due_at: string; kind: string; case_number?: string | null }[];
  recentCases: { id: string; title: string; number: string | null; status: string; client_name?: string | null; area?: string | null }[];
  revenue6m: { month: string; value: number }[];
  areaDist: { name: string; value: number }[];
  activity7: { day: string; count: number }[];
};

const monthAbbr = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const dayAbbr = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function pctDelta(curr: number, prev: number) {
  if (!prev) return curr ? 100 : 0;
  return ((curr - prev) / prev) * 100;
}

function Dashboard() {
  const { profile } = useAuth();
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "advogado(a)";
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!profile?.tenant_id) return;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const in7 = new Date(now.getTime() + 7 * 86400000);
    const in2 = new Date(now.getTime() + 2 * 86400000);

    (async () => {
      const [revCurr, revPrev, recv, cases, casesAll, clients, deadlines, critical, doneRecent, upcoming, recent] = await Promise.all([
        supabase.from("financial_entries").select("amount_cents").eq("kind", "receita").eq("status", "pago").gte("paid_at", monthStart.toISOString()),
        supabase.from("financial_entries").select("amount_cents").eq("kind", "receita").eq("status", "pago").gte("paid_at", prevMonthStart.toISOString()).lt("paid_at", monthStart.toISOString()),
        supabase.from("financial_entries").select("amount_cents").eq("kind", "receita").eq("status", "pendente"),
        supabase.from("cases").select("id", { count: "exact", head: true }).neq("status", "encerrado"),
        supabase.from("financial_entries").select("amount_cents, paid_at").eq("kind", "receita").eq("status", "pago").gte("paid_at", sixMonthsAgo.toISOString()),
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("deadlines").select("id", { count: "exact", head: true }).eq("done", false).lte("due_at", in7.toISOString()).gte("due_at", now.toISOString()),
        supabase.from("deadlines").select("id", { count: "exact", head: true }).eq("done", false).lte("due_at", in2.toISOString()).gte("due_at", now.toISOString()),
        supabase.from("deadlines").select("id, updated_at").eq("done", true).gte("updated_at", sevenDaysAgo.toISOString()),
        supabase.from("deadlines").select("id, title, due_at, kind, case_id, cases(number)").eq("done", false).gte("due_at", now.toISOString()).order("due_at", { ascending: true }).limit(5),
        supabase.from("cases").select("id, title, number, status, area, client_id, clients(name)").order("updated_at", { ascending: false }).limit(5),
      ]);

      // 6-month revenue
      const months: Record<string, number> = {};
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months[`${d.getFullYear()}-${d.getMonth()}`] = 0;
      }
      (casesAll.data ?? []).forEach((r: { amount_cents: number; paid_at: string | null }) => {
        if (!r.paid_at) return;
        const d = new Date(r.paid_at);
        const k = `${d.getFullYear()}-${d.getMonth()}`;
        if (k in months) months[k] += r.amount_cents ?? 0;
      });
      const revenue6m = Object.entries(months).map(([k, v]) => {
        const [, m] = k.split("-");
        return { month: monthAbbr[Number(m)], value: v / 100 };
      });

      // Area distribution
      const { data: areaRows } = await supabase.from("cases").select("area").neq("status", "encerrado");
      const areaCount: Record<string, number> = {};
      (areaRows ?? []).forEach((r: { area: string | null }) => {
        const k = r.area || "Outros";
        areaCount[k] = (areaCount[k] ?? 0) + 1;
      });
      const areaDist = Object.entries(areaCount).map(([name, value]) => ({ name, value }));

      // Activity 7d
      const buckets: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        buckets[d.toDateString()] = 0;
      }
      (doneRecent.data ?? []).forEach((r: { updated_at: string }) => {
        const k = new Date(r.updated_at).toDateString();
        if (k in buckets) buckets[k] += 1;
      });
      const activity7 = Object.entries(buckets).map(([k, c]) => ({
        day: dayAbbr[new Date(k).getDay()],
        count: c,
      }));

      setStats({
        revenueMonth: (revCurr.data ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0),
        revenuePrevMonth: (revPrev.data ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0),
        receivable: (recv.data ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0),
        receivableCount: (recv.data ?? []).length,
        activeCases: cases.count ?? 0,
        clients: clients.count ?? 0,
        deadlines7d: deadlines.count ?? 0,
        criticalDeadlines: critical.count ?? 0,
        doneLast7: (doneRecent.data ?? []).length,
        upcoming: (upcoming.data ?? []).map((u: { id: string; title: string; due_at: string; kind: string; cases: { number: string | null } | null }) => ({
          id: u.id, title: u.title, due_at: u.due_at, kind: u.kind,
          case_number: u.cases?.number ?? null,
        })),
        recentCases: (recent.data ?? []).map((c: { id: string; title: string; number: string | null; status: string; area: string | null; clients: { name: string | null } | null }) => ({
          id: c.id, title: c.title, number: c.number, status: c.status, area: c.area,
          client_name: c.clients?.name ?? null,
        })),
        revenue6m,
        areaDist,
        activity7,
      });
    })();
  }, [profile?.tenant_id]);

  const revDelta = useMemo(() => stats ? pctDelta(stats.revenueMonth, stats.revenuePrevMonth) : 0, [stats]);

  const kpis = [
    {
      label: "Receita do mês",
      value: stats ? formatBRL(stats.revenueMonth) : null,
      delta: stats ? `${revDelta >= 0 ? "+" : ""}${revDelta.toFixed(1)}%` : null,
      deltaUp: revDelta >= 0,
      sub: "vs mês anterior",
      icon: DollarSign,
      tint: "from-emerald-500/15 to-emerald-500/0",
      iconColor: "text-emerald-400",
      iconBg: "bg-emerald-500/10",
    },
    {
      label: "A Receber",
      value: stats ? formatBRL(stats.receivable) : null,
      delta: stats ? `${stats.receivableCount}` : null,
      sub: "títulos pendentes",
      icon: TrendingUp,
      tint: "from-amber-500/15 to-amber-500/0",
      iconColor: "text-amber-400",
      iconBg: "bg-amber-500/10",
    },
    {
      label: "Processos Ativos",
      value: stats ? String(stats.activeCases) : null,
      delta: stats ? "+8,2%" : null,
      deltaUp: true,
      sub: "últimos 30 dias",
      icon: Briefcase,
      tint: "from-violet-500/15 to-violet-500/0",
      iconColor: "text-primary",
      iconBg: "bg-primary/10",
    },
    {
      label: "Clientes",
      value: stats ? String(stats.clients) : null,
      delta: stats ? "+5,1%" : null,
      deltaUp: true,
      sub: "novos no mês",
      icon: Users,
      tint: "from-sky-500/15 to-sky-500/0",
      iconColor: "text-sky-400",
      iconBg: "bg-sky-500/10",
    },
    {
      label: "Prazos a vencer",
      value: stats ? String(stats.deadlines7d) : null,
      delta: stats?.criticalDeadlines ? `${stats.criticalDeadlines} críticos` : "—",
      deltaUp: false,
      sub: "próximos 7 dias",
      icon: Clock,
      tint: "from-rose-500/15 to-rose-500/0",
      iconColor: "text-rose-400",
      iconBg: "bg-rose-500/10",
    },
  ];

  const pieColors = ["#7C5CFF", "#4F7CFF", "#00D26A", "#FFB547", "#FF5C5C"];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8 max-w-[1400px] mx-auto">
      {/* Greeting */}
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 text-[10px] sm:text-xs text-muted-foreground uppercase tracking-[0.16em]">
            <span className="relative inline-flex size-2 items-center justify-center">
              <span className="live-ping" />
              <span className="live-dot" />
            </span>
            Sistema operacional
          </div>
          <h1 className="text-[22px] sm:text-[28px] leading-tight font-bold tracking-tight mt-2 truncate">
            Olá, {firstName} <span className="inline-block animate-fade-in-soft">👋</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Você está no controle hoje, {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}.
          </p>
        </div>
      </header>

      {/* KPIs */}
      <section className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        {kpis.map(k => (
          <div key={k.label} className="group relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-5 hover-lift">
            <div className={`absolute inset-0 bg-gradient-to-br ${k.tint} opacity-50 pointer-events-none`} />
            <div className="absolute -top-12 -right-12 size-32 rounded-full bg-primary/5 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{k.label}</p>
                {k.value === null ? (
                  <div className="h-7 w-28 skeleton" />
                ) : (
                  <p className="text-[22px] font-bold tracking-tight tabular-nums truncate leading-none">{k.value}</p>
                )}
                {k.delta && (
                  <div className="flex items-center gap-1.5 text-[11px] pt-1">
                    <span className={`inline-flex items-center gap-0.5 font-medium tabular-nums ${
                      k.deltaUp === true ? "text-emerald-400" : k.deltaUp === false ? "text-rose-400" : "text-muted-foreground"
                    }`}>
                      {k.deltaUp === true && <TrendingUp className="size-3" />}
                      {k.deltaUp === false && <TrendingDown className="size-3" />}
                      {k.delta}
                    </span>
                    <span className="text-muted-foreground">{k.sub}</span>
                  </div>
                )}
              </div>
              <div className={`size-10 rounded-xl ${k.iconBg} grid place-items-center shrink-0 ring-1 ring-white/5`}>
                <k.icon className={`size-[18px] ${k.iconColor}`} />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Próximos Prazos + Processos Recentes */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-up">
        {/* Próximos prazos */}
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-semibold text-[15px] tracking-tight">Próximos Prazos</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Audiências, protocolos e tarefas</p>
            </div>
            <Link to="/agenda" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              Ver todos <ArrowUpRight className="size-3" />
            </Link>
          </div>
          {!stats ? (
            <ul className="space-y-3">{[...Array(4)].map((_, i) => <li key={i} className="h-14 skeleton" />)}</ul>
          ) : stats.upcoming.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="size-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum prazo cadastrado.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {stats.upcoming.map(p => {
                const d = new Date(p.due_at);
                const hours = (d.getTime() - Date.now()) / 3600000;
                const critical = hours < 48;
                const day = d.toLocaleDateString("pt-BR", { day: "2-digit" });
                const mon = d.toLocaleDateString("pt-BR", { month: "short" }).toUpperCase().replace(".", "");
                return (
                  <li key={p.id} className="row-hover flex items-start gap-4 p-3 rounded-xl border border-transparent hover:border-border/40">
                    <div className={`shrink-0 w-12 h-14 rounded-lg grid place-items-center text-center ${critical ? "bg-rose-500/10 border border-rose-500/30" : "bg-primary/10 border border-primary/20"}`}>
                      <div>
                        <div className={`text-base font-bold leading-none ${critical ? "text-rose-400" : "text-primary"}`}>{day}</div>
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">{mon}</div>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-tight truncate flex items-center gap-2">
                        {p.title}
                        {critical && <AlertTriangle className="size-3 text-rose-400 animate-pulse-soft shrink-0" />}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {p.case_number && <span className="font-mono">{p.case_number} · </span>}
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

        {/* Processos Recentes */}
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-semibold text-[15px] tracking-tight">Processos Recentes</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Últimas movimentações</p>
            </div>
            <Link to="/processos" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              Ver todos <ArrowUpRight className="size-3" />
            </Link>
          </div>
          {!stats ? (
            <ul className="space-y-3">{[...Array(4)].map((_, i) => <li key={i} className="h-14 skeleton" />)}</ul>
          ) : stats.recentCases.length === 0 ? (
            <div className="py-10 text-center">
              <Briefcase className="size-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum processo cadastrado.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {stats.recentCases.map(c => (
                <li key={c.id} className="row-hover py-3 px-2 -mx-2 first:pt-0 last:pb-0 rounded-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] text-muted-foreground truncate">{c.number ?? "Sem nº"}</div>
                      <div className="text-sm font-medium leading-tight truncate mt-0.5">{c.title}</div>
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {c.client_name ?? "—"}{c.area ? ` · ${c.area}` : ""}
                      </div>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1 px-2 h-6 rounded-full text-[10px] font-medium border ${
                      c.status === "ativo"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : c.status === "encerrado"
                        ? "bg-muted text-muted-foreground border-border"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    }`}>
                      <span className="size-1.5 rounded-full bg-current" />
                      <span className="capitalize">{c.status}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Analytics */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-up">
        {/* Revenue 6m */}
        <div className="glass rounded-2xl p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-[15px] tracking-tight">Receita dos últimos 6 meses</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Acompanhamento mensal</p>
            </div>
            <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" /> Receita</span>
            </div>
          </div>
          <div className="h-[220px] sm:h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats?.revenue6m ?? []} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7C5CFF" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#7C5CFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="oklch(1 0 0 / 0.05)" vertical={false} />
                <XAxis dataKey="month" stroke="oklch(0.65 0.02 260)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.65 0.02 260)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} width={48} />
                <Tooltip
                  contentStyle={{ background: "oklch(0.18 0.014 265)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12, padding: "8px 12px" }}
                  labelStyle={{ color: "oklch(0.7 0.02 260)", marginBottom: 4 }}
                  formatter={(v: number) => [new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v), "Receita"]}
                  cursor={{ stroke: "oklch(0.70 0.18 285 / 0.4)", strokeWidth: 1, strokeDasharray: "3 3" }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#7C5CFF"
                  strokeWidth={2.5}
                  fill="url(#revGrad)"
                  dot={{ r: 3, fill: "#7C5CFF", strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: "#7C5CFF", stroke: "oklch(0.18 0.014 265)", strokeWidth: 3 }}
                  isAnimationActive
                  animationDuration={1100}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Area distribution */}
        <div className="glass rounded-2xl p-6">
          <h2 className="font-semibold text-[15px] tracking-tight">Distribuição por Área</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-4">Processos ativos</p>
          {!stats || stats.areaDist.length === 0 ? (
            <div className="h-[240px] grid place-items-center text-sm text-muted-foreground">
              {stats ? "Sem dados" : <div className="size-32 rounded-full skeleton" />}
            </div>
          ) : (
            <>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stats.areaDist}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={70}
                      paddingAngle={3}
                      stroke="oklch(0.16 0.012 265)"
                      strokeWidth={2}
                      isAnimationActive
                      animationDuration={900}
                      animationEasing="ease-out"
                    >
                      {stats.areaDist.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "oklch(0.18 0.014 265)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 mt-2">
                {stats.areaDist.slice(0, 4).map((a, i) => (
                  <li key={a.name} className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <span className="size-2 rounded-sm" style={{ background: pieColors[i % pieColors.length] }} />
                      <span className="capitalize">{a.name}</span>
                    </span>
                    <span className="tabular-nums font-medium">{a.value}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Activity 7d */}
        <div className="glass rounded-2xl p-6 lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-[15px] tracking-tight">Atividades Concluídas</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Últimos 7 dias</p>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              Total: <span className="font-semibold text-foreground">{stats?.doneLast7 ?? 0}</span>
            </div>
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.activity7 ?? []} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4F7CFF" stopOpacity={1} />
                    <stop offset="100%" stopColor="#7C5CFF" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="oklch(1 0 0 / 0.04)" vertical={false} />
                <XAxis dataKey="day" stroke="oklch(0.65 0.02 260)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.65 0.02 260)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                  contentStyle={{ background: "oklch(0.18 0.014 265)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 12, fontSize: 12 }}
                />
                <Bar dataKey="count" fill="url(#barGrad)" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={900} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Insights */}
      <section className="space-y-4 animate-fade-up">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Insights Inteligentes
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Com base nos seus dados dos últimos 30 dias</p>
          </div>
        </div>
        <div className="stagger grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: TrendingUp, bg: "bg-emerald-500/10", ring: "ring-emerald-500/20", fg: "text-emerald-400", title: "Receita em crescimento", body: stats ? `Sua receita ${revDelta >= 0 ? "cresceu" : "caiu"} ${Math.abs(revDelta).toFixed(1)}% comparado ao mês anterior.` : "Calculando…" },
            { icon: Clock, bg: "bg-amber-500/10", ring: "ring-amber-500/20", fg: "text-amber-400", title: "Prazos próximos", body: stats ? `Você tem ${stats.deadlines7d} prazos vencendo nos próximos 7 dias.` : "Calculando…" },
            { icon: Activity, bg: "bg-violet-500/10", ring: "ring-violet-500/20", fg: "text-violet-400", title: "Produtividade", body: stats ? `Você concluiu ${stats.doneLast7} atividades nos últimos 7 dias.` : "Calculando…" },
            { icon: Target, bg: "bg-sky-500/10", ring: "ring-sky-500/20", fg: "text-sky-400", title: "Clientes ativos", body: stats ? `Você possui ${stats.clients} clientes ativos no sistema.` : "Calculando…" },
          ].map(i => (
            <div key={i.title} className="group relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-5 hover-lift">
              <div className={`size-9 rounded-lg grid place-items-center mb-3 ring-1 ${i.bg} ${i.ring}`}>
                <i.icon className={`size-4 ${i.fg}`} />
              </div>
              <div className="text-sm font-semibold tracking-tight">{i.title}</div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{i.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
