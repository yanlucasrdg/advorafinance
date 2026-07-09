import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, TrendingUp, TrendingDown, Wallet, DollarSign, AlertCircle,
  CircleDollarSign, ArrowUpRight, ArrowDownRight, Download, Radio, Sparkles,
  Receipt, ReceiptText, Brain,
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { PageHeader } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useGlobalFilters, PERIOD_LABELS, type PeriodKey } from "@/lib/global-filters";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import {
  financeKpis, revenueByMonth, fmtBRL, fmtBRLCompact, pctDelta,
  type FinRow,
} from "@/lib/metrics";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro — Advora" }] }),
  component: Financeiro,
});

type Entry = FinRow & {
  id: string;
  description: string;
  clients?: { name: string } | null;
};
type CaseLite = { id: string; area: string | null; responsible: string | null };
type ClientLite = { id: string; name: string };

const TOOLTIP_STYLE = {
  background: "#FFFFFF",
  border: "1px solid #E5E7EB",
  borderRadius: 12,
  fontSize: 12,
  color: "#111827",
  boxShadow: "0 8px 24px -8px rgba(17,24,39,0.10)",
  padding: "8px 12px",
};

const PIE_COLORS = ["#5B4CF0", "#7C6BFF", "#16A34A", "#F59E0B", "#DC2626", "#0EA5E9", "#EC4899", "#94A3B8"];

function Financeiro() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const qc = useQueryClient();
  const { filters, setFilter, range } = useGlobalFilters();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ description: "", kind: "receita", amount_cents: 0, status: "pendente", due_date: "", client_id: "", case_id: "" });

  useRealtimeTables(
    ["financial_entries", "cases", "clients"],
    [["fin", "entries", tenantId], ["fin", "cases", tenantId], ["fin", "clients", tenantId]],
  );

  const entriesQ = useQuery({
    queryKey: ["fin", "entries", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_entries")
        .select("id,description,amount_cents,kind,status,due_date,paid_at,client_id,case_id,clients(name)")
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

  const entries = entriesQ.data ?? [];
  const cases = casesQ.data ?? [];
  const clients = clientsQ.data ?? [];
  const loading = entriesQ.isLoading || casesQ.isLoading;

  const caseMap = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  // Apply global filters (area/responsible/client via case join)
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filters.clientId && e.client_id !== filters.clientId) return false;
      if (filters.area || filters.responsible) {
        const c = e.case_id ? caseMap.get(e.case_id) : null;
        if (filters.area && (c?.area ?? "") !== filters.area) return false;
        if (filters.responsible && (c?.responsible ?? "") !== filters.responsible) return false;
      }
      return true;
    });
  }, [entries, filters.area, filters.responsible, filters.clientId, caseMap]);

  const kpis = useMemo(() => financeKpis(filtered), [filtered]);
  const series12 = useMemo(() => revenueByMonth(filtered, 12), [filtered]);

  // Daily flow inside the selected period range
  const dailySeries = useMemo(() => {
    const days: { key: string; label: string; entradas: number; saidas: number; saldo: number }[] = [];
    const start = new Date(range.start); start.setHours(0, 0, 0, 0);
    const end = new Date(range.end); end.setHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      days.push({ key: k, label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), entradas: 0, saidas: 0, saldo: 0 });
    }
    const idx = Object.fromEntries(days.map((d, i) => [d.key, i]));
    filtered.forEach((e) => {
      if (e.status !== "pago" || !e.paid_at) return;
      const k = e.paid_at.slice(0, 10);
      const i = idx[k];
      if (i === undefined) return;
      if (e.kind === "receita") days[i].entradas += e.amount_cents;
      else days[i].saidas += e.amount_cents;
    });
    let running = 0;
    days.forEach((d) => { running += d.entradas - d.saidas; d.saldo = running; });
    return days;
  }, [filtered, range.start, range.end]);

  // Aging of receivables (open)
  const aging = useMemo(() => {
    const buckets = [
      { label: "A vencer", days: [-Infinity, 0], value: 0, color: "#5B4CF0" },
      { label: "1-30d", days: [1, 30], value: 0, color: "#F59E0B" },
      { label: "31-60d", days: [31, 60], value: 0, color: "#F97316" },
      { label: "61-90d", days: [61, 90], value: 0, color: "#EF4444" },
      { label: "90+d", days: [91, Infinity], value: 0, color: "#B91C1C" },
    ];
    const now = new Date();
    filtered.forEach((e) => {
      if (e.kind !== "receita" || e.status === "pago" || !e.due_date) return;
      const diff = Math.floor((now.getTime() - new Date(e.due_date).getTime()) / 86400000);
      const b = buckets.find((b) => diff >= b.days[0] && diff <= b.days[1]);
      if (b) b.value += e.amount_cents;
    });
    return buckets;
  }, [filtered]);

  // Top clients by paid revenue
  const topClients = useMemo(() => {
    const arr = Object.entries(kpis.clientRev).map(([cid, v]) => ({
      name: clientMap.get(cid)?.name ?? "—",
      value: v,
    }));
    arr.sort((a, b) => b.value - a.value);
    return arr.slice(0, 6);
  }, [kpis.clientRev, clientMap]);

  // Revenue by area (via case join, paid receitas)
  const areaSeries = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach((e) => {
      if (e.kind !== "receita" || e.status !== "pago") return;
      const c = e.case_id ? caseMap.get(e.case_id) : null;
      const a = (c?.area ?? "Sem área").trim() || "Sem área";
      m[a] = (m[a] ?? 0) + e.amount_cents;
    });
    return Object.entries(m).map(([area, value]) => ({ area, value })).sort((a, b) => b.value - a.value);
  }, [filtered, caseMap]);

  // Revenue by responsible (attorney)
  const respSeries = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach((e) => {
      if (e.kind !== "receita" || e.status !== "pago") return;
      const c = e.case_id ? caseMap.get(e.case_id) : null;
      const r = (c?.responsible ?? "Sem responsável").trim() || "Sem responsável";
      m[r] = (m[r] ?? 0) + e.amount_cents;
    });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [filtered, caseMap]);

  // Linear projection next 3 months (based on last 6m paid receitas)
  const projection = useMemo(() => {
    const last6 = series12.slice(-6).map((s) => s.receita);
    const n = last6.length;
    if (n < 2) return [] as { label: string; receita: number; projecao: number }[];
    const xs = last6.map((_, i) => i);
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = last6.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - meanX) * (last6[i] - meanY), 0);
    const den = xs.reduce((s, x) => s + (x - meanX) ** 2, 0) || 1;
    const slope = num / den;
    const intercept = meanY - slope * meanX;
    const now = new Date();
    const out: { label: string; receita: number; projecao: number }[] = [];
    series12.slice(-6).forEach((s) => out.push({ label: s.label, receita: s.receita, projecao: 0 }));
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const label = d.toLocaleDateString("pt-BR", { month: "short" }) + `/${String(d.getFullYear()).slice(2)}`;
      out.push({ label, receita: 0, projecao: Math.max(0, intercept + slope * (n - 1 + i)) });
    }
    return out;
  }, [series12]);

  const contasReceber = useMemo(
    () => filtered.filter((e) => e.kind === "receita" && e.status !== "pago").slice(0, 12),
    [filtered],
  );
  const contasPagar = useMemo(
    () => filtered.filter((e) => e.kind === "despesa" && e.status !== "pago").slice(0, 12),
    [filtered],
  );

  const create = async () => {
    if (!form.description.trim() || !tenantId) return;
    const { error } = await supabase.from("financial_entries").insert({
      tenant_id: tenantId,
      description: form.description,
      kind: form.kind,
      amount_cents: form.amount_cents,
      status: form.status,
      due_date: form.due_date || null,
      client_id: form.client_id || null,
      case_id: form.case_id || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Lançamento criado");
    setOpen(false);
    setForm({ description: "", kind: "receita", amount_cents: 0, status: "pendente", due_date: "", client_id: "", case_id: "" });
    qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
  };
  const markPaid = async (e: Entry) => {
    await supabase.from("financial_entries").update({ status: "pago", paid_at: new Date().toISOString() }).eq("id", e.id);
    qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
  };
  const remove = async (id: string) => {
    await supabase.from("financial_entries").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["fin", "entries", tenantId] });
  };

  const exportCSV = () => {
    const header = ["Descrição", "Tipo", "Status", "Valor (R$)", "Vencimento", "Pago em", "Cliente"];
    const rows = filtered.map((e) => [
      e.description.replace(/"/g, '""'),
      e.kind,
      e.status,
      ((e.amount_cents ?? 0) / 100).toFixed(2).replace(".", ","),
      e.due_date ?? "",
      e.paid_at ?? "",
      (e.clients?.name ?? "").replace(/"/g, '""'),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `financeiro_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const areasList = useMemo(() => Array.from(new Set(cases.map((c) => c.area).filter(Boolean) as string[])).sort(), [cases]);
  const respsList = useMemo(() => Array.from(new Set(cases.map((c) => c.responsible).filter(Boolean) as string[])).sort(), [cases]);

  const revDelta = pctDelta(kpis.revMonth, kpis.revPrev);

  const kpiCards = [
    { label: "Receita do mês", value: fmtBRL(kpis.revMonth), delta: `${revDelta >= 0 ? "+" : ""}${revDelta.toFixed(1)}%`, up: revDelta >= 0, icon: TrendingUp, sub: "vs mês anterior" },
    { label: "Despesas do mês", value: fmtBRL(kpis.expMonth), delta: fmtBRLCompact(kpis.expMonth), up: false, icon: TrendingDown, sub: "pagas no mês" },
    { label: "Lucro do mês", value: fmtBRL(kpis.profitMonth), delta: kpis.revMonth ? `${((kpis.profitMonth / kpis.revMonth) * 100).toFixed(0)}% margem` : "—", up: kpis.profitMonth >= 0, icon: DollarSign, sub: "receita − despesa" },
    { label: "A receber", value: fmtBRL(kpis.openReceivable), delta: fmtBRLCompact(kpis.overdueReceivable) + " vencidos", up: kpis.overdueReceivable === 0, icon: Wallet, sub: "em aberto" },
    { label: "A pagar", value: fmtBRL(kpis.openPayable), delta: fmtBRLCompact(kpis.overduePayable) + " vencidos", up: kpis.overduePayable === 0, icon: ReceiptText, sub: "em aberto" },
    { label: "Inadimplência", value: `${kpis.delinquencyPct.toFixed(1)}%`, delta: fmtBRLCompact(kpis.overdueReceivable), up: kpis.delinquencyPct < 5, icon: AlertCircle, sub: "sobre recebíveis" },
    { label: "Ticket médio", value: fmtBRL(kpis.ticketAvg), delta: "YTD", up: true, icon: CircleDollarSign, sub: "receita paga / lançamentos" },
    { label: "Fluxo YTD", value: fmtBRL(kpis.profitYear), delta: kpis.profitYear >= 0 ? "positivo" : "negativo", up: kpis.profitYear >= 0, icon: Sparkles, sub: "acumulado no ano" },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Financeiro"
        subtitle="Receitas, despesas, fluxo de caixa e recebíveis calculados em tempo real."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCSV}><Download className="size-4 mr-1.5" /> CSV</Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="size-4 mr-1" /> Novo lançamento</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Cadastrar lançamento</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <div><Label>Descrição*</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Tipo</Label>
                      <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="receita">Receita</SelectItem><SelectItem value="despesa">Despesa</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><Label>Valor (R$)</Label><Input type="number" value={form.amount_cents / 100} onChange={(e) => setForm({ ...form, amount_cents: Math.round(Number(e.target.value) * 100) })} /></div>
                    <div><Label>Vencimento</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
                  </div>
                  <div>
                    <Label>Cliente</Label>
                    <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                      <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button onClick={create} className="mt-2">Criar</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Realtime + filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
          <span className="size-1.5 rounded-full bg-success animate-pulse-soft" />
          <Radio className="size-3" /> Tempo real
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <Select value={filters.area ?? "__all"} onValueChange={(v) => setFilter("area", v === "__all" ? null : v)}>
            <SelectTrigger className="w-[150px] h-9 text-xs"><SelectValue placeholder="Área" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todas as áreas</SelectItem>
              {areasList.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.responsible ?? "__all"} onValueChange={(v) => setFilter("responsible", v === "__all" ? null : v)}>
            <SelectTrigger className="w-[170px] h-9 text-xs"><SelectValue placeholder="Responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos responsáveis</SelectItem>
              {respsList.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.clientId ?? "__all"} onValueChange={(v) => setFilter("clientId", v === "__all" ? null : v)}>
            <SelectTrigger className="w-[180px] h-9 text-xs"><SelectValue placeholder="Cliente" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos clientes</SelectItem>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">
        {kpiCards.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card p-4 hover-lift min-h-[110px]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{k.label}</p>
                {loading ? (
                  <div className="h-6 w-20 skeleton mt-2" />
                ) : (
                  <p className="text-[18px] font-bold tabular-nums mt-1 truncate">{k.value}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1 truncate">{k.sub}</p>
              </div>
              <div className="size-8 rounded-lg border border-border grid place-items-center text-primary shrink-0">
                <k.icon className="size-4" />
              </div>
            </div>
            <div className={`mt-2 inline-flex items-center gap-0.5 text-[10px] font-semibold ${k.up ? "text-success" : "text-destructive"}`}>
              {k.up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {k.delta}
            </div>
          </div>
        ))}
      </section>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Receita × Despesa — 12 meses</p>
              <p className="text-lg font-bold tabular-nums">{fmtBRL(kpis.rev12)}</p>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" /> Receita</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-destructive" /> Despesa</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={series12}>
              <defs>
                <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5B4CF0" stopOpacity={0.35} /><stop offset="100%" stopColor="#5B4CF0" stopOpacity={0} /></linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#DC2626" stopOpacity={0.3} /><stop offset="100%" stopColor="#DC2626" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="#EEF0F4" vertical={false} />
              <XAxis dataKey="label" stroke="#6B7280" fontSize={10} />
              <YAxis stroke="#6B7280" fontSize={10} tickFormatter={(v) => fmtBRLCompact(v)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtBRL(Number(v))} />
              <Area type="monotone" dataKey="receita" stroke="#5B4CF0" fill="url(#gRev)" strokeWidth={2.5} />
              <Area type="monotone" dataKey="despesa" stroke="#DC2626" fill="url(#gExp)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Aging de recebíveis</p>
          {aging.every((b) => b.value === 0) ? (
            <div className="h-[220px] grid place-items-center text-xs text-muted-foreground">Sem recebíveis em aberto</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={aging} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid stroke="#EEF0F4" horizontal={false} />
                <XAxis type="number" stroke="#6B7280" fontSize={10} tickFormatter={(v) => fmtBRLCompact(v)} />
                <YAxis type="category" dataKey="label" stroke="#6B7280" fontSize={10} width={70} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtBRL(Number(v))} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {aging.map((b, i) => <Cell key={i} fill={b.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts row 2: daily cashflow + projection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Fluxo de caixa — {PERIOD_LABELS[filters.period]}</p>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-success" /> Entradas</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-destructive" /> Saídas</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" /> Saldo</span>
            </div>
          </div>
          {dailySeries.every((d) => d.entradas === 0 && d.saidas === 0) ? (
            <div className="h-[220px] grid place-items-center text-xs text-muted-foreground">Sem movimentações no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={dailySeries}>
                <CartesianGrid stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="label" stroke="#6B7280" fontSize={10} interval="preserveStartEnd" />
                <YAxis stroke="#6B7280" fontSize={10} tickFormatter={(v) => fmtBRLCompact(v)} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtBRL(Number(v))} />
                <Line type="monotone" dataKey="entradas" stroke="#16A34A" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="saidas" stroke="#DC2626" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="saldo" stroke="#5B4CF0" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Projeção — próximos 3 meses</p>
            <Badge variant="outline" className="text-[10px]"><Brain className="size-3 mr-1" /> regressão linear</Badge>
          </div>
          {projection.length === 0 ? (
            <div className="h-[220px] grid place-items-center text-xs text-muted-foreground">Sem histórico suficiente</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={projection}>
                <CartesianGrid stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="label" stroke="#6B7280" fontSize={10} />
                <YAxis stroke="#6B7280" fontSize={10} tickFormatter={(v) => fmtBRLCompact(v)} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtBRL(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="receita" name="Realizado" fill="#5B4CF0" radius={[6, 6, 0, 0]} />
                <Bar dataKey="projecao" name="Projeção" fill="#94A3B8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts row 3: top clients + area + responsavel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Top clientes (YTD)</p>
          {topClients.length === 0 ? (
            <div className="h-[220px] grid place-items-center text-xs text-muted-foreground">Sem receita registrada</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topClients} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid stroke="#EEF0F4" horizontal={false} />
                <XAxis type="number" stroke="#6B7280" fontSize={10} tickFormatter={(v) => fmtBRLCompact(v)} />
                <YAxis type="category" dataKey="name" stroke="#6B7280" fontSize={10} width={110} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtBRL(Number(v))} />
                <Bar dataKey="value" fill="#5B4CF0" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Receita por área</p>
          {areaSeries.length === 0 ? (
            <div className="h-[220px] grid place-items-center text-xs text-muted-foreground">Sem receita por área</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={areaSeries} dataKey="value" nameKey="area" innerRadius={55} outerRadius={90} paddingAngle={2} stroke="none">
                  {areaSeries.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtBRL(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Receita por responsável</p>
          {respSeries.length === 0 ? (
            <div className="h-[220px] grid place-items-center text-xs text-muted-foreground">Sem receita por responsável</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={respSeries}>
                <CartesianGrid stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="name" stroke="#6B7280" fontSize={10} tickFormatter={(v) => v.slice(0, 10)} />
                <YAxis stroke="#6B7280" fontSize={10} tickFormatter={(v) => fmtBRLCompact(v)} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtBRL(Number(v))} />
                <Bar dataKey="value" fill="#7C6BFF" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Contas a Receber + a Pagar */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <EntriesTable
          title="Contas a receber"
          icon={<Receipt className="size-4 text-primary" />}
          rows={contasReceber}
          loading={loading}
          onPay={markPaid}
          onDelete={remove}
          emptyMsg="Nenhum recebível em aberto"
          overdueTone="destructive"
        />
        <EntriesTable
          title="Contas a pagar"
          icon={<ReceiptText className="size-4 text-destructive" />}
          rows={contasPagar}
          loading={loading}
          onPay={markPaid}
          onDelete={remove}
          emptyMsg="Nenhuma despesa em aberto"
          overdueTone="destructive"
        />
      </div>
    </div>
  );
}

function EntriesTable({
  title, icon, rows, loading, onPay, onDelete, emptyMsg,
}: {
  title: string; icon: React.ReactNode; rows: Entry[]; loading: boolean;
  onPay: (e: Entry) => void; onDelete: (id: string) => void; emptyMsg: string;
  overdueTone: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold">{title}</h3>
          <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
        </div>
      </div>
      {loading ? (
        <div className="p-5 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-12" />)}</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground">{emptyMsg}</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b border-border">
            <tr className="text-left text-[10px] uppercase text-muted-foreground">
              <th className="px-5 py-3 font-medium">Descrição</th>
              <th className="px-3 py-3 font-medium">Vencimento</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium text-right">Valor</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const overdue = e.due_date && new Date(e.due_date) < new Date();
              return (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <p className="font-medium truncate">{e.clients?.name ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{e.description}</p>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-xs">{e.due_date ? new Date(e.due_date).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="px-3 py-3">
                    <Badge variant="outline" className={overdue ? "text-destructive border-destructive/40" : ""}>
                      {overdue ? "Vencido" : "A vencer"}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{fmtBRL(e.amount_cents)}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => onPay(e)}>Baixar</Button>
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => onDelete(e.id)}><Trash2 className="size-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
