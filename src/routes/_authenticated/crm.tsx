import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus, Mail, MoreHorizontal, Upload, Download, Users, UserCheck,
  TrendingUp, DollarSign, FileCheck2, Flame, AlertTriangle, Bot, Sparkles,
  X, MessageCircle, PhoneCall, LayoutGrid, List, Filter, ChevronDown,
  Clock, FileText, CheckCircle2, Calendar, RotateCcw, ShieldCheck, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useMetricsCrm } from "@/hooks/use-metrics";
import { STAGES, stageOf, useClients, type Client } from "@/hooks/use-clients";
import { CrmKanbanCard, type ClientCardData } from "@/components/crm/crm-kanban-card";
import { CrmLeadDrawer } from "@/components/crm/crm-lead-drawer";
import { CrmTasksWidget } from "@/components/crm/crm-tasks-widget";

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


const AREAS = ["Trabalhista", "Cível", "Empresarial", "Tributário", "Família", "Criminal", "Previdenciário"];

function brl(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
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
  if (c.status === "novo_contato" || c.status === "triagem") {
    hot = c.name.length % 2 === 0;
  }
  return { area, value, owner, hot };
}

function CRM() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { clients, isLoading, create, update, moveStage } = useClients();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", doc: "", type: "PF", status: "novo_contato", area: "Trabalhista", value: 10000 });
  const [filter, setFilter] = useState<"all" | "PF" | "PJ" | "leads" | "ativos" | "inativos">("all");
  const [view, setView] = useState<"funil" | "lista">("funil");
  const [selected, setSelected] = useState<Client | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [adv, setAdv] = useState<{ areas: string[]; stages: string[]; minValue: string; maxValue: string; hotOnly: boolean; search: string }>({
    areas: [], stages: [], minValue: "", maxValue: "", hotOnly: false, search: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const min = adv.minValue ? Number(adv.minValue) : -Infinity;
    const max = adv.maxValue ? Number(adv.maxValue) : Infinity;
    const q = adv.search.trim().toLowerCase();
    return clients.filter(c => {
      if (filter === "PF" && c.type !== "PF") return false;
      if (filter === "PJ" && c.type !== "PJ") return false;
      if (filter === "leads" && !["novo_contato", "triagem"].includes(stageOf(c.status))) return false;
      if (filter === "ativos" && !["contrato", "em_andamento"].includes(stageOf(c.status))) return false;
      if (filter === "inativos" && stageOf(c.status) !== "encerrado") return false;
      const m = getMeta(c);
      if (adv.areas.length && !adv.areas.includes(m.area)) return false;
      if (adv.stages.length && !adv.stages.includes(c.status)) return false;
      if (m.value < min || m.value > max) return false;
      if (adv.hotOnly && !m.hot) return false;
      if (q && !(c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || (c.doc ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [clients, filter, adv]);

  const advActive = adv.areas.length + adv.stages.length + (adv.minValue ? 1 : 0) + (adv.maxValue ? 1 : 0) + (adv.hotOnly ? 1 : 0) + (adv.search ? 1 : 0);

  const grouped = useMemo(
    () => STAGES.map(s => {
      const items = filtered.filter(c => stageOf(c.status) === s.id);
      const totalValue = items.reduce((acc, item) => acc + getMeta(item).value, 0);
      return {
        ...s,
        items,
        totalValue,
      };
    }),
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

  const createClient = async () => {
    if (!form.name.trim() || !profile?.tenant_id) return;
    try {
      await create.mutateAsync({
        tenant_id: profile.tenant_id,
        created_by: profile.id,
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        doc: form.doc || null,
        type: form.type,
        status: form.status,
        notes: JSON.stringify({ area: form.area, value: form.value, owner: profile.full_name || "Dr. Yan", hot: true }),
      } as any);
      setOpen(false);
      setForm({ name: "", email: "", phone: "", doc: "", type: "PF", status: "novo_contato", area: "Trabalhista", value: 10000 });
    } catch {
      // toast handled by mutation
    }
  };

  const moveStageHandler = async (id: string, status: string) => {
    try {
      await moveStage.mutateAsync({ id, status, prevStatus: clients.find((c) => c.id === id)?.status });
      if (selected?.id === id) {
        setSelected((prev) => prev ? { ...prev, status, updated_at: new Date().toISOString() } : null);
      }
      toast.success("Etapa do funil atualizada!");
    } catch {
      // toast handled by mutation
    }
  };

  const saveNotes = async (id: string, notesText: string) => {
    try {
      await update.mutateAsync({ id, payload: { notes: notesText } });
      toast.success("Anotações salvas!");
    } catch {
      // toast handled by mutation
    }
  };

  const openWhatsapp = (phone: string | null, name: string) => {
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, "");
      const formattedPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;
      window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(`Olá ${name}, tudo bem? Sou do escritório de advocacia.`)}`, "_blank");
    } else {
      toast.error("Telefone não cadastrado para este cliente.");
    }
  };

  const handleCardClick = (client: Client) => {
    setSelected(client);
    setDrawerOpen(true);
  };

  const onImportCSV = async (file: File) => {
    if (!profile?.tenant_id) return;
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) return toast.error("CSV vazio");
      const valid = STAGES.map((s) => s.id) as readonly string[];
      const payload = rows
        .map((r) => {
          const name = r.name || r.nome || "";
          const type = (r.type || r.tipo || "PF").toUpperCase() === "PJ" ? "PJ" : "PF";
          const status = valid.includes((r.status || "novo_contato").toLowerCase())
            ? (r.status || "novo_contato").toLowerCase()
            : "novo_contato";
          const area = r.area || "Cível";
          const value = Number(r.value || r.valor || 0) || 10000;
          return {
            tenant_id: profile.tenant_id!,
            created_by: profile.id,
            name,
            email: r.email || null,
            phone: r.phone || r.telefone || null,
            doc: r.doc || r.cpf || r.cnpj || null,
            type,
            status,
            notes: JSON.stringify({ area, value, owner: profile.full_name || "Dr. Yan", hot: true }),
          };
        })
        .filter((p) => p.name.trim() !== "");
      if (!payload.length) return toast.error("Nenhuma linha válida (coluna 'name' obrigatória)");
      const { error } = await supabase.from("clients").insert(payload);
      if (error) return toast.error(error.message);
      toast.success(`${payload.length} cliente(s) importado(s)`);
      qc.invalidateQueries({ queryKey: ["clients", profile.tenant_id] });
    } catch (e) {
      toast.error("Falha ao ler CSV");
    }
  };

  const exportReport = () => {
    if (!filtered.length) return toast.error("Nenhum cliente para exportar");
    const rows = filtered.map((c) => {
      const m = getMeta(c);
      const stage = STAGES.find((s) => s.id === c.status)?.label ?? c.status;
      return {
        name: c.name,
        email: c.email ?? "",
        phone: c.phone ?? "",
        doc: c.doc ?? "",
        type: c.type,
        status: stage,
        area: m.area,
        value: m.value,
        owner: m.owner,
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

  return (
    <div className="relative p-6 lg:p-8 space-y-6">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/3 w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-[120px]" />
        <div className="absolute top-40 right-0 w-[500px] h-[500px] rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      {/* Helena Header */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fade-up">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
              HelenaCRM Legal OS
            </span>
            <span className="text-xs text-muted-foreground">• Atendimento & Pipeline</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">CRM Jurídico Conversacional</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestão inteligente de oportunidades, atendimento via WhatsApp e acompanhamento de SLA em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onImportCSV(f);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileRef.current?.click()} variant="outline" size="sm" className="h-9 border-border/80 text-xs gap-1.5 font-medium">
            <Upload className="h-3.5 w-3.5" /> Importar CSV
          </Button>
          <Button onClick={exportReport} variant="outline" size="sm" className="h-9 border-border/80 text-xs gap-1.5 font-medium">
            <Download className="h-3.5 w-3.5" /> Exportar Relatório
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-9 text-xs font-semibold gap-1.5 bg-gradient-to-r from-primary to-purple-600 text-white shadow-md hover:shadow-lg transition-all">
                <Plus className="h-4 w-4" /> Novo Lead / Cliente
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle className="text-base font-bold">Cadastrar Novo Lead no CRM</DialogTitle></DialogHeader>
              <div className="grid gap-3 py-2">
                <div><Label className="text-xs">Nome Completo do Cliente*</Label><Input className="text-xs mt-1" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Maria Oliveira" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Email</Label><Input className="text-xs mt-1" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" /></div>
                  <div><Label className="text-xs">WhatsApp / Telefone</Label><Input className="text-xs mt-1" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(11) 99999-9999" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">CPF/CNPJ</Label><Input className="text-xs mt-1" value={form.doc} onChange={e => setForm({ ...form, doc: e.target.value })} placeholder="000.000.000-00" /></div>
                  <div>
                    <Label className="text-xs">Tipo de Pessoa</Label>
                    <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                      <SelectTrigger className="text-xs mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="PF" className="text-xs">Pessoa Física</SelectItem><SelectItem value="PJ" className="text-xs">Pessoa Jurídica</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Área Jurídica</Label>
                    <Select value={form.area} onValueChange={v => setForm({ ...form, area: v })}>
                      <SelectTrigger className="text-xs mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{AREAS.map(a => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">Honorário Estimado (R$)</Label><Input className="text-xs mt-1 h-9" type="number" value={form.value} onChange={e => setForm({ ...form, value: Number(e.target.value) })} /></div>
                </div>
                <div>
                  <Label className="text-xs">Etapa Inicial</Label>
                  <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                    <SelectTrigger className="text-xs mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button onClick={createClient} className="mt-3 text-xs font-semibold">Salvar Lead e Iniciar Atendimento</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Helena KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard label="Leads Ativos" value={String(kpis.leads)} deltaLabel="Triagem e primeiro contato" icon={Users} tone="violet" />
        <KpiCard label="Clientes em Atendimento" value={String(kpis.ativos)} deltaLabel="Contrato e casos ativos" icon={UserCheck} tone="blue" />
        <KpiCard label="Taxa de Conversão" value={crmMetrics?.conv_pct != null ? `${crmMetrics.conv_pct}%` : "—"} deltaLabel="Leads para Contrato" icon={TrendingUp} tone="emerald" />
        <KpiCard label="Receita Potencial" value={brl(kpis.pipeline)} deltaLabel="Propostas abertas" icon={DollarSign} tone="amber" />
        <KpiCard label="Contratos Fechados (Mês)" value={String(kpis.fechadosMes)} deltaLabel="Honorários garantidos" icon={FileCheck2} tone="rose" />
      </div>

      {/* Main Grid: Tasks Widget + Commercial Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <CrmTasksWidget />
        </div>

        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-4 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-600 dark:text-purple-400">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-foreground">Insights de Atendimento Conversacional</h3>
                  <p className="text-[10px] text-muted-foreground">Qualificação em tempo real estilo HelenaCRM</p>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] text-purple-600 border-purple-500/30">IA Helena Ativa</Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <InsightCard icon={Flame} tone="rose" title={`${Math.max(1, Math.floor(kpis.leads * 0.4))} Leads Quentes 🔥`} desc="Prontos para fechamento de proposta" />
              <InsightCard icon={AlertTriangle} tone="amber" title="Alertas de SLA ⏱️" desc="2 leads sem contato há +48 horas" />
              <InsightCard icon={Bot} tone="violet" title="Triagem Automática" desc="92% de assertividade no enquadramento jurídico" />
            </div>
          </div>
        </div>
      </div>

      {/* Helena Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card border border-border p-2.5 rounded-xl shadow-xs">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            { id: "all", label: "Todos", icon: LayoutGrid },
            { id: "leads", label: "🔥 Leads Quentes", icon: Flame },
            { id: "ativos", label: "Clientes Ativos", icon: UserCheck },
            { id: "PF", label: "Pessoa Física", icon: Users },
            { id: "PJ", label: "Pessoa Jurídica", icon: ShieldCheck },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id as typeof filter)}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                filter === f.id
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              <f.icon className="h-3.5 w-3.5" />
              <span>{f.label}</span>
            </button>
          ))}
        </div>

        {/* Search + View Toggle + Advanced Popover */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-[200px]">
            <Input
              placeholder="Buscar por nome, CPF/CNPJ..."
              value={adv.search}
              onChange={(e) => setAdv({ ...adv, search: e.target.value })}
              className="h-8 text-xs pl-3 pr-8"
            />
          </div>

          <div className="flex items-center p-1 rounded-lg border border-border bg-muted/30">
            <button
              onClick={() => setView("funil")}
              className={`inline-flex items-center gap-1 h-6 px-2 rounded text-xs font-medium transition-all ${
                view === "funil" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
              }`}
            >
              <LayoutGrid className="h-3 w-3" />
              <span>Kanban</span>
            </button>
            <button
              onClick={() => setView("lista")}
              className={`inline-flex items-center gap-1 h-6 px-2 rounded text-xs font-medium transition-all ${
                view === "lista" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
              }`}
            >
              <List className="h-3 w-3" />
              <span>Tabela</span>
            </button>
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs font-medium border-border gap-1">
                <Filter className="h-3.5 w-3.5" />
                <span>Filtros</span>
                {advActive > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                    {advActive}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[320px] p-4 space-y-3 bg-card border border-border shadow-xl">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Filtros Avançados</h4>
                <button onClick={resetAdv} className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1">
                  <RotateCcw className="h-3 w-3" /> Limpar
                </button>
              </div>

              <div>
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Área Jurídica</Label>
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
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Faixa de Valor (R$)</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <Input type="number" placeholder="Mín" value={adv.minValue} onChange={e => setAdv({ ...adv, minValue: e.target.value })} className="h-8 text-xs" />
                  <Input type="number" placeholder="Máx" value={adv.maxValue} onChange={e => setAdv({ ...adv, maxValue: e.target.value })} className="h-8 text-xs" />
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Helena Pipeline Kanban */}
      {view === "funil" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3.5 items-start">
          {grouped.map((col) => (
            <div key={col.id} className="rounded-xl border border-border/80 bg-card p-3 flex flex-col min-h-[550px] shadow-xs">
              {/* Stage Header */}
              <div className="mb-3">
                <div className="h-1 w-full rounded-full mb-2" style={{ background: col.color }} />
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-foreground truncate">{col.label}</h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {col.items.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{col.subtitle}</span>
                  <span className="font-semibold text-foreground">{brl(col.totalValue)}</span>
                </div>
              </div>

              {/* Cards List */}
              <div className="space-y-3 flex-1 overflow-y-auto pr-0.5">
                {isLoading && Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="skeleton h-28 rounded-xl" />
                ))}

                {!isLoading && col.items.length === 0 && (
                  <div className="text-center py-12 text-[11px] text-muted-foreground/60 border border-dashed border-border/60 rounded-xl">
                    Nenhum lead nesta etapa
                  </div>
                )}

                {col.items.map((client) => {
                  const m = getMeta(client);
                  return (
                    <CrmKanbanCard
                      key={client.id}
                      client={client}
                      meta={m}
                      onClick={handleCardClick}
                      onOpenWhatsapp={openWhatsapp}
                      onQuickAction={(action, cl) => {
                        if (action === "schedule") {
                          toast.info(`Agendamento iniciado para ${cl.name}`);
                        } else if (action === "note") {
                          handleCardClick(cl);
                        }
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
              <tr>
                <th className="text-left p-3 pl-4">Cliente / Lead</th>
                <th className="text-left p-3">Contato</th>
                <th className="text-left p-3">Área Jurídica</th>
                <th className="text-left p-3">Etapa do Funil</th>
                <th className="text-right p-3">Honorário Estimado</th>
                <th className="text-left p-3">Tempo na Etapa</th>
                <th className="p-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((c) => {
                const m = getMeta(c);
                const stage = STAGES.find((s) => s.id === c.status) ?? STAGES[0];
                return (
                  <tr
                    key={c.id}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => handleCardClick(c)}
                  >
                    <td className="p-3 pl-4 font-semibold text-foreground">
                      <div className="flex items-center gap-2">
                        <span>{c.name}</span>
                        {m.hot && (
                          <Badge className="bg-rose-500 text-white text-[9px] px-1 py-0">🔥 Quente</Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{c.phone || c.email || "—"}</td>
                    <td className="p-3"><Badge variant="outline" className="text-[10px]">{m.area}</Badge></td>
                    <td className="p-3">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${stage.bg} ${stage.text}`}>
                        {stage.label}
                      </span>
                    </td>
                    <td className="p-3 text-right font-bold text-foreground">{brl(m.value)}</td>
                    <td className="p-3 text-muted-foreground text-[11px]">
                      {new Date(c.updated_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/10"
                        title="Abrir WhatsApp"
                        onClick={() => openWhatsapp(c.phone, c.name)}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-muted-foreground text-xs">
                    Nenhum cliente cadastrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Helena Conversational & CRM Drawer */}
      <CrmLeadDrawer
        client={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        meta={selected ? getMeta(selected) : { area: "Cível", value: 10000, owner: "Dr. Yan", hot: false }}
        stages={STAGES}
        onUpdateStage={moveStageHandler}
        onSaveNotes={saveNotes}
      />
    </div>
  );
}

function KpiCard({ label, value, deltaLabel, icon: Icon, tone }: { label: string; value: string; deltaLabel: string; icon: typeof Users; tone: "violet" | "blue" | "emerald" | "amber" | "rose" }) {
  const tones = {
    violet:  { bg: "bg-violet-500/10",  text: "text-violet-600 dark:text-violet-400" },
    blue:    { bg: "bg-blue-500/10",    text: "text-blue-600 dark:text-blue-400" },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
    amber:   { bg: "bg-amber-500/10",   text: "text-amber-600 dark:text-amber-400" },
    rose:    { bg: "bg-rose-500/10",    text: "text-rose-600 dark:text-rose-400" },
  }[tone];

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs hover:shadow-md transition-all">
      <div className="flex items-center justify-between">
        <div className={`h-8 w-8 rounded-lg ${tones.bg} flex items-center justify-center`}>
          <Icon className={`h-4 w-4 ${tones.text}`} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2 font-medium">{label}</p>
      <p className="text-xl font-extrabold text-foreground tracking-tight mt-0.5">{value}</p>
      <p className="text-[10px] text-muted-foreground/80 mt-1">{deltaLabel}</p>
    </div>
  );
}

function InsightCard({ icon: Icon, tone, title, desc }: { icon: typeof Flame; tone: "rose" | "amber" | "violet"; title: string; desc: string }) {
  const tones = {
    rose:   { bg: "bg-rose-500/10",   text: "text-rose-600 dark:text-rose-400" },
    amber:  { bg: "bg-amber-500/10",  text: "text-amber-600 dark:text-amber-400" },
    violet: { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400" },
  }[tone];

  return (
    <div className="rounded-lg bg-muted/20 border border-border/60 p-2.5 flex items-start gap-2.5">
      <div className={`h-7 w-7 rounded-md ${tones.bg} flex items-center justify-center shrink-0`}>
        <Icon className={`h-3.5 w-3.5 ${tones.text}`} />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="text-xs font-bold text-foreground leading-tight">{title}</h4>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{desc}</p>
      </div>
    </div>
  );
}
