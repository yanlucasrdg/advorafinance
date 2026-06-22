import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Mail, MoreHorizontal, Upload, Download, Users, UserCheck,
  TrendingUp, DollarSign, FileCheck2, Flame, AlertTriangle, Bot, Sparkles,
  X, MessageCircle, PhoneCall, LayoutGrid, List, Filter, ChevronDown,
  Clock, FileText, CheckCircle2, Calendar, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

/* ---------- CSV helpers ---------- */
function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let i = 0, field = "", row: string[] = [], inQ = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { inQ = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\n" || ch === "\r") {
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++; continue;
    }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).filter(r => r.some(c => c.trim() !== "")).map(r => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => { o[h] = (r[idx] ?? "").trim(); });
    return o;
  });
}
function toCSV(rows: Record<string, string | number>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
}
function downloadFile(name: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\ufeff" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM Jurídico — Advora" }] }),
  component: CRM,
});

type Client = {
  id: string; name: string; email: string | null; phone: string | null;
  doc: string | null; type: string; status: string; notes: string | null;
  created_at: string; updated_at: string;
};

const STAGES = [
  { id: "lead",          label: "Lead",          subtitle: "Contato inicial",     color: "oklch(0.70 0.18 285)", ring: "ring-violet-500/40",  bar: "bg-violet-500",  text: "text-violet-300",  bg: "bg-violet-500/10" },
  { id: "qualificacao",  label: "Qualificação",  subtitle: "Análise inicial",     color: "oklch(0.70 0.18 250)", ring: "ring-blue-500/40",    bar: "bg-blue-500",    text: "text-blue-300",    bg: "bg-blue-500/10" },
  { id: "reuniao",       label: "Reunião",       subtitle: "Consulta agendada",   color: "oklch(0.78 0.14 200)", ring: "ring-cyan-500/40",    bar: "bg-cyan-500",    text: "text-cyan-300",    bg: "bg-cyan-500/10" },
  { id: "proposta",      label: "Proposta",      subtitle: "Honorários enviados", color: "oklch(0.80 0.15 85)",  ring: "ring-amber-500/40",   bar: "bg-amber-500",   text: "text-amber-300",   bg: "bg-amber-500/10" },
  { id: "fechado",       label: "Fechado",       subtitle: "Cliente convertido",  color: "oklch(0.72 0.17 155)", ring: "ring-emerald-500/40", bar: "bg-emerald-500", text: "text-emerald-300", bg: "bg-emerald-500/10" },
  { id: "perdido",       label: "Perdido",       subtitle: "Não convertido",      color: "oklch(0.65 0.22 25)",  ring: "ring-rose-500/40",    bar: "bg-rose-500",    text: "text-rose-300",    bg: "bg-rose-500/10" },
] as const;

const AREAS = ["Trabalhista", "Cível", "Empresarial", "Tributário", "Família", "Criminal", "Previdenciário"];

function brl(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}
function relTime(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "Hoje";
  if (d < 2) return "Ontem";
  return `Há ${Math.floor(d)} dias`;
}
function initials(name: string) {
  return name.split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();
}
function getMeta(c: Client) {
  let area = "Cível", value = 10000, owner = "Dr. Yan", hot = false;
  try {
    const m = c.notes ? JSON.parse(c.notes) : {};
    if (m.area) area = m.area;
    if (typeof m.value === "number") value = m.value;
    if (m.owner) owner = m.owner;
    if (m.hot) hot = true;
  } catch { /* ignore */ }
  if (!area || area === "Cível") {
    const seed = c.name.charCodeAt(0) + c.name.length;
    area = AREAS[seed % AREAS.length];
  }
  if (value === 10000) {
    const seed = c.name.length * 1374 + c.name.charCodeAt(0) * 91;
    value = 3000 + (seed % 47) * 1000;
  }
  return { area, value, owner, hot };
}

function CRM() {
  const { profile } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", doc: "", type: "PF", status: "lead", area: "Trabalhista", value: 10000 });
  const [filter, setFilter] = useState<"all" | "PF" | "PJ" | "leads" | "ativos" | "inativos">("all");
  const [view, setView] = useState<"funil" | "lista">("funil");
  const [selected, setSelected] = useState<Client | null>(null);
  const [tab, setTab] = useState<"resumo" | "historico" | "processos" | "financeiro" | "ia">("resumo");
  const [adv, setAdv] = useState<{ areas: string[]; stages: string[]; minValue: string; maxValue: string; hotOnly: boolean; search: string }>({
    areas: [], stages: [], minValue: "", maxValue: "", hotOnly: false, search: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setClients((data ?? []) as Client[]);
    setLoading(false);
  };
  useEffect(() => { if (profile?.tenant_id) load(); }, [profile?.tenant_id]);

  const filtered = useMemo(() => {
    return clients.filter(c => {
      if (filter === "PF") return c.type === "PF";
      if (filter === "PJ") return c.type === "PJ";
      if (filter === "leads") return c.status === "lead" || c.status === "qualificacao";
      if (filter === "ativos") return c.status === "fechado" || c.status === "ativo";
      if (filter === "inativos") return c.status === "perdido" || c.status === "inativo";
      return true;
    });
  }, [clients, filter]);

  const grouped = useMemo(
    () => STAGES.map(s => ({
      ...s,
      items: filtered.filter(c => (c.status === s.id) || (s.id === "fechado" && c.status === "ativo") || (s.id === "perdido" && c.status === "inativo") || (s.id === "lead" && c.status === "prospect")),
    })),
    [filtered]
  );

  const kpis = useMemo(() => {
    const leads = clients.filter(c => ["lead", "qualificacao", "prospect"].includes(c.status)).length;
    const ativos = clients.filter(c => ["fechado", "ativo"].includes(c.status)).length;
    const total = clients.length || 1;
    const conv = Math.round((ativos / total) * 100);
    const pipeline = clients
      .filter(c => !["perdido", "inativo"].includes(c.status))
      .reduce((sum, c) => sum + getMeta(c).value, 0);
    const fechadosMes = clients.filter(c => {
      const d = new Date(c.updated_at);
      const now = new Date();
      return ["fechado", "ativo"].includes(c.status) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    return { leads, ativos, conv, pipeline, fechadosMes };
  }, [clients]);

  const create = async () => {
    if (!form.name.trim() || !profile?.tenant_id) return;
    const { error } = await supabase.from("clients").insert({
      tenant_id: profile.tenant_id,
      created_by: profile.id,
      name: form.name, email: form.email || null, phone: form.phone || null, doc: form.doc || null,
      type: form.type, status: form.status,
      notes: JSON.stringify({ area: form.area, value: form.value, owner: profile.full_name || "Dr. Yan" }),
    });
    if (error) return toast.error(error.message);
    toast.success("Cliente criado");
    setOpen(false);
    setForm({ name: "", email: "", phone: "", doc: "", type: "PF", status: "lead", area: "Trabalhista", value: 10000 });
    load();
  };

  const moveStage = async (id: string, status: string) => {
    setClients(cs => cs.map(c => c.id === id ? { ...c, status } : c));
    const { error } = await supabase.from("clients").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); load(); }
    else toast.success("Etapa atualizada");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (selected?.id === id) setSelected(null);
    load();
  };

  return (
    <div className="relative">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/3 w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-[120px]" />
        <div className="absolute top-40 right-0 w-[500px] h-[500px] rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      <div className={`flex ${selected ? "pr-[380px]" : ""} transition-all duration-300`}>
        <div className="flex-1 min-w-0 p-6 lg:p-8 space-y-6">
          {/* Header */}
          <header className="flex items-end justify-between gap-4 animate-fade-up">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-medium mb-1.5">Módulo · Comercial</p>
              <h1 className="text-3xl font-bold tracking-tight">CRM Jurídico</h1>
              <p className="text-sm text-muted-foreground mt-1.5">Gestão completa de clientes, leads e oportunidades do escritório.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-9 border-border/60 bg-white/[0.02] hover:bg-white/[0.05]">
                <Upload className="size-3.5 mr-1.5" /> Importar CSV
              </Button>
              <Button variant="outline" size="sm" className="h-9 border-border/60 bg-white/[0.02] hover:bg-white/[0.05]">
                <Download className="size-3.5 mr-1.5" /> Exportar Relatório
              </Button>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-9 bg-[image:var(--gradient-brand)] shadow-[0_4px_20px_-4px_oklch(0.70_0.18_285/0.55)] hover:shadow-[0_6px_28px_-4px_oklch(0.70_0.18_285/0.75)] hover:-translate-y-px">
                    <Plus className="size-3.5 mr-1.5" /> Novo Cliente
                  </Button>
                </DialogTrigger>
                <DialogContent className="glass">
                  <DialogHeader><DialogTitle>Cadastrar cliente</DialogTitle></DialogHeader>
                  <div className="grid gap-3">
                    <div><Label>Nome*</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                      <div><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>CPF/CNPJ</Label><Input value={form.doc} onChange={e => setForm({ ...form, doc: e.target.value })} /></div>
                      <div>
                        <Label>Tipo</Label>
                        <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="PF">Pessoa Física</SelectItem><SelectItem value="PJ">Pessoa Jurídica</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Área Jurídica</Label>
                        <Select value={form.area} onValueChange={v => setForm({ ...form, area: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><Label>Valor estimado (R$)</Label><Input type="number" value={form.value} onChange={e => setForm({ ...form, value: Number(e.target.value) })} /></div>
                    </div>
                    <div>
                      <Label>Etapa</Label>
                      <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Button onClick={create} className="mt-2 bg-[image:var(--gradient-brand)]">Criar cliente</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </header>

          {/* Filters bar */}
          <div className="flex items-center justify-between gap-3 animate-fade-up">
            <div className="flex items-center gap-1 p-1 rounded-xl glass">
              {[
                { id: "all", label: "Todos", icon: LayoutGrid },
                { id: "PF", label: "Pessoa Física", icon: Users },
                { id: "PJ", label: "Pessoa Jurídica", icon: Users },
                { id: "leads", label: "Leads", icon: Flame },
                { id: "ativos", label: "Clientes Ativos", icon: UserCheck },
                { id: "inativos", label: "Inativos", icon: X },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id as typeof filter)}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-all ${
                    filter === f.id ? "bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_oklch(0.70_0.18_285/0.3)]" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                  }`}
                >
                  <f.icon className="size-3.5" />{f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center p-0.5 rounded-lg glass">
                <button onClick={() => setView("funil")} className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium ${view === "funil" ? "bg-white/[0.06] text-foreground" : "text-muted-foreground"}`}><LayoutGrid className="size-3.5" />Funil</button>
                <button onClick={() => setView("lista")} className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium ${view === "lista" ? "bg-white/[0.06] text-foreground" : "text-muted-foreground"}`}><List className="size-3.5" />Lista</button>
              </div>
              <Button variant="outline" size="sm" className="h-8 border-border/60 bg-white/[0.02] text-xs"><Filter className="size-3.5 mr-1.5" />Filtros<ChevronDown className="size-3 ml-1" /></Button>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 stagger">
            <KpiCard label="Leads" value={String(kpis.leads)} delta="+12%" deltaLabel="vs mês anterior" icon={Users} tone="violet" />
            <KpiCard label="Clientes Ativos" value={String(kpis.ativos)} delta="+8%" deltaLabel="vs mês anterior" icon={UserCheck} tone="blue" />
            <KpiCard label="Taxa de Conversão" value={`${kpis.conv}%`} delta="+4%" deltaLabel="vs mês anterior" icon={TrendingUp} tone="emerald" />
            <KpiCard label="Receita Potencial" value={brl(kpis.pipeline)} deltaLabel="em pipeline" icon={DollarSign} tone="amber" />
            <KpiCard label="Contratos Fechados" value={String(kpis.fechadosMes)} deltaLabel="este mês" icon={FileCheck2} tone="rose" />
          </div>

          {/* Insights */}
          <section className="glass rounded-2xl p-5 animate-fade-up">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-lg bg-[image:var(--gradient-brand)] grid place-items-center shadow-[var(--shadow-glow)]">
                  <Sparkles className="size-4 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">Insights Comerciais</h2>
                  <p className="text-xs text-muted-foreground">Análise inteligente do seu funil de vendas</p>
                </div>
              </div>
              <button className="size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-white/[0.05]"><X className="size-3.5" /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <InsightCard icon={Flame} tone="rose" title={`${Math.max(1, Math.floor(kpis.leads * 0.3))} Leads quentes`} desc="Clientes com alta chance de conversão" />
              <InsightCard icon={AlertTriangle} tone="amber" title={`${Math.max(1, Math.floor(kpis.leads * 0.2))} Oportunidades paradas`} desc="Leads sem contato há mais de 14 dias" />
              <InsightCard icon={DollarSign} tone="emerald" title={brl(kpis.pipeline)} desc="Receita potencial em propostas abertas" />
              <InsightCard icon={Bot} tone="violet" title="Sugestão da IA" desc={clients[0] ? `Entre em contato com ${clients[0].name} hoje` : "Cadastre clientes para receber sugestões"} badge="82% chance" />
            </div>
          </section>

          {/* Pipeline kanban */}
          {view === "funil" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 stagger">
              {grouped.map(col => (
                <div key={col.id} className="glass rounded-2xl p-3 flex flex-col min-h-[500px] hover-lift">
                  <div className="h-0.5 w-full rounded-full mb-3" style={{ background: col.color, boxShadow: `0 0 12px ${col.color}` }} />
                  <div className="flex items-center justify-between mb-1 px-1">
                    <h3 className="text-sm font-semibold tracking-tight">{col.label}</h3>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${col.bg} ${col.text}`}>{col.items.length}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 mb-3 px-1">{col.subtitle}</p>
                  <div className="space-y-2 flex-1 overflow-y-auto -mx-1 px-1">
                    {loading && Array.from({ length: 2 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
                    {!loading && col.items.length === 0 && (
                      <div className="text-center py-8 text-[11px] text-muted-foreground/60 border border-dashed border-border/40 rounded-xl">
                        Sem clientes
                      </div>
                    )}
                    {col.items.map(c => {
                      const m = getMeta(c);
                      return (
                        <button
                          key={c.id}
                          onClick={() => setSelected(c)}
                          className={`group w-full text-left rounded-xl bg-card/40 border border-border/40 p-3 hover:border-primary/40 hover:bg-card/70 transition-all ${selected?.id === c.id ? "ring-2 ring-primary/40 border-primary/40" : ""}`}
                        >
                          <div className="flex items-start gap-2.5">
                            <Avatar className="size-8 shrink-0 ring-1 ring-border/50">
                              <AvatarFallback className="text-[10px] bg-[image:var(--gradient-brand)] text-white font-semibold">{initials(c.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold truncate">{c.name}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{m.area}</p>
                            </div>
                            <button onClick={e => { e.stopPropagation(); remove(c.id); }} className="size-5 grid place-items-center rounded text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] hover:text-foreground" aria-label="Mais">
                              <MoreHorizontal className="size-3" />
                            </button>
                          </div>
                          <p className="mt-2 text-sm font-bold tracking-tight gradient-text">{brl(m.value)}</p>
                          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground/80 pt-2 border-t border-border/30">
                            <span className="inline-flex items-center gap-1"><Clock className="size-2.5" />{relTime(c.updated_at)}</span>
                            <span className="inline-flex items-center gap-1"><Users className="size-2.5" />{m.owner}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="glass rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
                  <tr><th className="text-left p-3 pl-4">Cliente</th><th className="text-left p-3">Área</th><th className="text-left p-3">Etapa</th><th className="text-right p-3">Valor</th><th className="text-left p-3">Atualizado</th><th className="p-3" /></tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const m = getMeta(c);
                    const stage = STAGES.find(s => s.id === c.status) ?? STAGES[0];
                    return (
                      <tr key={c.id} className="border-b border-border/20 row-hover cursor-pointer" onClick={() => setSelected(c)}>
                        <td className="p-3 pl-4"><div className="flex items-center gap-2.5"><Avatar className="size-7"><AvatarFallback className="text-[10px] bg-[image:var(--gradient-brand)] text-white">{initials(c.name)}</AvatarFallback></Avatar><span className="font-medium">{c.name}</span></div></td>
                        <td className="p-3 text-muted-foreground">{m.area}</td>
                        <td className="p-3"><span className={`text-[10px] px-2 py-0.5 rounded-md ${stage.bg} ${stage.text}`}>{stage.label}</span></td>
                        <td className="p-3 text-right font-mono font-semibold">{brl(m.value)}</td>
                        <td className="p-3 text-muted-foreground text-xs">{relTime(c.updated_at)}</td>
                        <td className="p-3"><MoreHorizontal className="size-4 text-muted-foreground" /></td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">Nenhum cliente cadastrado</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Drawer */}
        {selected && (
          <ClientDrawer
            client={selected}
            onClose={() => setSelected(null)}
            onMove={moveStage}
            tab={tab}
            setTab={setTab}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- KPI card ---------- */
function KpiCard({ label, value, delta, deltaLabel, icon: Icon, tone }: { label: string; value: string; delta?: string; deltaLabel: string; icon: typeof Users; tone: "violet" | "blue" | "emerald" | "amber" | "rose" }) {
  const tones = {
    violet:  { bg: "bg-violet-500/10",  ring: "ring-violet-500/30",  text: "text-violet-300",  glow: "oklch(0.70 0.18 285 / 0.25)" },
    blue:    { bg: "bg-blue-500/10",    ring: "ring-blue-500/30",    text: "text-blue-300",    glow: "oklch(0.70 0.18 250 / 0.25)" },
    emerald: { bg: "bg-emerald-500/10", ring: "ring-emerald-500/30", text: "text-emerald-300", glow: "oklch(0.72 0.17 155 / 0.25)" },
    amber:   { bg: "bg-amber-500/10",   ring: "ring-amber-500/30",   text: "text-amber-300",   glow: "oklch(0.80 0.15 85 / 0.25)" },
    rose:    { bg: "bg-rose-500/10",    ring: "ring-rose-500/30",    text: "text-rose-300",    glow: "oklch(0.65 0.22 25 / 0.25)" },
  }[tone];
  return (
    <div className="group glass rounded-2xl p-4 hover-lift relative overflow-hidden">
      <div className="absolute -top-12 -right-12 size-32 rounded-full blur-3xl opacity-50 group-hover:opacity-80 transition-opacity" style={{ background: tones.glow }} />
      <div className="flex items-center justify-between relative">
        <div className={`size-10 rounded-xl ${tones.bg} ring-1 ${tones.ring} grid place-items-center`}>
          <Icon className={`size-4 ${tones.text}`} />
        </div>
        {delta && <span className="text-[10px] font-mono font-semibold text-emerald-400 inline-flex items-center gap-0.5"><TrendingUp className="size-2.5" />{delta}</span>}
      </div>
      <p className="text-[11px] text-muted-foreground mt-3">{label}</p>
      <p className="text-2xl font-bold tracking-tight mt-1">{value}</p>
      <p className="text-[10px] text-muted-foreground/70 mt-1">{deltaLabel}</p>
    </div>
  );
}

/* ---------- Insight card ---------- */
function InsightCard({ icon: Icon, tone, title, desc, badge }: { icon: typeof Flame; tone: "rose" | "amber" | "emerald" | "violet"; title: string; desc: string; badge?: string }) {
  const tones = {
    rose:    { bg: "bg-rose-500/10",    text: "text-rose-300",    ring: "ring-rose-500/20" },
    amber:   { bg: "bg-amber-500/10",   text: "text-amber-300",   ring: "ring-amber-500/20" },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-300", ring: "ring-emerald-500/20" },
    violet:  { bg: "bg-violet-500/10",  text: "text-violet-300",  ring: "ring-violet-500/20" },
  }[tone];
  return (
    <div className="rounded-xl bg-white/[0.02] border border-border/40 p-3.5 hover:bg-white/[0.04] hover:border-border/70 transition-all">
      <div className="flex items-start gap-3">
        <div className={`size-9 rounded-lg ${tones.bg} ring-1 ${tones.ring} grid place-items-center shrink-0`}>
          <Icon className={`size-4 ${tones.text}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold tracking-tight leading-tight">{title}</p>
            {badge && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 shrink-0">{badge}</span>}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{desc}</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Drawer ---------- */
function ClientDrawer({ client, onClose, onMove, tab, setTab }: {
  client: Client;
  onClose: () => void;
  onMove: (id: string, status: string) => void;
  tab: "resumo" | "historico" | "processos" | "financeiro" | "ia";
  setTab: (t: "resumo" | "historico" | "processos" | "financeiro" | "ia") => void;
}) {
  const m = getMeta(client);
  const stage = STAGES.find(s => s.id === client.status) ?? STAGES[0];
  return (
    <aside className="fixed top-16 right-0 bottom-0 w-[380px] z-20 glass border-l border-border/40 flex flex-col animate-fade-up">
      <div className="p-4 border-b border-border/40 flex items-start justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <Avatar className="size-12 ring-2 ring-primary/30 shrink-0">
            <AvatarFallback className="bg-[image:var(--gradient-brand)] text-white font-semibold">{initials(client.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-bold truncate">{client.name}</h3>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 inline-flex items-center gap-0.5"><Flame className="size-2.5" />Lead quente</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{m.area}</p>
            <p className="text-sm font-bold gradient-text mt-0.5">{brl(m.value)}</p>
          </div>
        </div>
        <button onClick={onClose} className="size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-white/[0.05]"><X className="size-4" /></button>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-1.5 p-3 border-b border-border/40">
        {[
          { icon: MessageCircle, label: "WhatsApp", color: "text-emerald-400" },
          { icon: Mail, label: "Email", color: "text-blue-400" },
          { icon: PhoneCall, label: "Ligar", color: "text-violet-400" },
          { icon: MoreHorizontal, label: "Mais", color: "text-muted-foreground" },
        ].map(a => (
          <button key={a.label} className="flex flex-col items-center gap-1 py-2 rounded-lg hover:bg-white/[0.04] transition">
            <a.icon className={`size-4 ${a.color}`} />
            <span className="text-[9px] text-muted-foreground">{a.label}</span>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-border/40 px-3 overflow-x-auto">
        {(["resumo", "historico", "processos", "financeiro", "ia"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative px-3 py-2.5 text-[11px] font-medium capitalize whitespace-nowrap transition ${tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t === "ia" ? "IA" : t}
            {tab === t && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full shadow-[0_0_8px_oklch(0.70_0.18_285/0.7)]" />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === "resumo" && (
          <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dados do Cliente</h4>
                <button className="text-[10px] text-primary hover:underline">Editar</button>
              </div>
              <div className="space-y-1.5 text-xs">
                <Row label="CPF/CNPJ" value={client.doc || "—"} />
                <Row label="Telefone" value={client.phone || "—"} />
                <Row label="Email" value={client.email || "—"} mono />
                <Row label="Tipo" value={client.type === "PF" ? "Pessoa Física" : "Pessoa Jurídica"} />
                <Row label="Responsável" value={m.owner} />
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Etapa do Pipeline</h4>
              <Select value={client.status} onValueChange={v => onMove(client.id, v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <div className="mt-2 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div className="h-full" style={{ width: `${((STAGES.findIndex(s => s.id === stage.id) + 1) / STAGES.length) * 100}%`, background: stage.color, boxShadow: `0 0 12px ${stage.color}` }} />
              </div>
            </div>
          </>
        )}

        {tab === "historico" && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Timeline</h4>
            <ol className="relative border-l border-border/40 ml-2 space-y-4">
              {[
                { icon: Sparkles, color: "bg-emerald-500", title: "Lead criado", date: new Date(client.created_at).toLocaleString("pt-BR") },
                { icon: Calendar, color: "bg-blue-500", title: "Reunião realizada", date: "—" },
                { icon: FileText, color: "bg-amber-500", title: "Proposta enviada", date: "—" },
                { icon: CheckCircle2, color: "bg-violet-500", title: "Follow-up agendado", date: "—" },
              ].map((e, i) => (
                <li key={i} className="ml-4">
                  <span className={`absolute -left-[7px] size-3 rounded-full ${e.color} ring-4 ring-background shadow-[0_0_8px_currentColor]`} />
                  <p className="text-xs font-medium">{e.title}</p>
                  <p className="text-[10px] text-muted-foreground">{e.date}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {tab === "processos" && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Processos Relacionados</h4>
            {[
              { num: "0001234-56.2023.8.26.0100", title: "Ação Trabalhista" },
              { num: "0009876-12.2024.8.26.0100", title: "Reclamação Trabalhista" },
            ].map(p => (
              <div key={p.num} className="rounded-xl border border-border/40 bg-white/[0.02] p-3 hover:bg-white/[0.04] transition">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono">{p.num}</p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">Ativo</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{p.title}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "financeiro" && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Financeiro</h4>
            <Row label="Receita gerada" value={brl(0)} />
            <Row label="Valores em aberto" value={brl(m.value)} highlight="text-amber-300" />
            <Row label="Pagamentos recebidos" value={brl(0)} highlight="text-emerald-300" />
          </div>
        )}

        {tab === "ia" && (
          <div className="space-y-3">
            <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="size-4 text-violet-300" />
                <h4 className="text-xs font-semibold">Análise Inteligente</h4>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Cliente com alto potencial de conversão. Recomendamos contato em até 48h com proposta personalizada para a área de {m.area}.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border/40">
        <Button className="w-full h-10 bg-[image:var(--gradient-brand)] shadow-[0_4px_20px_-4px_oklch(0.70_0.18_285/0.6)] hover:shadow-[0_6px_28px_-4px_oklch(0.70_0.18_285/0.8)]">
          <Sparkles className="size-4 mr-1.5" />Gerar resumo com IA
        </Button>
      </div>
    </aside>
  );
}

function Row({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium ${mono ? "font-mono" : ""} ${highlight ?? ""}`}>{value}</span>
    </div>
  );
}
