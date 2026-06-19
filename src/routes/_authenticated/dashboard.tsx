import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Briefcase, Users, DollarSign, Clock, Sparkles, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/components/data-table-shell";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Legion AI" }] }),
  component: Dashboard,
});

type Stats = {
  revenueMonth: number;
  receivable: number;
  activeCases: number;
  clients: number;
  deadlines7d: number;
  criticalDeadlines: number;
  upcoming: { id: string; title: string; due_at: string; kind: string }[];
  recentCases: { id: string; title: string; number: string | null; status: string }[];
};

function Dashboard() {
  const { profile } = useAuth();
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "advogado(a)";
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!profile?.tenant_id) return;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const in2 = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();

    (async () => {
      const [revenue, receivable, cases, clients, deadlines, critical, upcoming, recent] = await Promise.all([
        supabase.from("financial_entries").select("amount_cents").eq("kind", "receita").eq("status", "pago").gte("paid_at", monthStart),
        supabase.from("financial_entries").select("amount_cents").eq("kind", "receita").eq("status", "pendente"),
        supabase.from("cases").select("id", { count: "exact", head: true }).neq("status", "encerrado"),
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("deadlines").select("id", { count: "exact", head: true }).eq("done", false).lte("due_at", in7).gte("due_at", now.toISOString()),
        supabase.from("deadlines").select("id", { count: "exact", head: true }).eq("done", false).lte("due_at", in2).gte("due_at", now.toISOString()),
        supabase.from("deadlines").select("id, title, due_at, kind").eq("done", false).gte("due_at", now.toISOString()).order("due_at", { ascending: true }).limit(5),
        supabase.from("cases").select("id, title, number, status").order("updated_at", { ascending: false }).limit(5),
      ]);

      setStats({
        revenueMonth: (revenue.data ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0),
        receivable: (receivable.data ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0),
        activeCases: cases.count ?? 0,
        clients: clients.count ?? 0,
        deadlines7d: deadlines.count ?? 0,
        criticalDeadlines: critical.count ?? 0,
        upcoming: (upcoming.data ?? []) as Stats["upcoming"],
        recentCases: (recent.data ?? []) as Stats["recentCases"],
      });
    })();
  }, [profile?.tenant_id]);

  const kpis = [
    { label: "Receita do mês", value: stats ? formatBRL(stats.revenueMonth) : "—", icon: DollarSign, tone: "text-emerald-400" },
    { label: "A receber", value: stats ? formatBRL(stats.receivable) : "—", icon: TrendingUp, tone: "text-amber-400" },
    { label: "Processos ativos", value: stats ? String(stats.activeCases) : "—", icon: Briefcase, tone: "text-primary" },
    { label: "Clientes", value: stats ? String(stats.clients) : "—", icon: Users, tone: "text-primary" },
    { label: "Prazos a vencer (7d)", value: stats ? String(stats.deadlines7d) : "—", delta: stats?.criticalDeadlines ? `${stats.criticalDeadlines} críticos` : "—", icon: Clock, tone: "text-warning" },
  ];

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Dashboard executivo</p>
          <h1 className="text-3xl font-bold tracking-tight mt-1">Olá, {firstName} 👋</h1>
          <p className="text-sm text-muted-foreground mt-1">Visão geral do escritório hoje, {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}.</p>
        </div>
        <Link to="/copiloto" className="glass rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 hover:glow-ring transition-all">
          <Sparkles className="size-4 text-primary" /> Perguntar ao copiloto
        </Link>
      </header>

      <section className="stagger grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map(k => (
          <div key={k.label} className="glass rounded-2xl p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-1 min-w-0">
                <p className="text-xs text-muted-foreground truncate">{k.label}</p>
                <p className="text-xl font-bold tracking-tight tabular-nums truncate">{k.value}</p>
              </div>
              <div className="size-9 rounded-lg bg-primary/10 grid place-items-center shrink-0">
                <k.icon className={`size-4 ${k.tone}`} />
              </div>
            </div>
            {"delta" in k && k.delta && <div className="mt-3 text-xs text-muted-foreground">{k.delta}</div>}
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold">Próximos prazos</h2>
              <p className="text-xs text-muted-foreground">Audiências, protocolos e tarefas</p>
            </div>
            <Link to="/agenda" className="text-xs text-primary hover:underline">Ver agenda</Link>
          </div>
          {stats && stats.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhum prazo cadastrado.</p>
          ) : (
            <ul className="space-y-3">
              {(stats?.upcoming ?? []).map(p => {
                const d = new Date(p.due_at);
                const hours = (d.getTime() - Date.now()) / 3600000;
                const tone = hours < 48 ? "bg-destructive" : hours < 168 ? "bg-warning" : "bg-muted-foreground/40";
                return (
                  <li key={p.id} className="flex items-start gap-3 text-sm">
                    <span className={`mt-1.5 size-2 rounded-full ${tone}`} />
                    <div className="flex-1">
                      <div className="font-medium leading-tight">{p.title}</div>
                      <div className="text-xs text-muted-foreground capitalize">{p.kind} · {d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
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
              <h2 className="font-semibold">Processos recentes</h2>
              <p className="text-xs text-muted-foreground">Últimas movimentações</p>
            </div>
            <Link to="/processos" className="text-xs text-primary hover:underline">Ver todos</Link>
          </div>
          {stats && stats.recentCases.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhum processo cadastrado.</p>
          ) : (
            <ul className="space-y-3">
              {(stats?.recentCases ?? []).map(c => (
                <li key={c.id} className="flex items-start gap-3 text-sm">
                  <Briefcase className="size-4 text-primary mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium leading-tight truncate">{c.title}</div>
                    <div className="text-xs text-muted-foreground">{c.number ?? "Sem nº"} · <span className="capitalize">{c.status}</span></div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
