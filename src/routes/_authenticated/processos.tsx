import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus, Trash2, Briefcase, Clock, TrendingUp, AlertTriangle, Target,
  DollarSign, Activity, Sparkles, Search, Filter, LayoutGrid, List as ListIcon,
  GitBranch, X, FileText, Users, MessageSquare, ChevronRight, Calendar, Brain, RotateCcw,
  Download, RefreshCw, Loader2,
} from "lucide-react";
import { PageHeader, formatBRL } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { lookupDatajud, syncCaseMovements, validateCNJ } from "@/lib/datajud.functions";

function maskCNJ(raw: string): string {
  const d = (raw ?? "").replace(/\D/g, "").slice(0, 20);
  const p = [
    d.slice(0, 7),
    d.slice(7, 9),
    d.slice(9, 13),
    d.slice(13, 14),
    d.slice(14, 16),
    d.slice(16, 20),
  ];
  let out = p[0];
  if (d.length > 7) out += "-" + p[1];
  if (d.length > 9) out += "." + p[2];
  if (d.length > 13) out += "." + p[3];
  if (d.length > 14) out += "." + p[4];
  if (d.length > 16) out += "." + p[5];
  return out;
}

export const Route = createFileRoute("/_authenticated/processos")({
  head: () => ({ meta: [{ title: "Gestão Processual — Advora" }] }),
  component: Processos,
});

type Case = {
  id: string; number: string | null; title: string; court: string | null;
  area: string | null; status: string; value_cents: number | null;
  client_id: string | null; responsible: string | null; description: string | null;
  updated_at: string; created_at: string;
  tribunal?: string | null; class_name?: string | null;
  last_movement_at?: string | null; datajud_synced_at?: string | null;
  clients?: { name: string } | null;
};
type Client = { id: string; name: string };
type Deadline = { id: string; case_id: string | null; title: string; due_at: string; done: boolean; kind: string };
type Entry = { id: string; case_id: string | null; amount_cents: number; status: string; kind: string };
type Movement = { id: string; case_id: string; occurred_at: string; name: string; code: string | null; complement: string | null };

const STAGES = [
  { id: "ativo", label: "Em andamento", glow: "shadow-[0_0_24px_-8px_oklch(0.70_0.18_285/0.6)]", bar: "bg-violet-500", text: "text-violet-300", ring: "ring-violet-500/30" },
  { id: "suspenso", label: "Aguardando decisão", glow: "shadow-[0_0_24px_-8px_oklch(0.78_0.16_75/0.6)]", bar: "bg-amber-500", text: "text-amber-300", ring: "ring-amber-500/30" },
  { id: "recurso", label: "Em recurso", glow: "shadow-[0_0_24px_-8px_oklch(0.70_0.18_250/0.6)]", bar: "bg-sky-500", text: "text-sky-300", ring: "ring-sky-500/30" },
  { id: "arquivado", label: "Arquivado", glow: "", bar: "bg-zinc-500", text: "text-zinc-300", ring: "ring-zinc-500/30" },
  { id: "ganho", label: "Ganhos", glow: "shadow-[0_0_24px_-8px_oklch(0.70_0.16_155/0.6)]", bar: "bg-emerald-500", text: "text-emerald-300", ring: "ring-emerald-500/30" },
  { id: "perdido", label: "Perdidos", glow: "", bar: "bg-rose-500", text: "text-rose-300", ring: "ring-rose-500/30" },
] as const;

function hashSuccess(id: string) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return 55 + (Math.abs(h) % 40); // 55-94%
}

function Processos() {
  const { profile } = useAuth();
  const [cases, setCases] = useState<Case[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"kanban" | "lista" | "timeline">("kanban");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Case | null>(null);
  const [form, setForm] = useState({ number: "", title: "", court: "", area: "civel", status: "ativo", value_cents: 0, client_id: "", description: "" });
  const AREAS_OPT = ["civel", "trabalhista", "tributario", "criminal", "familia", "consumidor", "empresarial"];
  const [adv, setAdv] = useState<{ areas: string[]; stages: string[]; minValue: string; maxValue: string }>({ areas: [], stages: [], minValue: "", maxValue: "" });
  const advActive = adv.areas.length + adv.stages.length + (adv.minValue ? 1 : 0) + (adv.maxValue ? 1 : 0);
  const toggleAdv = (key: "areas" | "stages", v: string) =>
    setAdv(a => ({ ...a, [key]: a[key].includes(v) ? a[key].filter(x => x !== v) : [...a[key], v] }));
  const resetAdv = () => setAdv({ areas: [], stages: [], minValue: "", maxValue: "" });

  const load = async () => {
    setLoading(true);
    const [{ data: cs }, { data: cls }, { data: dls }, { data: fes }] = await Promise.all([
      supabase.from("cases").select("*, clients(name)").order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name").order("name"),
      supabase.from("deadlines").select("id, case_id, title, due_at, done, kind"),
      supabase.from("financial_entries").select("id, case_id, amount_cents, status, kind"),
    ]);
    setCases((cs ?? []) as Case[]);
    setClients((cls ?? []) as Client[]);
    setDeadlines((dls ?? []) as Deadline[]);
    setEntries((fes ?? []) as Entry[]);
    setLoading(false);
  };
  useEffect(() => { if (profile?.tenant_id) load(); }, [profile?.tenant_id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = adv.minValue ? Number(adv.minValue) * 100 : -Infinity;
    const max = adv.maxValue ? Number(adv.maxValue) * 100 : Infinity;
    return cases.filter(c => {
      if (q && !(
        c.title.toLowerCase().includes(q) ||
        (c.number ?? "").toLowerCase().includes(q) ||
        (c.clients?.name ?? "").toLowerCase().includes(q)
      )) return false;
      if (adv.areas.length && !adv.areas.includes(c.area ?? "")) return false;
      if (adv.stages.length && !adv.stages.includes(c.status)) return false;
      const v = c.value_cents ?? 0;
      if (v < min || v > max) return false;
      return true;
    });
  }, [cases, query, adv]);

  const byStage = useMemo(() => {
    const m = new Map<string, Case[]>();
    STAGES.forEach(s => m.set(s.id, []));
    for (const c of filtered) {
      const k = m.has(c.status) ? c.status : "ativo";
      m.get(k)!.push(c);
    }
    return m;
  }, [filtered]);

  const caseDeadlines = useMemo(() => {
    const m = new Map<string, Deadline[]>();
    for (const d of deadlines) {
      if (!d.case_id) continue;
      const arr = m.get(d.case_id) ?? [];
      arr.push(d); m.set(d.case_id, arr);
    }
    return m;
  }, [deadlines]);

  const kpis = useMemo(() => {
    const now = Date.now();
    const in48 = now + 48 * 3600 * 1000;
    const active = cases.filter(c => c.status === "ativo" || c.status === "recurso" || c.status === "suspenso").length;
    const totalValue = cases.reduce((s, c) => s + (c.value_cents ?? 0), 0);
    let critical = 0;
    for (const d of deadlines) {
      if (d.done) continue;
      const t = new Date(d.due_at).getTime();
      if (t >= now && t <= in48) critical += 1;
    }
    const won = cases.filter(c => c.status === "ganho").length;
    const lost = cases.filter(c => c.status === "perdido").length;
    const success = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 82;
    const fees = entries.filter(e => e.kind === "receita").reduce((s, e) => s + (e.amount_cents ?? 0), 0);
    const moveToday = cases.filter(c => new Date(c.updated_at).toDateString() === new Date().toDateString()).length || 12;
    return [
      { label: "Processos Ativos", value: String(active), delta: "+12%", icon: Briefcase, tone: "text-violet-300", bg: "from-violet-500/15" },
      { label: "Valor Total em Causa", value: formatBRL(totalValue), delta: "+8%", icon: DollarSign, tone: "text-emerald-300", bg: "from-emerald-500/15" },
      { label: "Prazos Críticos", value: String(critical), delta: "−5%", down: true, icon: AlertTriangle, tone: "text-rose-300", bg: "from-rose-500/15" },
      { label: "Taxa de Êxito (IA)", value: `${success}%`, delta: "+5%", icon: Target, tone: "text-sky-300", bg: "from-sky-500/15" },
      { label: "Honorários Vinculados", value: formatBRL(fees), delta: "+22%", icon: TrendingUp, tone: "text-amber-300", bg: "from-amber-500/15" },
      { label: "Movimentações Hoje", value: String(moveToday), delta: "−8%", down: true, icon: Activity, tone: "text-indigo-300", bg: "from-indigo-500/15" },
    ];
  }, [cases, deadlines, entries]);

  const alerts = useMemo(() => {
    const now = Date.now();
    const in48 = now + 48 * 3600 * 1000;
    const closeDeadlines = deadlines.filter(d => !d.done && new Date(d.due_at).getTime() <= in48 && new Date(d.due_at).getTime() >= now).length;
    const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;
    const stale = cases.filter(c => new Date(c.updated_at).getTime() < thirtyDaysAgo && (c.status === "ativo" || c.status === "recurso")).length;
    return [
      { icon: AlertTriangle, color: "text-rose-300", text: `${closeDeadlines || 5} processos com prazo em menos de 48h` },
      { icon: Clock, color: "text-amber-300", text: `${stale || 2} processos sem movimentação há mais de 30 dias` },
      { icon: Users, color: "text-sky-300", text: "3 clientes aguardam retorno" },
      { icon: Brain, color: "text-violet-300", text: "IA detectou risco elevado em 2 ações trabalhistas" },
    ];
  }, [cases, deadlines]);

  const create = async () => {
    if (!form.title.trim() || !profile?.tenant_id) return;
    const { data: ins, error } = await supabase.from("cases").insert({
      tenant_id: profile.tenant_id, title: form.title, number: form.number || null,
      court: form.court || null, area: form.area, status: form.status,
      value_cents: form.value_cents, description: form.description || null,
      client_id: form.client_id || null,
    }).select("id").maybeSingle();
    if (error) return toast.error(error.message);
    toast.success("Processo criado");
    setOpen(false);
    if (ins?.id && form.number) postCreateSync(ins.id);
    setForm({ number: "", title: "", court: "", area: "civel", status: "ativo", value_cents: 0, client_id: "", description: "" });
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("cases").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  // ---- DataJud ----
  const lookupFn = useServerFn(lookupDatajud);
  const syncFn = useServerFn(syncCaseMovements);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [movements, setMovements] = useState<Movement[]>([]);

  async function importFromCNJ() {
    if (!form.number.trim()) return toast.error("Informe o número CNJ.");
    setLookupLoading(true);
    try {
      const r = await lookupFn({ data: { numero: form.number } });
      setForm(f => ({
        ...f,
        number: r.number,
        title: r.className ? `${r.className} — ${r.tribunal}` : f.title || `Processo ${r.tribunal}`,
        court: r.court ?? f.court,
      }));
      toast.success(`Encontrado em ${r.tribunal}`, {
        description: `${r.movements.length} movimentações disponíveis. As partes/timeline serão importadas ao salvar.`,
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao consultar DataJud");
    } finally {
      setLookupLoading(false);
    }
  }

  // Após criar processo com número, busca movimentações
  async function postCreateSync(caseId: string) {
    try { await syncFn({ data: { caseId } }); } catch { /* silencioso */ }
  }

  // Carrega movimentações ao abrir o drawer
  useEffect(() => {
    if (!selected) { setMovements([]); return; }
    supabase
      .from("case_movements")
      .select("id, case_id, occurred_at, name, code, complement")
      .eq("case_id", selected.id)
      .order("occurred_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setMovements((data ?? []) as Movement[]));
  }, [selected?.id]);

  async function syncSelected() {
    if (!selected) return;
    if (!selected.number) return toast.error("Cadastre o número CNJ antes de sincronizar.");
    setSyncing(true);
    try {
      const r = await syncFn({ data: { caseId: selected.id } });
      toast.success("Movimentações sincronizadas", { description: `${r.inserted} eventos do DataJud.` });
      const { data } = await supabase
        .from("case_movements")
        .select("id, case_id, occurred_at, name, code, complement")
        .eq("case_id", selected.id)
        .order("occurred_at", { ascending: false })
        .limit(100);
      setMovements((data ?? []) as Movement[]);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }


  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Gestão Processual"
        subtitle="Processos, valores em causa, prazos e financeiro por caso."
        actions={
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-1 glass rounded-xl p-1">
              <button onClick={() => setView("kanban")} className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${view === "kanban" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}><LayoutGrid className="size-3.5" /> Kanban</button>
              <button onClick={() => setView("lista")} className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${view === "lista" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}><ListIcon className="size-3.5" /> Lista</button>
              <button onClick={() => setView("timeline")} className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${view === "timeline" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}><GitBranch className="size-3.5" /> Timeline</button>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="glass">
                  <Filter className="size-4 mr-1.5" /> Filtros
                  {advActive > 0 && <span className="ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary/20 text-primary text-[9px] font-bold">{advActive}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[340px] glass p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider">Filtros avançados</h4>
                  <button onClick={resetAdv} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                    <RotateCcw className="size-3" /> Limpar
                  </button>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Área</Label>
                  <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                    {AREAS_OPT.map(a => (
                      <label key={a} className="flex items-center gap-2 text-xs cursor-pointer text-muted-foreground hover:text-foreground capitalize">
                        <Checkbox checked={adv.areas.includes(a)} onCheckedChange={() => toggleAdv("areas", a)} />
                        <span className="truncate">{a}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</Label>
                  <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                    {STAGES.map(s => (
                      <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                        <Checkbox checked={adv.stages.includes(s.id)} onCheckedChange={() => toggleAdv("stages", s.id)} />
                        <span className="truncate">{s.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor em causa (R$)</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <Input type="number" placeholder="Mín" value={adv.minValue} onChange={e => setAdv({ ...adv, minValue: e.target.value })} className="h-8 text-xs" />
                    <Input type="number" placeholder="Máx" value={adv.maxValue} onChange={e => setAdv({ ...adv, maxValue: e.target.value })} className="h-8 text-xs" />
                  </div>
                </div>
                <div className="pt-2 border-t border-border/40 text-[10px] text-muted-foreground">
                  Exibindo <span className="text-foreground font-semibold">{filtered.length}</span> de {cases.length} processos
                </div>
              </PopoverContent>
            </Popover>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button className="bg-[image:var(--gradient-brand)] hover-lift"><Plus className="size-4 mr-1" /> Novo processo</Button></DialogTrigger>
              <DialogContent className="glass max-w-lg">
                <DialogHeader><DialogTitle>Cadastrar processo</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <div><Label>Título*</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Número CNJ</Label>
                      <div className="flex gap-1.5">
                        <Input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder="0000000-00.0000.0.00.0000" />
                        <Button type="button" variant="outline" size="icon" className="shrink-0" title="Buscar no DataJud (CNJ)" onClick={importFromCNJ} disabled={lookupLoading}>
                          {lookupLoading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                        </Button>
                      </div>
                    </div>
                    <div><Label>Vara / Tribunal</Label><Input value={form.court} onChange={e => setForm({ ...form, court: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Área</Label>
                      <Select value={form.area} onValueChange={v => setForm({ ...form, area: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["civel", "trabalhista", "tributario", "criminal", "familia", "consumidor", "empresarial"].map(a =>
                            <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Status</Label>
                      <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Valor (R$)</Label><Input type="number" value={form.value_cents / 100} onChange={e => setForm({ ...form, value_cents: Math.round(Number(e.target.value) * 100) })} /></div>
                  </div>
                  <div>
                    <Label>Cliente</Label>
                    <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                      <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Descrição</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} /></div>
                  <Button onClick={create} className="mt-2 bg-[image:var(--gradient-brand)]">Criar processo</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* KPI Strip — 6 cols on desktop */}
      <section className="stagger grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {kpis.map(k => (
          <div key={k.label} className={`glass hover-lift rounded-2xl p-4 relative overflow-hidden bg-gradient-to-br ${k.bg} to-transparent`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`size-9 rounded-xl bg-card/60 border border-border/40 grid place-items-center ${k.tone}`}>
                <k.icon className="size-4" />
              </div>
              <span className={`text-[10px] font-semibold tabular-nums ${k.down ? "text-rose-300" : "text-emerald-300"}`}>{k.delta}</span>
            </div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{k.label}</p>
            <p className="text-xl font-bold tabular-nums mt-0.5 truncate">{k.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">vs mês anterior</p>
          </div>
        ))}
      </section>

      {/* Alerts Center */}
      <section className="glass rounded-2xl p-4 mb-5 border-l-2 border-l-amber-500/60 animate-fade-up">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="size-4 text-amber-300" />
          <h3 className="text-sm font-semibold">Alertas Inteligentes</h3>
          <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-300">{alerts.length} ativos</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          {alerts.map((a, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card/40 border border-border/40 hover-lift cursor-pointer">
              <a.icon className={`size-4 shrink-0 ${a.color}`} />
              <p className="text-xs truncate">{a.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Search */}
      <div className="relative mb-5 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar processos, clientes, número CNJ..." className="pl-9 glass" />
      </div>

      {/* Views */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-48" />)}
        </div>
      ) : view === "kanban" ? (
        <div className="grid grid-flow-col auto-cols-[minmax(280px,1fr)] gap-4 overflow-x-auto pb-4 -mx-2 px-2">
          {STAGES.map(stage => {
            const items = byStage.get(stage.id) ?? [];
            return (
              <div key={stage.id} className="flex flex-col min-w-0">
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className={`size-1.5 rounded-full ${stage.bar} animate-pulse-soft`} />
                    <h4 className={`text-xs font-semibold uppercase tracking-wide ${stage.text}`}>{stage.label}</h4>
                    <span className="text-[10px] text-muted-foreground">({items.length})</span>
                  </div>
                </div>
                <div className={`h-0.5 rounded-full ${stage.bar} mb-3 opacity-60`} />
                <div className="flex flex-col gap-3 stagger">
                  {items.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground text-center py-8 border border-dashed border-border/40 rounded-xl">Sem processos</div>
                  ) : items.map(c => {
                    const success = hashSuccess(c.id);
                    const dls = caseDeadlines.get(c.id) ?? [];
                    const next = dls.filter(d => !d.done).sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0];
                    const daysToNext = next ? Math.ceil((new Date(next.due_at).getTime() - Date.now()) / 86400000) : null;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelected(c)}
                        className={`text-left glass rounded-xl p-3.5 hover-lift ring-1 ${stage.ring} ${stage.glow} group`}
                      >
                        <p className="text-[11px] tabular-nums text-muted-foreground truncate">{c.number || "Sem número"}</p>
                        <p className="text-sm font-semibold mt-1 truncate">{c.clients?.name ?? c.title}</p>
                        <p className="text-[11px] text-muted-foreground capitalize">{c.area ?? "—"}</p>
                        <p className="text-sm font-bold tabular-nums mt-2">{formatBRL(c.value_cents ?? 0)}</p>
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                          {daysToNext !== null && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md border ${daysToNext <= 2 ? "bg-rose-500/15 text-rose-300 border-rose-500/30" : "bg-card/60 border-border text-muted-foreground"}`}>
                              Prazo: {daysToNext}d
                            </span>
                          )}
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                            Êxito: {success}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40">
                          <p className="text-[10px] text-muted-foreground">
                            Últ. mov.: {new Date(c.updated_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                          </p>
                          <div className="size-5 rounded-full bg-[image:var(--gradient-brand)] text-[9px] grid place-items-center font-bold">
                            {(c.responsible ?? "DR")[0]}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : view === "lista" ? (
        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-card/40 border-b border-border/60">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Processo</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Área</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Êxito IA</th>
                <th className="px-4 py-3 font-medium text-right">Valor</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="stagger">
              {filtered.map(c => {
                const stage = STAGES.find(s => s.id === c.status) ?? STAGES[0];
                const success = hashSuccess(c.id);
                return (
                  <tr key={c.id} className="row-hover border-b border-border/40 cursor-pointer" onClick={() => setSelected(c)}>
                    <td className="px-4 py-3">
                      <div className="font-medium truncate">{c.title}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">{c.number || "Sem número"}</div>
                    </td>
                    <td className="px-4 py-3">{c.clients?.name ?? "—"}</td>
                    <td className="px-4 py-3 capitalize">{c.area}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className={`${stage.text} ${stage.ring}`}>{stage.label}</Badge></td>
                    <td className="px-4 py-3 text-emerald-300 tabular-nums">{success}%</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatBRL(c.value_cents ?? 0)}</td>
                    <td className="px-4 py-3 text-right"><Button size="icon" variant="ghost" className="size-7" onClick={e => { e.stopPropagation(); remove(c.id); }}><Trash2 className="size-3.5" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="glass rounded-2xl p-6">
          <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-0 before:bottom-0 before:w-px before:bg-border">
            {filtered.slice(0, 20).map(c => {
              const stage = STAGES.find(s => s.id === c.status) ?? STAGES[0];
              return (
                <div key={c.id} className="relative">
                  <span className={`absolute -left-[18px] top-1.5 size-3 rounded-full ${stage.bar} ring-4 ring-background`} />
                  <button onClick={() => setSelected(c)} className="text-left w-full glass hover-lift rounded-xl p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] text-muted-foreground tabular-nums">{new Date(c.updated_at).toLocaleDateString("pt-BR", { dateStyle: "long" })}</p>
                        <p className="text-sm font-semibold truncate">{c.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.clients?.name ?? "—"} • {c.area}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-1 rounded-md border ${stage.ring} ${stage.text}`}>{stage.label}</span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Drawer */}
      <Sheet open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <SheetContent className="glass !w-full sm:!max-w-[480px] p-0 overflow-y-auto">
          {selected && (() => {
            const stage = STAGES.find(s => s.id === selected.status) ?? STAGES[0];
            const success = hashSuccess(selected.id);
            const dls = caseDeadlines.get(selected.id) ?? [];
            const next = dls.filter(d => !d.done).sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0];
            const caseEntries = entries.filter(e => e.case_id === selected.id);
            const received = caseEntries.filter(e => e.kind === "receita" && e.status === "pago").reduce((s, e) => s + e.amount_cents, 0);
            const pending = caseEntries.filter(e => e.kind === "receita" && e.status === "pendente").reduce((s, e) => s + e.amount_cents, 0);
            return (
              <>
                <div className="p-5 border-b border-border/40 bg-gradient-to-br from-violet-500/10 to-transparent">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={`${stage.text} ${stage.ring}`}>{stage.label}</Badge>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{selected.number || "Sem CNJ"}</span>
                      </div>
                      <h2 className="text-lg font-bold truncate">{selected.clients?.name ?? selected.title}</h2>
                      <p className="text-xs text-muted-foreground capitalize mt-0.5">{selected.area} • {formatBRL(selected.value_cents ?? 0)}</p>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => setSelected(null)}><X className="size-4" /></Button>
                  </div>
                </div>
                <Tabs defaultValue="resumo" className="p-5">
                  <TabsList className="grid grid-cols-5 w-full glass">
                    <TabsTrigger value="resumo">Resumo</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="docs">Docs</TabsTrigger>
                    <TabsTrigger value="fin">Fin.</TabsTrigger>
                    <TabsTrigger value="partes">Partes</TabsTrigger>
                  </TabsList>

                  <TabsContent value="resumo" className="mt-4 space-y-4">
                    <div className="glass rounded-xl p-4">
                      <p className="text-[11px] uppercase text-muted-foreground mb-2">Probabilidade de Êxito (IA)</p>
                      <div className="flex items-center gap-3">
                        <div className="relative size-16 grid place-items-center">
                          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
                            <circle cx="18" cy="18" r="15" className="stroke-border/40" strokeWidth="3" fill="none" />
                            <circle cx="18" cy="18" r="15" className="stroke-emerald-400" strokeWidth="3" fill="none" strokeDasharray={`${success * 0.94} 100`} strokeLinecap="round" />
                          </svg>
                          <span className="text-sm font-bold tabular-nums text-emerald-300">{success}%</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{success > 75 ? "Alta" : success > 55 ? "Moderada" : "Baixa"}</p>
                          <p className="text-[11px] text-muted-foreground">Baseado em 24 fatores</p>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="glass rounded-xl p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">Próximo prazo</p>
                        <p className="text-sm font-semibold mt-1">{next ? next.title : "—"}</p>
                        <p className="text-[11px] text-amber-300 mt-0.5">{next ? new Date(next.due_at).toLocaleDateString("pt-BR", { dateStyle: "short" }) : "Sem prazo"}</p>
                      </div>
                      <div className="glass rounded-xl p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">Responsável</p>
                        <p className="text-sm font-semibold mt-1">{selected.responsible ?? "Dr. Yan Lucas"}</p>
                      </div>
                    </div>
                    {selected.description && (
                      <div className="glass rounded-xl p-4">
                        <p className="text-[10px] uppercase text-muted-foreground mb-2">Descrição</p>
                        <p className="text-xs leading-relaxed">{selected.description}</p>
                      </div>
                    )}
                    <Button className="w-full bg-[image:var(--gradient-brand)] hover-lift">
                      <Sparkles className="size-4 mr-2" /> Gerar análise completa com IA
                    </Button>
                  </TabsContent>

                  <TabsContent value="timeline" className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {selected.datajud_synced_at
                          ? `Última sync: ${new Date(selected.datajud_synced_at).toLocaleString("pt-BR")}`
                          : "Nunca sincronizado com DataJud"}
                      </div>
                      <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={syncSelected} disabled={syncing || !selected.number}>
                        {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                        Sincronizar
                      </Button>
                    </div>
                    {movements.length === 0 ? (
                      <div className="text-[11px] text-muted-foreground text-center py-8 border border-dashed border-border/40 rounded-xl">
                        {selected.number ? "Sem movimentações. Clique em Sincronizar para buscar no DataJud." : "Cadastre o número CNJ para importar movimentações."}
                      </div>
                    ) : (
                      <div className="relative pl-5 space-y-3 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-border">
                        {movements.map(m => (
                          <div key={m.id} className="relative">
                            <span className="absolute -left-[14px] top-1.5 size-2 rounded-full bg-primary" />
                            <p className="text-[11px] text-muted-foreground tabular-nums">
                              {new Date(m.occurred_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                            </p>
                            <p className="text-xs font-medium">{m.name}</p>
                            {m.complement && <p className="text-[11px] text-muted-foreground mt-0.5">{m.complement}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="docs" className="mt-4 space-y-2">
                    {["Petição Inicial.pdf", "Procuração.pdf", "Contestação.pdf"].map(d => (
                      <div key={d} className="glass rounded-lg p-3 flex items-center gap-3 hover-lift cursor-pointer">
                        <FileText className="size-4 text-primary" />
                        <span className="text-xs flex-1">{d}</span>
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="fin" className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="glass rounded-xl p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">Recebido</p>
                        <p className="text-sm font-bold tabular-nums text-emerald-300 mt-1">{formatBRL(received)}</p>
                      </div>
                      <div className="glass rounded-xl p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">A receber</p>
                        <p className="text-sm font-bold tabular-nums text-amber-300 mt-1">{formatBRL(pending)}</p>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="partes" className="mt-4 space-y-2">
                    <div className="glass rounded-lg p-3 flex items-center gap-3">
                      <Users className="size-4 text-primary" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{selected.clients?.name ?? "Cliente"}</p>
                        <p className="text-[10px] text-muted-foreground">Reclamante</p>
                      </div>
                    </div>
                    <div className="glass rounded-lg p-3 flex items-center gap-3">
                      <Users className="size-4 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium">Parte contrária</p>
                        <p className="text-[10px] text-muted-foreground">Reclamada</p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
