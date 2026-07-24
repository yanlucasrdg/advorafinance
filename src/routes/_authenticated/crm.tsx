import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Plus, Mail, MoreHorizontal, Upload, Download, Users, UserCheck,
  TrendingUp, DollarSign, FileCheck2, Flame, AlertTriangle, Bot, Sparkles,
  X, MessageCircle, PhoneCall, LayoutGrid, List, Filter, ChevronDown,
  Clock, FileText, CheckCircle2, Calendar, RotateCcw, Edit2, Save,
  StickyNote, Phone, Building2, MapPin, Star, StarOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useMetricsCrm } from "@/hooks/use-metrics";
import { useClients, STAGES, stageOf, Client, LEGACY_STAGE_MAP } from "@/hooks/use-clients";
import { consumeCommandIntent } from "@/lib/command-intent";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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



type Activity = {
  id: string; client_id: string; user_id: string | null;
  kind: string; title: string; body: string | null;
  meta: Record<string, unknown> | null; created_at: string;
  profiles?: { full_name: string | null; avatar_url: string | null } | null;
};

const AREAS = ["Trabalhista", "Cível", "Empresarial", "Tributário", "Família", "Criminal", "Previdenciário"];

const ACTIVITY_KINDS = [
  { id: "note",     label: "Nota",     icon: StickyNote },
  { id: "call",     label: "Ligação",  icon: Phone },
  { id: "email",    label: "E-mail",   icon: Mail },
  { id: "meeting",  label: "Reunião",  icon: Calendar },
] as const;

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
function leadCode(client: Client) {
  return `ADV-${client.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
function clientValue(c: Client): number {
  return (c.value_cents ?? 0) / 100;
}

function CRM() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { clients, isLoading: loading, create, update, remove, moveStage, toggleHot } = useClients();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string | number>>({
    name: "", email: "", phone: "", doc: "", type: "PF",
    status: "novo_contato", area: "Trabalhista", value: 10000,
    owner: "", address: "", city: "", state: "",
  });
  const [filter, setFilter] = useState<"all" | "PF" | "PJ" | "leads" | "ativos" | "inativos">("all");
  const [view, setView] = useState<"funil" | "lista">("funil");
  const [selected, setSelected] = useState<Client | null>(null);
  const [tab, setTab] = useState<"resumo" | "historico" | "processos" | "financeiro" | "ia">("resumo");
  const [adv, setAdv] = useState<{ areas: string[]; stages: string[]; minValue: string; maxValue: string; hotOnly: boolean; search: string }>({
    areas: [], stages: [], minValue: "", maxValue: "", hotOnly: false, search: "",
  });
  const [dragOver, setDragOver] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    if (loading) return;
    const intent = consumeCommandIntent();
    if (!intent) return;
    if (intent.type === "create-client") { setOpen(true); return; }
    if (intent.type === "open-client") {
      const client = clients.find(item => item.id === intent.id);
      if (client) { setSelected(client); setTab("resumo"); }
    }
  }, [loading, clients]);

  const filtered = useMemo(() => {
    const min = adv.minValue ? Number(adv.minValue) * 100 : -Infinity;
    const max = adv.maxValue ? Number(adv.maxValue) * 100 : Infinity;
    const q = adv.search.trim().toLowerCase();
    return clients.filter(c => {
      if (filter === "PF" && c.type !== "PF") return false;
      if (filter === "PJ" && c.type !== "PJ") return false;
      if (filter === "leads" && !["novo_contato", "triagem"].includes(stageOf(c.status))) return false;
      if (filter === "ativos" && !["contrato", "em_andamento"].includes(stageOf(c.status))) return false;
      if (filter === "inativos" && stageOf(c.status) !== "encerrado") return false;
      if (adv.areas.length && !adv.areas.includes(c.area ?? "")) return false;
      if (adv.stages.length && !adv.stages.includes(c.status)) return false;
      const v = c.value_cents ?? 0;
      if (v < min || v > max) return false;
      if (adv.hotOnly && !c.is_hot) return false;
      if (q && !(c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || (c.doc ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [clients, filter, adv]);
  const advActive = adv.areas.length + adv.stages.length + (adv.minValue ? 1 : 0) + (adv.maxValue ? 1 : 0) + (adv.hotOnly ? 1 : 0) + (adv.search ? 1 : 0);

  const grouped = useMemo(
    () => STAGES.map(s => ({
      ...s,
      items: filtered.filter(c => stageOf(c.status) === s.id),
    })),
    [filtered]
  );

  const { data: crmMetrics } = useMetricsCrm();
  const kpis = {
    leads: crmMetrics?.leads ?? 0,
    ativos: crmMetrics?.ativos ?? 0,
    conv: crmMetrics?.conv_pct ?? 0,
    pipeline: crmMetrics?.pipeline_value ?? 0,
    fechadosMes: crmMetrics?.fechados_mes ?? 0,
  };

  const handleCreate = async () => {
    if (!String(form.name).trim() || !profile?.tenant_id) return;
    const payload: Partial<Client> = {
      tenant_id: profile.tenant_id,
      created_by: profile.id,
      name: String(form.name), email: String(form.email) || null, phone: String(form.phone) || null, doc: String(form.doc) || null,
      type: String(form.type), status: String(form.status),
      area: String(form.area),
      value_cents: Math.round(Number(form.value) * 100),
      owner: String(form.owner) || profile.full_name || "Advogado",
      address: String(form.address) || null, city: String(form.city) || null, state: String(form.state) || null,
    } as any;
    create.mutate(payload, {
      onSuccess: () => {
        setOpen(false);
        setForm({ name: "", email: "", phone: "", doc: "", type: "PF", status: "novo_contato", area: "Trabalhista", value: 10000, owner: "", address: "", city: "", state: "" });
      }
    });
  };

  const handleMoveStage = async (id: string, status: string) => {
    const prev = clients.find(c => c.id === id);
    moveStage.mutate({ id, status, prevStatus: prev?.status });
    if (selected?.id === id) setSelected(s => s ? { ...s, status } : s);
  };

  const handleRemove = async (id: string) => {
    remove.mutate(id);
    if (selected?.id === id) setSelected(null);
  };

  const handleToggleHot = async (id: string, is_hot: boolean) => {
    toggleHot.mutate({ id, is_hot });
    if (selected?.id === id) setSelected(s => s ? { ...s, is_hot } : s);
  };

  const onImportCSV = async (file: File) => {
    if (!profile?.tenant_id) return;
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) return toast.error("CSV vazio");
      const valid = STAGES.map(s => s.id) as readonly string[];
      const payload = rows.map(r => {
        const name = r.name || r.nome || "";
        const type = (r.type || r.tipo || "PF").toUpperCase() === "PJ" ? "PJ" : "PF";
        const status = valid.includes((r.status || "novo_contato").toLowerCase()) ? (r.status || "novo_contato").toLowerCase() : "novo_contato";
        const area = r.area || "Cível";
        const value_cents = Math.round((Number(r.value || r.valor || 0) || 10000) * 100);
        return {
          tenant_id: profile.tenant_id!, created_by: profile.id,
          name, email: r.email || null, phone: r.phone || r.telefone || null,
          doc: r.doc || r.cpf || r.cnpj || null, type, status, area, value_cents,
          owner: r.owner || r.responsavel || profile.full_name || "Advogado",
        } as any;
      }).filter(p => p.name.trim() !== "");
      if (!payload.length) return toast.error("Nenhuma linha válida (coluna 'name' obrigatória)");
      const { error } = await supabase.from("clients").insert(payload);
      if (error) return toast.error(error.message);
      toast.success(`${payload.length} cliente(s) importado(s)`);
      // Invalidating queries to fetch imported data
      qc.invalidateQueries({ queryKey: ["clients", profile.tenant_id] });
    } catch { toast.error("Falha ao ler CSV"); }
  };

  const exportReport = () => {
    if (!filtered.length) return toast.error("Nenhum cliente para exportar");
    const rows = filtered.map(c => {
      const stage = STAGES.find(s => s.id === stageOf(c.status))?.label ?? c.status;
      return {
        name: c.name, email: c.email ?? "", phone: c.phone ?? "", doc: c.doc ?? "",
        type: c.type, status: stage, area: c.area ?? "", value: clientValue(c),
        owner: c.owner ?? "", is_hot: c.is_hot ? "Sim" : "Não",
        city: c.city ?? "", state: c.state ?? "",
        created_at: new Date(c.created_at).toLocaleDateString("pt-BR"),
        updated_at: new Date(c.updated_at).toLocaleDateString("pt-BR"),
      };
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`advora-crm-${stamp}.csv`, toCSV(rows));
    toast.success(`Relatório exportado (${rows.length} registros)`);
  };

  const resetAdv = () => setAdv({ areas: [], stages: [], minValue: "", maxValue: "", hotOnly: false, search: "" });
  const toggle = (key: "areas" | "stages", v: string) =>
    setAdv(a => ({ ...a, [key]: a[key].includes(v) ? a[key].filter(x => x !== v) : [...a[key], v] }));

  // ---------- Drag & Drop ----------
  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("clientId", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(stageId);
  };
  const onDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("clientId");
    if (!id) return;
    const client = clients.find(c => c.id === id);
    if (!client || stageOf(client.status) === stageId) return;
    handleMoveStage(id, stageId);
  };

  return (
    <div className="relative">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/3 w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-[120px]" />
        <div className="absolute top-40 right-0 w-[500px] h-[500px] rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      <div className={`flex ${selected ? "pr-[420px]" : ""} transition-all duration-300`}>
        <div className="flex-1 min-w-0 p-6 lg:p-8 space-y-6">
          {/* Header */}
          <header className="flex items-end justify-between gap-4 animate-fade-up">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-medium mb-1.5">Módulo · Comercial</p>
              <h1 className="text-3xl font-bold tracking-tight">CRM Jurídico</h1>
              <p className="text-sm text-muted-foreground mt-1.5">Gestão completa de clientes, leads e oportunidades do escritório.</p>
            </div>
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onImportCSV(f); e.target.value = ""; }} />
              <Button onClick={() => fileRef.current?.click()} variant="outline" size="sm" className="h-9 border-border/60 bg-white/[0.02] hover:bg-white/[0.05]">
                <Upload className="size-3.5 mr-1.5" /> Importar CSV
              </Button>
              <Button onClick={exportReport} variant="outline" size="sm" className="h-9 border-border/60 bg-white/[0.02] hover:bg-white/[0.05]">
                <Download className="size-3.5 mr-1.5" /> Exportar
              </Button>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-9 bg-[image:var(--gradient-brand)] shadow-[0_4px_20px_-4px_oklch(0.70_0.18_285/0.55)] hover:shadow-[0_6px_28px_-4px_oklch(0.70_0.18_285/0.75)] hover:-translate-y-px">
                    <Plus className="size-3.5 mr-1.5" /> Novo Cliente
                  </Button>
                </DialogTrigger>
                <DialogContent className="glass max-w-lg">
                  <DialogHeader><DialogTitle>Cadastrar cliente</DialogTitle></DialogHeader>
                  <NewClientForm form={form} setForm={setForm} onCreate={handleCreate} />
                </DialogContent>
              </Dialog>
            </div>
          </header>

          {/* Filters bar */}
          <div className="flex items-center justify-between gap-3 animate-fade-up">
            <div className="flex items-center gap-1 p-1 rounded-xl glass overflow-x-auto">
              {[
                { id: "all", label: "Todos", icon: LayoutGrid },
                { id: "PF", label: "Pessoa Física", icon: Users },
                { id: "PJ", label: "Pessoa Jurídica", icon: Building2 },
                { id: "leads", label: "Leads", icon: Flame },
                { id: "ativos", label: "Ativos", icon: UserCheck },
                { id: "inativos", label: "Inativos", icon: X },
              ].map(f => (
                <button key={f.id} onClick={() => setFilter(f.id as typeof filter)}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                    filter === f.id ? "bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_oklch(0.70_0.18_285/0.3)]" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                  }`}>
                  <f.icon className="size-3.5" />{f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center p-0.5 rounded-lg glass">
                <button onClick={() => setView("funil")} className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium ${view === "funil" ? "bg-white/[0.06] text-foreground" : "text-muted-foreground"}`}><LayoutGrid className="size-3.5" />Funil</button>
                <button onClick={() => setView("lista")} className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium ${view === "lista" ? "bg-white/[0.06] text-foreground" : "text-muted-foreground"}`}><List className="size-3.5" />Lista</button>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 border-border/60 bg-white/[0.02] text-xs shrink-0">
                    <Filter className="size-3.5 mr-1.5" />Filtros
                    {advActive > 0 && <span className="ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary/20 text-primary text-[9px] font-bold">{advActive}</span>}
                    <ChevronDown className="size-3 ml-1" />
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
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Busca</Label>
                    <Input value={adv.search} onChange={e => setAdv({ ...adv, search: e.target.value })} placeholder="Nome, email, CPF/CNPJ..." className="h-8 mt-1 text-xs" />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Área Jurídica</Label>
                    <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                      {AREAS.map(a => (
                        <label key={a} className="flex items-center gap-2 text-xs cursor-pointer hover:text-foreground text-muted-foreground">
                          <Checkbox checked={adv.areas.includes(a)} onCheckedChange={() => toggle("areas", a)} />
                          <span className="truncate">{a}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Etapa</Label>
                    <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                      {STAGES.map(s => (
                        <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer hover:text-foreground text-muted-foreground">
                          <Checkbox checked={adv.stages.includes(s.id)} onCheckedChange={() => toggle("stages", s.id)} />
                          <span className="truncate">{s.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor estimado (R$)</Label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <Input type="number" placeholder="Mín" value={adv.minValue} onChange={e => setAdv({ ...adv, minValue: e.target.value })} className="h-8 text-xs" />
                      <Input type="number" placeholder="Máx" value={adv.maxValue} onChange={e => setAdv({ ...adv, maxValue: e.target.value })} className="h-8 text-xs" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox checked={adv.hotOnly} onCheckedChange={v => setAdv({ ...adv, hotOnly: !!v })} />
                    <Flame className="size-3.5 text-rose-300" /> Somente leads quentes
                  </label>
                  <div className="pt-2 border-t border-border/40 text-[10px] text-muted-foreground">
                    Exibindo <span className="text-foreground font-semibold">{filtered.length}</span> de {clients.length} clientes
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 stagger">
            <KpiCard label="Leads" value={String(kpis.leads)} deltaLabel="novos e triagem" icon={Users} tone="violet" />
            <KpiCard label="Clientes Ativos" value={String(kpis.ativos)} deltaLabel="em contrato / andamento" icon={UserCheck} tone="blue" />
            <KpiCard label="Taxa de Conversão" value={crmMetrics?.conv_pct != null ? `${crmMetrics.conv_pct}%` : "—"} deltaLabel="ativos vs pipeline" icon={TrendingUp} tone="emerald" />
            <KpiCard label="Receita Potencial" value={brl(kpis.pipeline / 100)} deltaLabel="em pipeline" icon={DollarSign} tone="amber" />
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
                  <p className="text-xs text-muted-foreground">Análise do seu funil de vendas</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <InsightCard icon={Flame} tone="rose" title={`${Math.max(0, clients.filter(c => c.is_hot).length)} Leads quentes`} desc="Clientes marcados como alta prioridade" />
              <InsightCard icon={AlertTriangle} tone="amber" title={`${clients.filter(c => { const d = (Date.now() - new Date(c.updated_at).getTime()) / 86400000; return d > 14 && !["encerrado"].includes(stageOf(c.status)); }).length} Oportunidades paradas`} desc="Leads sem contato há mais de 14 dias" />
              <InsightCard icon={DollarSign} tone="emerald" title={brl(kpis.pipeline / 100)} desc="Receita potencial em propostas abertas" />
              <InsightCard icon={Bot} tone="violet" title="Sugestão da IA" desc={clients[0] ? `Entre em contato com ${clients[0].name} hoje` : "Cadastre clientes para receber sugestões"} badge="IA" />
            </div>
          </section>

          {/* Pipeline kanban / lista */}
          {view === "funil" ? (
            <div className="overflow-x-auto pb-3 -mx-1 px-1">
              <div className="flex min-w-max gap-3 stagger">
                {grouped.map(col => (
                  <div
                    key={col.id}
                    className={`glass w-[292px] shrink-0 rounded-2xl p-3 flex flex-col min-h-[560px] transition-all duration-200 ${
                      dragOver === col.id ? "ring-2 ring-primary/50 bg-primary/5" : "hover-lift"
                    }`}
                    onDragOver={e => onDragOver(e, col.id)}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={e => onDrop(e, col.id)}
                  >
                    <div className="h-0.5 w-full rounded-full mb-3" style={{ background: col.color, boxShadow: `0 0 12px ${col.color}` }} />
                    <div className="flex items-start justify-between gap-2 px-1">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold tracking-tight">{col.label}</h3>
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${col.bg} ${col.text}`}>{col.items.length}</span>
                        </div>
                        <p className="text-[11px] font-semibold tabular-nums mt-1">{brl(col.items.reduce((t, c) => t + clientValue(c), 0))}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 mt-1 mb-3 px-1">{col.subtitle}</p>
                    <div className="space-y-2.5 flex-1 overflow-y-auto -mx-1 px-1">
                      {loading && Array.from({ length: 2 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
                      {!loading && col.items.length === 0 && (
                        <div className="text-center py-10 space-y-2">
                          <div className="text-[11px] text-muted-foreground/60 border border-dashed border-border/40 rounded-xl py-6 px-3">
                            <p>Sem clientes nesta etapa</p>
                            <button
                              onClick={() => { setForm(f => ({ ...f, status: col.id })); setOpen(true); }}
                              className="mt-2 text-[10px] text-primary hover:underline"
                            >+ Adicionar cliente</button>
                          </div>
                        </div>
                      )}
                      {col.items.map(c => {
                        const staleDays = Math.floor((Date.now() - new Date(c.updated_at).getTime()) / 86400000);
                        return (
                          <div
                            key={c.id}
                            draggable
                            onDragStart={e => onDragStart(e, c.id)}
                            onClick={() => { setSelected(c); setTab("resumo"); }}
                            className={`group w-full text-left rounded-xl bg-card border p-3.5 shadow-[var(--shadow-xs)] hover:border-primary/40 hover:shadow-[var(--shadow-md)] transition-all cursor-pointer ${
                              selected?.id === c.id ? "ring-2 ring-primary/40 border-primary/40" : staleDays > 7 ? "border-amber-500/30" : "border-border/70"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[10px] font-mono text-muted-foreground">{leadCode(c)}</p>
                                <p className="mt-1 text-sm font-semibold truncate">{c.name}</p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={e => { e.stopPropagation(); handleToggleHot(c.id, !c.is_hot); }}
                                  className={`size-6 grid place-items-center rounded-md transition-all ${c.is_hot ? "text-rose-400 bg-rose-500/10" : "text-muted-foreground/40 hover:text-rose-300"}`}
                                >
                                  <Flame className="size-3.5" />
                                </button>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                              {c.area && <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-300">{c.area}</span>}
                              {c.is_hot && <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-300">Quente</span>}
                            </div>
                            {(c.value_cents ?? 0) > 0 && (
                              <p className="mt-3 text-[15px] font-bold tracking-tight">{brl(clientValue(c))}</p>
                            )}
                            <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2.5 text-[10px]">
                              <span className={`inline-flex items-center gap-1 ${staleDays > 7 ? "text-amber-400" : "text-muted-foreground"}`}>
                                <Clock className="size-3" />{staleDays > 7 ? "Follow-up atrasado" : relTime(c.updated_at)}
                              </span>
                              {c.owner && (
                                <span className="inline-flex items-center gap-1 text-muted-foreground truncate max-w-[90px]">
                                  <UserCheck className="size-3 shrink-0" />
                                  <span className="truncate">{c.owner.split(" ")[0]}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="glass rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
                  <tr>
                    <th className="text-left p-3 pl-4">Cliente</th>
                    <th className="text-left p-3">Área</th>
                    <th className="text-left p-3">Etapa</th>
                    <th className="text-right p-3">Valor</th>
                    <th className="text-left p-3">Responsável</th>
                    <th className="text-left p-3">Atualizado</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const stage = STAGES.find(s => s.id === stageOf(c.status)) ?? STAGES[0];
                    return (
                      <tr key={c.id} className="border-b border-border/20 row-hover cursor-pointer" onClick={() => { setSelected(c); setTab("resumo"); }}>
                        <td className="p-3 pl-4">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-7">
                              <AvatarFallback className="text-[10px] bg-[image:var(--gradient-brand)] text-white">{initials(c.name)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <span className="font-medium">{c.name}</span>
                              {c.is_hot && <Flame className="size-3 text-rose-400 ml-1.5 inline" />}
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground text-xs">{c.area ?? "—"}</td>
                        <td className="p-3"><span className={`text-[10px] px-2 py-0.5 rounded-md ${stage.bg} ${stage.text}`}>{stage.label}</span></td>
                        <td className="p-3 text-right font-mono font-semibold">{(c.value_cents ?? 0) > 0 ? brl(clientValue(c)) : "—"}</td>
                        <td className="p-3 text-muted-foreground text-xs">{c.owner ?? "—"}</td>
                        <td className="p-3 text-muted-foreground text-xs">{relTime(c.updated_at)}</td>
                        <td className="p-3"><MoreHorizontal className="size-4 text-muted-foreground" /></td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">Nenhum cliente encontrado</td></tr>
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
            onMove={handleMoveStage}
            onToggleHot={handleToggleHot}
            onDelete={handleRemove}
            onUpdate={(updated) => {
              update.mutate({ id: updated.id, payload: updated });
              setSelected(updated);
            }}
            tab={tab}
            setTab={setTab}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- New Client Form ---------- */
function NewClientForm({ form, setForm, onCreate }: {
  form: Record<string, string | number>;
  setForm: (f: Record<string, string | number>) => void;
  onCreate: () => void;
}) {
  const s = (key: string) => String(form[key] ?? "");
  const set = (key: string, val: string | number) => setForm({ ...form, [key]: val });
  return (
    <div className="grid gap-3 max-h-[70vh] overflow-y-auto pr-1">
      <div><Label>Nome*</Label><Input value={s("name")} onChange={e => set("name", e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Email</Label><Input type="email" value={s("email")} onChange={e => set("email", e.target.value)} /></div>
        <div><Label>Telefone</Label><Input value={s("phone")} onChange={e => set("phone", e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>CPF/CNPJ</Label><Input value={s("doc")} onChange={e => set("doc", e.target.value)} /></div>
        <div>
          <Label>Tipo</Label>
          <Select value={s("type")} onValueChange={v => set("type", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="PF">Pessoa Física</SelectItem><SelectItem value="PJ">Pessoa Jurídica</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Área Jurídica</Label>
          <Select value={s("area")} onValueChange={v => set("area", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Valor estimado (R$)</Label><Input type="number" value={s("value")} onChange={e => set("value", Number(e.target.value))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Etapa</Label>
          <Select value={s("status")} onValueChange={v => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STAGES.map(st => <SelectItem key={st.id} value={st.id}>{st.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Responsável</Label><Input value={s("owner")} onChange={e => set("owner", e.target.value)} placeholder="Dr. ..." /></div>
      </div>
      <div><Label>Endereço</Label><Input value={s("address")} onChange={e => set("address", e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Cidade</Label><Input value={s("city")} onChange={e => set("city", e.target.value)} /></div>
        <div><Label>Estado</Label><Input value={s("state")} onChange={e => set("state", e.target.value)} placeholder="SP" maxLength={2} /></div>
      </div>
      <Button onClick={onCreate} className="mt-2 bg-[image:var(--gradient-brand)]">Criar cliente</Button>
    </div>
  );
}

/* ---------- KPI card ---------- */
function KpiCard({ label, value, deltaLabel, icon: Icon, tone }: { label: string; value: string; deltaLabel: string; icon: typeof Users; tone: "violet" | "blue" | "emerald" | "amber" | "rose" }) {
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
function ClientDrawer({ client, onClose, onMove, onToggleHot, onDelete, onUpdate, tab, setTab }: {
  client: Client;
  onClose: () => void;
  onMove: (id: string, status: string) => void;
  onToggleHot: (id: string, v: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate: (updated: Client) => void;
  tab: "resumo" | "historico" | "processos" | "financeiro" | "ia";
  setTab: (t: "resumo" | "historico" | "processos" | "financeiro" | "ia") => void;
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const stage = STAGES.find(s => s.id === stageOf(client.status)) ?? STAGES[0];
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Client>>({});
  const [newNote, setNewNote] = useState("");
  const [noteKind, setNoteKind] = useState<string>("note");
  const [noteTitle, setNoteTitle] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // ---- Queries ----
  const activitiesQ = useQuery({
    queryKey: ["client-activities", client.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_activities" as any)
        .select("*, profiles(full_name, avatar_url)")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any as Activity[];
    },
    enabled: tab === "historico",
  });

  const casesQ = useQuery({
    queryKey: ["client-cases", client.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("id, number, title, status, area, value_cents, updated_at")
        .eq("client_id", client.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: tab === "processos",
  });

  const finQ = useQuery({
    queryKey: ["client-fin", client.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_entries")
        .select("id, description, kind, amount_cents, status, due_date, paid_at")
        .eq("client_id", client.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: tab === "financeiro",
  });

  // ---- Edit ----
  const startEdit = () => {
    setEditForm({
      name: client.name, email: client.email, phone: client.phone, doc: client.doc,
      type: client.type, area: client.area, value_cents: client.value_cents,
      owner: client.owner, address: client.address, city: client.city, state: client.state,
    });
    setEditing(true);
  };
  const saveEdit = async () => {
    const payload: any = {
      name: editForm.name, email: editForm.email || null, phone: editForm.phone || null,
      doc: editForm.doc || null, type: editForm.type, area: editForm.area,
      value_cents: editForm.value_cents, owner: editForm.owner,
      address: editForm.address || null, city: editForm.city || null, state: editForm.state || null,
    };
    const { error } = await supabase.from("clients").update(payload).eq("id", client.id);
    if (error) return toast.error(error.message);
    toast.success("Cliente atualizado");
    setEditing(false);
    onUpdate({ ...client, ...payload } as Client);
  };

  // ---- Add activity ----
  const addNote = async () => {
    if (!profile?.tenant_id || !noteTitle.trim()) return;
    setSavingNote(true);
    const { error } = await (supabase.from("client_activities") as any).insert({
      tenant_id: profile.tenant_id, client_id: client.id, user_id: profile.id,
      kind: noteKind, title: noteTitle.trim(), body: newNote.trim() || null,
    });
    setSavingNote(false);
    if (error) return toast.error(error.message);
    setNoteTitle(""); setNewNote("");
    toast.success("Atividade registrada");
    qc.invalidateQueries({ queryKey: ["client-activities", client.id] });
  };

  // ---- Quick actions ----
  const openWhatsApp = () => {
    if (!client.phone) return toast.error("Telefone não cadastrado");
    const num = client.phone.replace(/\D/g, "");
    window.open(`https://wa.me/55${num}`, "_blank");
  };
  const openEmail = () => {
    if (!client.email) return toast.error("E-mail não cadastrado");
    window.open(`mailto:${client.email}`, "_blank");
  };
  const openCall = () => {
    if (!client.phone) return toast.error("Telefone não cadastrado");
    window.location.href = `tel:${client.phone}`;
  };

  // ---- Financial summary ----
  const finData = finQ.data ?? [];
  const totalReceita = finData.filter(e => e.kind === "receita" && e.status === "pago").reduce((s, e) => s + e.amount_cents, 0);
  const totalEmAberto = finData.filter(e => e.kind === "receita" && e.status !== "pago").reduce((s, e) => s + e.amount_cents, 0);
  const totalRecebido = totalReceita;

  const stageProgress = ((STAGES.findIndex(s => s.id === stageOf(client.status)) + 1) / STAGES.length) * 100;

  return (
    <aside className="fixed top-16 right-0 bottom-0 w-[420px] z-20 glass border-l border-border/40 flex flex-col animate-fade-up">
      {/* Header */}
      <div className="p-4 border-b border-border/40">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <Avatar className="size-12 ring-2 ring-primary/30 shrink-0">
              <AvatarFallback className="bg-[image:var(--gradient-brand)] text-white font-semibold">{initials(client.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-sm font-bold truncate">{client.name}</h3>
                {client.is_hot && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 inline-flex items-center gap-0.5">
                    <Flame className="size-2.5" />Quente
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{client.area ?? "Área não definida"}</p>
              {(client.value_cents ?? 0) > 0 && (
                <p className="text-sm font-bold gradient-text mt-0.5">{brl(clientValue(client))}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onToggleHot(client.id, !client.is_hot)}
              className={`size-7 grid place-items-center rounded-md transition-all ${client.is_hot ? "text-rose-400 bg-rose-500/10" : "text-muted-foreground hover:text-rose-300"}`}
              title={client.is_hot ? "Remover destaque" : "Marcar como quente"}
            >
              {client.is_hot ? <Star className="size-3.5 fill-current" /> : <StarOff className="size-3.5" />}
            </button>
            <button onClick={onClose} className="size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-white/[0.05]"><X className="size-4" /></button>
          </div>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground mt-2">{leadCode(client)}</p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-1.5 p-3 border-b border-border/40">
        {[
          { icon: MessageCircle, label: "WhatsApp", color: "text-emerald-400", action: openWhatsApp, disabled: !client.phone },
          { icon: Mail, label: "Email", color: "text-blue-400", action: openEmail, disabled: !client.email },
          { icon: PhoneCall, label: "Ligar", color: "text-violet-400", action: openCall, disabled: !client.phone },
          { icon: editing ? Save : Edit2, label: editing ? "Salvar" : "Editar", color: "text-amber-400", action: editing ? saveEdit : startEdit, disabled: false },
        ].map(a => (
          <button
            key={a.label}
            onClick={a.action}
            disabled={a.disabled}
            className={`flex flex-col items-center gap-1 py-2 rounded-lg hover:bg-white/[0.04] transition disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <a.icon className={`size-4 ${a.color}`} />
            <span className="text-[9px] text-muted-foreground">{a.label}</span>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-border/40 px-3 overflow-x-auto shrink-0">
        {(["resumo", "historico", "processos", "financeiro", "ia"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`relative px-3 py-2.5 text-[11px] font-medium capitalize whitespace-nowrap transition ${tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t === "ia" ? "IA" : t}
            {tab === t && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full shadow-[0_0_8px_oklch(0.70_0.18_285/0.7)]" />}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ---- RESUMO ---- */}
        {tab === "resumo" && (
          <>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Dados do Cliente</h4>
              {editing ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[10px]">Nome</Label><Input value={editForm.name ?? ""} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs mt-0.5" /></div>
                    <div>
                      <Label className="text-[10px]">Tipo</Label>
                      <Select value={editForm.type ?? "PF"} onValueChange={v => setEditForm(f => ({ ...f, type: v }))}>
                        <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="PF">Pessoa Física</SelectItem><SelectItem value="PJ">Pessoa Jurídica</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[10px]">Email</Label><Input value={editForm.email ?? ""} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="h-8 text-xs mt-0.5" /></div>
                    <div><Label className="text-[10px]">Telefone</Label><Input value={editForm.phone ?? ""} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="h-8 text-xs mt-0.5" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[10px]">CPF/CNPJ</Label><Input value={editForm.doc ?? ""} onChange={e => setEditForm(f => ({ ...f, doc: e.target.value }))} className="h-8 text-xs mt-0.5" /></div>
                    <div>
                      <Label className="text-[10px]">Área Jurídica</Label>
                      <Select value={editForm.area ?? ""} onValueChange={v => setEditForm(f => ({ ...f, area: v }))}>
                        <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                        <SelectContent>{AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[10px]">Valor (R$)</Label><Input type="number" value={editForm.value_cents != null ? editForm.value_cents / 100 : ""} onChange={e => setEditForm(f => ({ ...f, value_cents: Math.round(Number(e.target.value) * 100) }))} className="h-8 text-xs mt-0.5" /></div>
                    <div><Label className="text-[10px]">Responsável</Label><Input value={editForm.owner ?? ""} onChange={e => setEditForm(f => ({ ...f, owner: e.target.value }))} className="h-8 text-xs mt-0.5" /></div>
                  </div>
                  <div><Label className="text-[10px]">Endereço</Label><Input value={editForm.address ?? ""} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} className="h-8 text-xs mt-0.5" /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-[10px]">Cidade</Label><Input value={editForm.city ?? ""} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} className="h-8 text-xs mt-0.5" /></div>
                    <div><Label className="text-[10px]">Estado</Label><Input value={editForm.state ?? ""} onChange={e => setEditForm(f => ({ ...f, state: e.target.value }))} className="h-8 text-xs mt-0.5" maxLength={2} /></div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={saveEdit} size="sm" className="flex-1 h-8 text-xs bg-[image:var(--gradient-brand)]"><Save className="size-3 mr-1" />Salvar</Button>
                    <Button onClick={() => setEditing(false)} variant="outline" size="sm" className="h-8 text-xs">Cancelar</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 text-xs">
                  <Row label="CPF/CNPJ" value={client.doc || "—"} />
                  <Row label="Telefone" value={client.phone || "—"} />
                  <Row label="Email" value={client.email || "—"} mono />
                  <Row label="Tipo" value={client.type === "PF" ? "Pessoa Física" : "Pessoa Jurídica"} />
                  <Row label="Responsável" value={client.owner || "—"} />
                  {client.city && <Row label="Cidade/UF" value={`${client.city}${client.state ? `/${client.state}` : ""}`} />}
                </div>
              )}
            </div>

            {!editing && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Etapa do Pipeline</h4>
                <Select value={stageOf(client.status)} onValueChange={v => onMove(client.id, v)}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
                <div className="mt-2 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                  <div className="h-full transition-all duration-500" style={{ width: `${stageProgress}%`, background: stage.color, boxShadow: `0 0 12px ${stage.color}` }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{stage.subtitle}</p>
              </div>
            )}

            {!editing && (
              <div className="pt-2 border-t border-border/40">
                <p className="text-[10px] text-muted-foreground">Cadastrado em {new Date(client.created_at).toLocaleDateString("pt-BR")}</p>
                <p className="text-[10px] text-muted-foreground">Atualizado {relTime(client.updated_at)}</p>
              </div>
            )}
          </>
        )}

        {/* ---- HISTÓRICO ---- */}
        {tab === "historico" && (
          <div className="space-y-4">
            {/* Add activity */}
            <div className="rounded-xl border border-border/40 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center gap-2">
                {ACTIVITY_KINDS.map(k => (
                  <button key={k.id} onClick={() => setNoteKind(k.id)}
                    className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[10px] font-medium transition-all ${noteKind === k.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                    <k.icon className="size-3" />{k.label}
                  </button>
                ))}
              </div>
              <Input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="Título da atividade..." className="h-8 text-xs" />
              <Textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Detalhes (opcional)..." className="text-xs min-h-[60px] resize-none" />
              <Button onClick={addNote} disabled={savingNote || !noteTitle.trim()} size="sm" className="w-full h-8 text-xs bg-[image:var(--gradient-brand)]">
                {savingNote ? "Salvando..." : "Registrar atividade"}
              </Button>
            </div>

            {/* Timeline */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Timeline</h4>
              {activitiesQ.isLoading && <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 skeleton rounded-xl" />)}</div>}
              {activitiesQ.data?.length === 0 && (
                <div className="text-center py-8 text-[11px] text-muted-foreground/60 border border-dashed border-border/40 rounded-xl">
                  Nenhuma atividade registrada
                </div>
              )}
              {activitiesQ.data && activitiesQ.data.length > 0 && (
                <ol className="relative border-l border-border/40 ml-2 space-y-4">
                  {activitiesQ.data.map(act => {
                    const kindInfo = ACTIVITY_KINDS.find(k => k.id === act.kind);
                    const isStageChange = act.kind === "stage_change";
                    const colors: Record<string, string> = {
                      note: "bg-violet-500", call: "bg-green-500", email: "bg-blue-500",
                      meeting: "bg-amber-500", stage_change: "bg-primary", document: "bg-slate-500",
                    };
                    return (
                      <li key={act.id} className="ml-4">
                        <span className={`absolute -left-[7px] size-3 rounded-full ${colors[act.kind] ?? "bg-muted"} ring-4 ring-background`} />
                        <div className="rounded-lg bg-white/[0.02] border border-border/30 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium">{act.title}</p>
                            <span className="text-[9px] text-muted-foreground shrink-0">
                              {new Date(act.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          {act.body && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{act.body}</p>}
                          {act.profiles?.full_name && (
                            <p className="text-[10px] text-muted-foreground/60 mt-1">por {act.profiles.full_name}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        )}

        {/* ---- PROCESSOS ---- */}
        {tab === "processos" && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Processos Relacionados</h4>
            {casesQ.isLoading && <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>}
            {casesQ.data?.length === 0 && (
              <div className="text-center py-8 text-[11px] text-muted-foreground/60 border border-dashed border-border/40 rounded-xl">
                Nenhum processo vinculado a este cliente.<br />
                <span className="text-[10px]">Crie um processo e vincule-o ao cliente.</span>
              </div>
            )}
            {casesQ.data?.map(p => (
              <div key={p.id} className="rounded-xl border border-border/40 bg-white/[0.02] p-3 hover:bg-white/[0.04] transition">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono text-muted-foreground">{p.number ?? "Sem nº"}</p>
                  <StatusPill status={p.status} />
                </div>
                <p className="text-sm font-medium mt-0.5 truncate">{p.title}</p>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                  {p.area && <span>{p.area}</span>}
                  {(p.value_cents ?? 0) > 0 && <span>{brl((p.value_cents ?? 0) / 100)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---- FINANCEIRO ---- */}
        {tab === "financeiro" && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resumo Financeiro</h4>
            {finQ.isLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 skeleton rounded-lg" />)}</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-2.5 text-center">
                    <p className="text-[9px] text-emerald-300/70 uppercase tracking-wider">Recebido</p>
                    <p className="text-sm font-bold text-emerald-300 mt-0.5">{brl(totalRecebido / 100)}</p>
                  </div>
                  <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-2.5 text-center">
                    <p className="text-[9px] text-amber-300/70 uppercase tracking-wider">Em aberto</p>
                    <p className="text-sm font-bold text-amber-300 mt-0.5">{brl(totalEmAberto / 100)}</p>
                  </div>
                  <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-2.5 text-center">
                    <p className="text-[9px] text-violet-300/70 uppercase tracking-wider">Lançamentos</p>
                    <p className="text-sm font-bold text-violet-300 mt-0.5">{finData.length}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {finData.length === 0 && (
                    <div className="text-center py-8 text-[11px] text-muted-foreground/60 border border-dashed border-border/40 rounded-xl">
                      Nenhum lançamento financeiro para este cliente.
                    </div>
                  )}
                  {finData.slice(0, 10).map(e => (
                    <div key={e.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-border/30 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{e.description}</p>
                        <p className="text-[10px] text-muted-foreground">{e.kind === "receita" ? "Receita" : "Despesa"} · {e.due_date ? new Date(e.due_date).toLocaleDateString("pt-BR") : "—"}</p>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className={`text-xs font-semibold tabular-nums ${e.kind === "receita" ? "text-emerald-300" : "text-rose-300"}`}>
                          {e.kind === "receita" ? "+" : "-"}{brl(e.amount_cents / 100)}
                        </p>
                        <StatusPill status={e.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- IA ---- */}
        {tab === "ia" && (
          <div className="space-y-3">
            <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="size-4 text-violet-300" />
                <h4 className="text-xs font-semibold">Análise Inteligente</h4>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {client.area
                  ? `Cliente da área de ${client.area}. ${client.is_hot ? "Lead marcado como quente — contato prioritário." : "Acompanhe regularmente para manter o relacionamento ativo."}`
                  : "Defina a área jurídica do cliente para receber sugestões personalizadas."
                }
              </p>
            </div>
            <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="size-4 text-blue-300" />
                <h4 className="text-xs font-semibold">Próximos passos sugeridos</h4>
              </div>
              <ul className="space-y-2 text-[11px] text-muted-foreground">
                {stageOf(client.status) === "novo_contato" && <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-blue-300 shrink-0" />Realizar triagem inicial e qualificar o lead</li>}
                {stageOf(client.status) === "triagem" && <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-blue-300 shrink-0" />Agendar consulta presencial ou por videoconferência</li>}
                {stageOf(client.status) === "consulta_agendada" && <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-blue-300 shrink-0" />Preparar proposta de honorários após a consulta</li>}
                {stageOf(client.status) === "proposta" && <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-blue-300 shrink-0" />Aguardar resposta ou fazer follow-up em 48h</li>}
                {stageOf(client.status) === "contrato" && <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-blue-300 shrink-0" />Iniciar atendimento e coleta de documentação</li>}
                {stageOf(client.status) === "em_andamento" && <li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-blue-300 shrink-0" />Manter atualizações periódicas com o cliente</li>}
                <li className="flex items-center gap-2"><FileText className="size-3 text-blue-300 shrink-0" />Registrar todas as interações no histórico</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border/40 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 h-9 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
          onClick={() => { if (confirm(`Excluir ${client.name}?`)) { onDelete(client.id); } }}
        >
          Excluir cliente
        </Button>
        <Button
          size="sm"
          className="flex-1 h-9 text-xs bg-[image:var(--gradient-brand)] shadow-[0_4px_20px_-4px_oklch(0.70_0.18_285/0.6)]"
          onClick={() => setTab("historico")}
        >
          <Plus className="size-3.5 mr-1" /> Nova atividade
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

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const map: Record<string, string> = {
    ativo: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    pago: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    encerrado: "bg-muted text-muted-foreground border-border",
    pendente: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    atrasado: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    suspenso: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    ganho: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    perdido: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  };
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[9px] font-medium border ${map[s] ?? "bg-secondary text-secondary-foreground border-border"}`}>
      <span className="size-1.5 rounded-full bg-current" />
      <span className="capitalize">{status}</span>
    </span>
  );
}
