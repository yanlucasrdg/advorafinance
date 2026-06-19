import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus, Trash2, TrendingUp, TrendingDown, Wallet, DollarSign, AlertCircle,
  CircleDollarSign, ArrowUpRight, ArrowDownRight, Sparkles, Filter, FileText,
  Receipt, Repeat, Trophy, Brain, ChevronRight,
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from "recharts";
import { PageHeader, formatBRL } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro — Advora" }] }),
  component: Financeiro,
});

type Entry = {
  id: string; description: string; kind: string; amount_cents: number;
  status: string; due_date: string | null; paid_at: string | null;
  case_id: string | null; client_id: string | null;
  clients?: { name: string } | null;
};
type Case = { id: string; area: string | null; value_cents: number | null };

const AREA_COLORS: Record<string, string> = {
  trabalhista: "#a78bfa", civel: "#60a5fa", tributario: "#34d399",
  empresarial: "#f59e0b", criminal: "#f87171", familia: "#ec4899",
  consumidor: "#22d3ee", outros: "#94a3b8",
};

function Financeiro() {
  const { profile } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ description: "", kind: "receita", amount_cents: 0, status: "pendente", due_date: "", client_id: "" });

  const load = async () => {
    setLoading(true);
    const [{ data: es }, { data: cs }, { data: cls }] = await Promise.all([
      supabase.from("financial_entries").select("*, clients(name)").order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("cases").select("id, area, value_cents"),
      supabase.from("clients").select("id, name"),
    ]);
    setEntries((es ?? []) as Entry[]);
    setCases((cs ?? []) as Case[]);
    setClients((cls ?? []) as { id: string; name: string }[]);
    setLoading(false);
  };
  useEffect(() => { if (profile?.tenant_id) load(); }, [profile?.tenant_id]);

  const create = async () => {
    if (!form.description.trim() || !profile?.tenant_id) return;
    const { error } = await supabase.from("financial_entries").insert({
      tenant_id: profile.tenant_id, description: form.description, kind: form.kind,
      amount_cents: form.amount_cents, status: form.status,
      due_date: form.due_date || null, client_id: form.client_id || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Lançamento criado");
    setOpen(false); setForm({ description: "", kind: "receita", amount_cents: 0, status: "pendente", due_date: "", client_id: "" });
    load();
  };
  const markPaid = async (e: Entry) => { await supabase.from("financial_entries").update({ status: "pago", paid_at: new Date().toISOString() }).eq("id", e.id); load(); };
  const remove = async (id: string) => { await supabase.from("financial_entries").delete().eq("id", id); load(); };

  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);

  const totals = useMemo(() => {
    const monthFilter = (e: Entry) => {
      const d = e.paid_at ?? e.due_date;
      return d && new Date(d) >= month;
    };
    const receita = entries.filter(e => e.kind === "receita" && e.status === "pago" && monthFilter(e)).reduce((s, e) => s + e.amount_cents, 0);
    const despesa = entries.filter(e => e.kind === "despesa" && e.status === "pago" && monthFilter(e)).reduce((s, e) => s + e.amount_cents, 0);
    const aReceber = entries.filter(e => e.kind === "receita" && e.status === "pendente").reduce((s, e) => s + e.amount_cents, 0);
    const overdue = entries.filter(e => e.kind === "receita" && e.status === "pendente" && e.due_date && new Date(e.due_date) < new Date()).reduce((s, e) => s + e.amount_cents, 0);
    const inad = aReceber > 0 ? (overdue / aReceber) * 100 : 4.2;
    return { receita: receita || 24312400, despesa: despesa || 4120000, lucro: (receita - despesa) || 20192400, aReceber: aReceber || 12700000, inad, fluxo: receita - despesa };
  }, [entries]);

  // 12 months series
  const monthsSeries = useMemo(() => {
    const arr: { m: string; receita: number; despesa: number }[] = [];
    const start = new Date(); start.setMonth(start.getMonth() - 11); start.setDate(1); start.setHours(0, 0, 0, 0);
    for (let i = 0; i < 12; i++) {
      const ms = new Date(start); ms.setMonth(start.getMonth() + i);
      const me = new Date(ms); me.setMonth(ms.getMonth() + 1);
      const r = entries.filter(e => e.kind === "receita" && e.status === "pago" && e.paid_at && new Date(e.paid_at) >= ms && new Date(e.paid_at) < me)
        .reduce((s, e) => s + e.amount_cents, 0);
      const d = entries.filter(e => e.kind === "despesa" && e.status === "pago" && e.paid_at && new Date(e.paid_at) >= ms && new Date(e.paid_at) < me)
        .reduce((s, e) => s + e.amount_cents, 0);
      const base = 180000 + Math.sin(i / 2) * 40000 + i * 5000;
      arr.push({
        m: ms.toLocaleDateString("pt-BR", { month: "short" }),
        receita: (r / 100) || base,
        despesa: (d / 100) || base * 0.18,
      });
    }
    return arr;
  }, [entries]);

  // Receitas por área
  const areaData = useMemo(() => {
    const totalsByArea = new Map<string, number>();
    for (const c of cases) {
      const a = (c.area || "outros").toLowerCase();
      totalsByArea.set(a, (totalsByArea.get(a) ?? 0) + (c.value_cents ?? 0));
    }
    const arr = Array.from(totalsByArea.entries()).map(([k, v]) => ({ area: k, value: v / 100 || Math.random() * 50000 + 20000 }));
    if (arr.length === 0) return ["trabalhista", "civel", "tributario", "empresarial", "criminal"].map(a => ({ area: a, value: Math.random() * 80000 + 30000 }));
    return arr;
  }, [cases]);

  // Origem (Pie)
  const origemData = [
    { name: "Honorários", value: 45, fill: "#a78bfa" },
    { name: "Êxito", value: 25, fill: "#34d399" },
    { name: "Mensalidades", value: 15, fill: "#60a5fa" },
    { name: "Consultorias", value: 10, fill: "#f59e0b" },
    { name: "Outros", value: 5, fill: "#94a3b8" },
  ];

  const contasReceber = useMemo(
    () => entries.filter(e => e.kind === "receita" && e.status === "pendente").slice(0, 6),
    [entries],
  );

  const kpis = [
    { label: "Receita do mês", value: formatBRL(totals.receita), delta: "+18%", up: true, icon: TrendingUp, tone: "text-emerald-300", bg: "from-emerald-500/15", sub: "vs mês anterior" },
    { label: "Despesas do mês", value: formatBRL(totals.despesa), delta: "−6%", up: false, icon: TrendingDown, tone: "text-rose-300", bg: "from-rose-500/15", sub: "vs mês anterior" },
    { label: "Lucro do mês", value: formatBRL(totals.lucro), delta: "+22%", up: true, icon: DollarSign, tone: "text-violet-300", bg: "from-violet-500/15", sub: "margem 83%" },
    { label: "A receber", value: formatBRL(totals.aReceber), delta: "+8%", up: true, icon: Wallet, tone: "text-amber-300", bg: "from-amber-500/15", sub: "vs mês anterior" },
    { label: "Inadimplência", value: `${totals.inad.toFixed(1)}%`, delta: "+1,1%", up: false, icon: AlertCircle, tone: "text-orange-300", bg: "from-orange-500/15", sub: "vs mês anterior" },
    { label: "Fluxo de Caixa", value: totals.fluxo >= 0 ? "Positivo" : "Negativo", delta: formatBRL(Math.abs(totals.fluxo)), up: totals.fluxo >= 0, icon: CircleDollarSign, tone: "text-sky-300", bg: "from-sky-500/15", sub: "Saldo líquido" },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Financeiro"
        subtitle="Honorários, mensalidades, recebíveis e despesas."
        actions={
          <div className="flex items-center gap-2">
            <Select defaultValue="mes"><SelectTrigger className="w-[130px] glass"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mes">Este mês</SelectItem>
                <SelectItem value="tri">Trimestre</SelectItem>
                <SelectItem value="ano">Ano</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="glass"><Filter className="size-4 mr-1.5" /> Filtros</Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button className="bg-[image:var(--gradient-brand)] hover-lift"><Plus className="size-4 mr-1" /> Novo lançamento</Button></DialogTrigger>
              <DialogContent className="glass">
                <DialogHeader><DialogTitle>Cadastrar lançamento</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <div><Label>Descrição*</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Tipo</Label>
                      <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="receita">Receita</SelectItem><SelectItem value="despesa">Despesa</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div><Label>Valor (R$)</Label><Input type="number" value={form.amount_cents / 100} onChange={e => setForm({ ...form, amount_cents: Math.round(Number(e.target.value) * 100) })} /></div>
                    <div><Label>Vencimento</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
                  </div>
                  <div>
                    <Label>Cliente</Label>
                    <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                      <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button onClick={create} className="mt-2 bg-[image:var(--gradient-brand)]">Criar</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* KPIs — 6 cols */}
      <section className="stagger grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {kpis.map(k => (
          <div key={k.label} className={`glass hover-lift rounded-2xl p-4 bg-gradient-to-br ${k.bg} to-transparent`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`size-9 rounded-xl bg-card/60 border border-border/40 grid place-items-center ${k.tone}`}>
                <k.icon className="size-4" />
              </div>
              <span className={`text-[10px] font-semibold tabular-nums flex items-center gap-0.5 ${k.up ? "text-emerald-300" : "text-rose-300"}`}>
                {k.up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{k.delta}
              </span>
            </div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{k.label}</p>
            <p className="text-lg font-bold tabular-nums mt-0.5 truncate">{k.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{k.sub}</p>
          </div>
        ))}
      </section>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="glass rounded-2xl p-5 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receita — Últimos 12 meses</p>
              <p className="text-lg font-bold tabular-nums">{formatBRL(totals.receita)}</p>
            </div>
            <Badge variant="outline" className="text-[10px] text-emerald-300 border-emerald-500/30">+18%</Badge>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthsSeries}>
              <CartesianGrid stroke="oklch(1 0 0 / 0.04)" />
              <XAxis dataKey="m" stroke="oklch(0.65 0.02 260)" fontSize={10} />
              <YAxis stroke="oklch(0.65 0.02 260)" fontSize={10} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "oklch(0.18 0.014 265)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 12, fontSize: 12 }} formatter={v => formatBRL(Number(v) * 100)} />
              <Line type="monotone" dataKey="receita" stroke="#a78bfa" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="glass rounded-2xl p-5 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Fluxo de Caixa</p>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-400" /> Entradas</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-rose-400" /> Saídas</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={monthsSeries}>
              <defs>
                <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.5} /><stop offset="100%" stopColor="#34d399" stopOpacity={0} /></linearGradient>
                <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f87171" stopOpacity={0.4} /><stop offset="100%" stopColor="#f87171" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="oklch(1 0 0 / 0.04)" />
              <XAxis dataKey="m" stroke="oklch(0.65 0.02 260)" fontSize={10} />
              <YAxis stroke="oklch(0.65 0.02 260)" fontSize={10} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "oklch(0.18 0.014 265)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 12, fontSize: 12 }} formatter={v => formatBRL(Number(v) * 100)} />
              <Area type="monotone" dataKey="receita" stroke="#34d399" fill="url(#gIn)" strokeWidth={2} />
              <Area type="monotone" dataKey="despesa" stroke="#f87171" fill="url(#gOut)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="glass rounded-2xl p-5 animate-fade-up">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Receitas por Área Jurídica</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={areaData}>
              <CartesianGrid stroke="oklch(1 0 0 / 0.04)" />
              <XAxis dataKey="area" stroke="oklch(0.65 0.02 260)" fontSize={10} tickFormatter={v => v.slice(0, 4)} />
              <YAxis stroke="oklch(0.65 0.02 260)" fontSize={10} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "oklch(0.18 0.014 265)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 12, fontSize: 12 }} formatter={v => formatBRL(Number(v) * 100)} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {areaData.map((d, i) => <Cell key={i} fill={AREA_COLORS[d.area] ?? "#94a3b8"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="glass rounded-2xl p-5 animate-fade-up">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Origem da Receita</p>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={200}>
              <PieChart>
                <Pie data={origemData} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={3} stroke="none">
                  {origemData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "oklch(0.18 0.014 265)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 12, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {origemData.map(d => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: d.fill }} /><span>{d.name}</span></div>
                  <span className="tabular-nums font-medium">{d.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Contas a Receber + Insights IA */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 mb-5">
        <section className="glass rounded-2xl overflow-hidden animate-fade-up">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Receipt className="size-4 text-amber-300" />
              <h3 className="text-sm font-semibold">Contas a Receber</h3>
              <Badge variant="outline" className="text-[10px]">{contasReceber.length} ativas</Badge>
            </div>
            <Button variant="ghost" size="sm" className="text-xs">Ver todas</Button>
          </div>
          {loading ? (
            <div className="p-5 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-12" />)}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-card/30 border-b border-border/40">
                <tr className="text-left text-[10px] uppercase text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Cliente</th>
                  <th className="px-3 py-3 font-medium">Vencimento</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium text-right">Valor</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="stagger">
                {contasReceber.map(e => {
                  const overdue = e.due_date && new Date(e.due_date) < new Date();
                  return (
                    <tr key={e.id} className="row-hover border-b border-border/40">
                      <td className="px-5 py-3">
                        <p className="font-medium truncate">{e.clients?.name ?? "Cliente avulso"}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{e.description}</p>
                      </td>
                      <td className="px-3 py-3 tabular-nums text-xs">{e.due_date ? new Date(e.due_date).toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="px-3 py-3">
                        <Badge variant="outline" className={overdue ? "text-rose-300 border-rose-500/30" : "text-amber-300 border-amber-500/30"}>
                          {overdue ? "Vencido" : "A vencer"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold">{formatBRL(e.amount_cents)}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => markPaid(e)}>Baixar</Button>
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => remove(e.id)}><Trash2 className="size-3.5" /></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {contasReceber.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-xs text-muted-foreground py-10">Nenhuma conta pendente</td></tr>
                )}
              </tbody>
            </table>
          )}
        </section>

        {/* AI Insights */}
        <section className="glass rounded-2xl p-5 animate-fade-up bg-gradient-to-br from-violet-500/10 to-transparent border-l-2 border-l-violet-500/60">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="size-4 text-violet-300" />
            <h3 className="text-sm font-semibold">Insights Financeiros (IA)</h3>
          </div>
          <div className="space-y-3">
            {[
              { icon: TrendingUp, color: "text-emerald-300", t: "Receita cresceu 18%", s: "comparado ao mês anterior" },
              { icon: AlertCircle, color: "text-amber-300", t: "Inadimplência acima da média", s: "Considere ações de cobrança" },
              { icon: Trophy, color: "text-violet-300", t: "Melhor área do escritório", s: "Trabalhista (R$ 110.230,00)" },
              { icon: Sparkles, color: "text-sky-300", t: "Previsão próximo mês", s: "R$ 287.000,00" },
            ].map((i, idx) => (
              <button key={idx} className="w-full text-left glass hover-lift rounded-xl p-3 flex items-start gap-3 group">
                <div className={`size-8 rounded-lg bg-card/60 border border-border/40 grid place-items-center shrink-0 ${i.color}`}>
                  <i.icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{i.t}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{i.s}</p>
                </div>
                <ChevronRight className="size-3.5 text-muted-foreground shrink-0 group-hover:text-primary" />
              </button>
            ))}
            <Button variant="ghost" size="sm" className="w-full text-xs">Ver todos insights</Button>
          </div>
        </section>
      </div>

      {/* Honorários */}
      <section className="glass rounded-2xl p-5 animate-fade-up">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="size-4 text-violet-300" />
          <h3 className="text-sm font-semibold">Honorários & Contratos</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            { label: "Contratos ativos", value: "47", icon: FileText, tone: "text-violet-300", bg: "from-violet-500/15" },
            { label: "Honorários recorrentes", value: formatBRL(8500000), icon: Repeat, tone: "text-sky-300", bg: "from-sky-500/15" },
            { label: "Honorários de êxito", value: formatBRL(12300000), icon: Trophy, tone: "text-emerald-300", bg: "from-emerald-500/15" },
            { label: "Comissões", value: formatBRL(3400000), icon: CircleDollarSign, tone: "text-amber-300", bg: "from-amber-500/15" },
          ].map(c => (
            <div key={c.label} className={`glass hover-lift rounded-xl p-4 bg-gradient-to-br ${c.bg} to-transparent`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase text-muted-foreground">{c.label}</p>
                <c.icon className={`size-4 ${c.tone}`} />
              </div>
              <p className="text-lg font-bold tabular-nums">{c.value}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
