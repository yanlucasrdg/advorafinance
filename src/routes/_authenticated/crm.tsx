import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  Plus,
  Upload,
  Download,
  Users,
  UserCheck,
  Flame,
  MessageCircle,
  LayoutGrid,
  List,
  Filter,
  RotateCcw,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { STAGES, stageOf, useClients, type Client } from "@/hooks/use-clients";
import { CrmKanbanCard, type ClientCardData } from "@/components/crm/crm-kanban-card";
import { CrmLeadDrawer } from "@/components/crm/crm-lead-drawer";
import { createCsv, parseCrmImportCsv } from "@/lib/crm-csv";
import { getCrmClientMeta } from "@/lib/crm-client";

function downloadFile(name: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\ufeff" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM Jurídico" }] }),
  component: CRM,
});


const AREAS = ["Trabalhista", "Cível", "Empresarial", "Tributário", "Família", "Criminal", "Previdenciário"];

function brl(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function elapsedLabel(value: string) {
  const elapsedMs = Math.max(0, Date.now() - new Date(value).getTime());
  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 1) return "há menos de 1h";
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

function getMeta(c: Client) {
  return getCrmClientMeta(c);
}

function CRM() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { clients, isLoading, isError, create, update, moveStage } = useClients();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", doc: "", type: "PF", status: "novo_contato", area: "", value: 0 });
  const [filter, setFilter] = useState<"all" | "PF" | "PJ" | "leads" | "ativos" | "inativos">("all");
  const [view, setView] = useState<"funil" | "lista">("funil");
  const [selected, setSelected] = useState<Client | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [adv, setAdv] = useState<{ areas: string[]; stages: string[]; minValue: string; maxValue: string; hotOnly: boolean; search: string }>({
    areas: [], stages: [], minValue: "", maxValue: "", hotOnly: false, search: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const min = adv.minValue ? Number(adv.minValue) : -Infinity;
    const max = adv.maxValue ? Number(adv.maxValue) : Infinity;
    const q = adv.search.trim().toLowerCase();
    return clients.filter(c => {
      const normalizedType = c.type.toLocaleUpperCase("pt-BR");
      if (filter === "PF" && normalizedType !== "PF") return false;
      if (filter === "PJ" && normalizedType !== "PJ") return false;
      if (filter === "ativos" && !["contrato", "em_andamento"].includes(stageOf(c.status))) return false;
      if (filter === "inativos" && stageOf(c.status) !== "encerrado") return false;
      const m = getMeta(c);
      if (filter === "leads" && !m.hot) return false;
      if (adv.areas.length && !adv.areas.includes(m.area)) return false;
      if (adv.stages.length && !adv.stages.includes(stageOf(c.status))) return false;
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

  const operationalMetrics = useMemo(() => {
    const today = new Date().toDateString();
    return {
      newToday: clients.filter((client) => new Date(client.created_at).toDateString() === today).length,
      unassigned: clients.filter((client) => !client.owner?.trim()).length,
      hot: clients.filter((client) => getMeta(client).hot).length,
      pipeline: clients
        .filter((client) => stageOf(client.status) !== "encerrado")
        .reduce((total, client) => total + getMeta(client).value, 0),
    };
  }, [clients]);

  const createClient = async () => {
    if (!form.name.trim() || !profile?.tenant_id) return;
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        doc: form.doc || null,
        type: form.type,
        status: form.status,
        area: form.area || null,
        value_cents: Math.round(form.value * 100),
        owner: profile.full_name?.trim() || null,
        is_hot: false,
      };
      await create.mutateAsync(payload);
      setOpen(false);
      setForm({ name: "", email: "", phone: "", doc: "", type: "PF", status: "novo_contato", area: "", value: 0 });
    } catch {
      // toast handled by mutation
    }
  };

  const moveStageHandler = async (id: string, status: string) => {
    const client = clients.find((item) => item.id === id);
    if (!client || stageOf(client.status) === status) return;
    try {
      await moveStage.mutateAsync({
        id,
        status,
        prevStatus: client.status,
        expectedVersion: client.status_version,
      });
      if (selected?.id === id) {
        setSelected((prev) => prev ? {
          ...prev,
          status,
          status_version: prev.status_version + 1,
          updated_at: new Date().toISOString(),
        } : null);
      }
    } catch {
      // O hook apresenta a falha e restaura o estado otimista.
    }
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveClientId(String(active.id));
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveClientId(null);
    if (!over) return;

    const overId = String(over.id);
    const targetStage = STAGES.some((stage) => stage.id === overId)
      ? overId
      : stageOf(clients.find((client) => client.id === overId)?.status ?? "");
    if (!STAGES.some((stage) => stage.id === targetStage)) return;

    await moveStageHandler(String(active.id), targetStage);
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
    if (file.size > 5 * 1024 * 1024) {
      toast.error("O arquivo deve ter no máximo 5 MB.");
      return;
    }

    try {
      const text = await file.text();
      const result = parseCrmImportCsv(text, {
        maxRows: 5_000,
        defaultOwner: profile.full_name?.trim() || null,
      });
      if (!result.records.length) {
        const detail = result.issues[0]?.message ?? "O arquivo está vazio.";
        toast.error(`Nenhum registro válido. ${detail}`);
        return;
      }

      const payload = result.records.map((record) => ({
        ...record,
        tenant_id: profile.tenant_id!,
        created_by: profile.id,
      }));

      // One SQL statement means the import is all-or-nothing: a rejected row
      // cannot leave a partially imported client base behind.
      const { error: insertError } = await supabase.from("clients").insert(payload);
      if (insertError) throw insertError;

      const warning = result.issues.length
        ? ` ${result.issues.length} linha(s) foram ignoradas; revise o arquivo.`
        : "";
      toast.success(`${payload.length} cliente(s) importado(s).${warning}`, {
        duration: result.issues.length ? 7_000 : 4_000,
      });
      qc.invalidateQueries({ queryKey: ["clients", profile.tenant_id] });
    } catch (importError) {
      console.error("[CRM_IMPORT_FAILED]", {
        kind: importError instanceof Error ? importError.name : "unknown",
      });
      toast.error("Não foi possível concluir a importação. Revise o arquivo e tente novamente.");
    }
  };

  const exportReport = () => {
    if (!filtered.length) return toast.error("Nenhum cliente para exportar");
    const rows = filtered.map((c) => {
      const m = getMeta(c);
      const canonicalStage = stageOf(c.status);
      const stageLabel = STAGES.find((s) => s.id === canonicalStage)?.label ?? canonicalStage;
      return {
        name: c.name,
        email: c.email ?? "",
        phone: c.phone ? `'${c.phone}` : "",
        doc: c.doc ? `'${c.doc}` : "",
        type: c.type,
        status: canonicalStage,
        stage_label: stageLabel,
        area: m.area,
        value: m.value,
        owner: m.owner,
        created_at: new Date(c.created_at).toLocaleDateString("pt-BR"),
        updated_at: new Date(c.updated_at).toLocaleDateString("pt-BR"),
      };
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`crm-clientes-${stamp}.csv`, createCsv(rows));
    toast.success(`Relatório exportado (${rows.length} registros)`);
  };

  const resetAdv = () => setAdv({ areas: [], stages: [], minValue: "", maxValue: "", hotOnly: false, search: "" });
  const toggle = (key: "areas" | "stages", v: string) =>
    setAdv(a => ({ ...a, [key]: a[key].includes(v) ? a[key].filter(x => x !== v) : [...a[key], v] }));
  const activeClient = activeClientId
    ? clients.find((client) => client.id === activeClientId) ?? null
    : null;
  const movingClientId = moveStage.isPending ? String(moveStage.variables?.id ?? "") : null;

  return (
    <div className="relative min-h-full overflow-hidden bg-muted/30">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-40">
        <div className="absolute left-1/3 top-0 h-[600px] w-[600px] rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute right-0 top-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      {/* CRM header */}
      <header className="flex flex-col gap-4 border-b border-border bg-card px-5 py-4 md:flex-row md:items-center md:justify-between lg:px-8">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Módulo comercial
          </p>
          <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">CRM</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gerencie oportunidades, clientes e contratos em um só lugar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
          <Button onClick={() => fileRef.current?.click()} variant="outline" size="sm" className="h-8 border-border/80 text-xs gap-1.5 font-medium">
            <Upload className="h-3.5 w-3.5" /> Importar CSV
          </Button>
          <Button onClick={exportReport} variant="outline" size="sm" className="h-8 border-border/80 text-xs gap-1.5 font-medium">
            <Download className="h-3.5 w-3.5" /> Exportar Relatório
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-xs font-semibold gap-1.5 shadow-sm">
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
                      <SelectTrigger className="text-xs mt-1 h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>{AREAS.map(a => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">Honorário estimado</Label><CurrencyInput className="text-xs mt-1 h-9" valueInCents={Math.round(form.value * 100)} onValueChange={value => setForm({ ...form, value: (value ?? 0) / 100 })} /></div>
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

      {/* Operational metrics — all values come from the same client source as the board. */}
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <OperationalMetric label="Novos hoje" value={String(operationalMetrics.newToday)} />
        <OperationalMetric label="Sem responsável" value={String(operationalMetrics.unassigned)} />
        <OperationalMetric label="Leads quentes" value={String(operationalMetrics.hot)} />
        <OperationalMetric label="Pipeline aberto" value={brl(operationalMetrics.pipeline)} />
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col items-stretch justify-between gap-3 border-b border-border bg-card px-5 py-3 sm:flex-row sm:items-center lg:px-8">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Visões rápidas do CRM">
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
              aria-pressed={filter === f.id}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all whitespace-nowrap ${
                filter === f.id
                  ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              <f.icon className="h-3.5 w-3.5" />
              <span>{f.label}</span>
            </button>
          ))}
        </div>

        {/* Search + View Toggle + Advanced Popover */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1 sm:flex-none">
            <Input
              placeholder="Pesquisar clientes..."
              aria-label="Pesquisar clientes por nome, e-mail ou documento"
              value={adv.search}
              onChange={(e) => setAdv({ ...adv, search: e.target.value })}
              className="h-8 rounded-md text-xs pl-3 pr-8"
            />
          </div>

          <div className="flex items-center p-1 rounded-lg border border-border bg-muted/30" role="group" aria-label="Modo de visualização">
            <button
              onClick={() => setView("funil")}
              aria-pressed={view === "funil"}
              className={`inline-flex items-center gap-1 h-6 px-2 rounded text-xs font-medium transition-all ${
                view === "funil" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
              }`}
            >
              <LayoutGrid className="h-3 w-3" />
              <span>Kanban</span>
            </button>
            <button
              onClick={() => setView("lista")}
              aria-pressed={view === "lista"}
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
                <Label className="text-xs font-semibold text-muted-foreground">Etapas</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {STAGES.map((stage) => (
                    <label key={stage.id} className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                      <Checkbox
                        checked={adv.stages.includes(stage.id)}
                        onCheckedChange={() => toggle("stages", stage.id)}
                      />
                      <span className="truncate">{stage.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border/70 p-2 text-xs text-foreground">
                <Checkbox
                  checked={adv.hotOnly}
                  onCheckedChange={(checked) => setAdv({ ...adv, hotOnly: checked === true })}
                />
                Mostrar somente leads marcados como quentes
              </label>

              <div>
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Faixa de valor</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <CurrencyInput placeholder="Mín" valueInCents={adv.minValue ? Math.round(Number(adv.minValue) * 100) : undefined} onValueChange={value => setAdv({ ...adv, minValue: value == null ? "" : String(value / 100) })} className="h-8 text-xs" />
                  <CurrencyInput placeholder="Máx" valueInCents={adv.maxValue ? Math.round(Number(adv.maxValue) * 100) : undefined} onValueChange={value => setAdv({ ...adv, maxValue: value == null ? "" : String(value / 100) })} className="h-8 text-xs" />
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {isError ? (
        <div className="m-5 flex min-h-[320px] items-center justify-center rounded-xl border border-destructive/25 bg-card p-8 text-center" role="alert">
          <div className="max-w-md">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-foreground">Não foi possível carregar o CRM</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Seus dados continuam protegidos. Verifique a conexão e tente novamente.
            </p>
            <Button
              variant="outline"
              className="mt-4 gap-2"
              onClick={() => void qc.refetchQueries({ queryKey: ["clients", profile?.tenant_id], type: "active" })}
            >
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </Button>
          </div>
        </div>
      ) : view === "funil" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragCancel={() => setActiveClientId(null)}
          onDragEnd={(event) => void handleDragEnd(event)}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Para mover um cliente, pressione Espaço. Use as setas para escolher a nova etapa e pressione Espaço novamente para confirmar. Pressione Escape para cancelar.",
            },
            announcements: {
              onDragStart: ({ active }) => `Movendo ${clients.find((client) => client.id === String(active.id))?.name ?? "cliente"}.`,
              onDragOver: ({ over }) => over ? `Sobre ${STAGES.find((stage) => stage.id === String(over.id))?.label ?? "outro cliente"}.` : "Fora de uma etapa.",
              onDragEnd: ({ over }) => over ? "Movimentação solicitada." : "Movimentação cancelada.",
              onDragCancel: () => "Movimentação cancelada.",
            },
          }}
        >
          <div className="flex min-h-[calc(100vh-260px)] items-start gap-3 overflow-x-auto bg-muted/60 p-4 pb-6">
            {grouped.map((col) => (
              <KanbanStage
                key={col.id}
                id={col.id}
                label={col.label}
                subtitle={col.subtitle}
                color={col.color}
                totalValue={col.totalValue}
                itemIds={col.items.map((client) => client.id)}
                isLoading={isLoading}
              >
                {col.items.map((client) => (
                  <CrmKanbanCard
                    key={client.id}
                    client={client}
                    meta={getMeta(client)}
                    disabled={movingClientId === client.id}
                    onClick={handleCardClick as (client: ClientCardData) => void}
                    onOpenWhatsapp={openWhatsapp}
                    onQuickAction={(action, quickActionClient) => {
                      if (action === "schedule") {
                        toast.info("A criação de tarefas será habilitada na próxima etapa do CRM.");
                      } else if (action === "note") {
                        handleCardClick(quickActionClient as unknown as Client);
                      }
                    }}
                  />
                ))}
              </KanbanStage>
            ))}
          </div>

          <DragOverlay>
            {activeClient ? (
              <div className="w-[304px] rounded-xl border border-primary/40 bg-card p-4 shadow-2xl">
                <p className="text-sm font-semibold text-foreground">{activeClient.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {getMeta(activeClient).area} · {brl(getMeta(activeClient).value)}
                </p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        /* Table View */
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
          <table className="w-full min-w-[920px] text-xs">
            <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="text-left p-3 pl-4">Cliente / Lead</th>
                <th className="text-left p-3">Contato</th>
                <th className="text-left p-3">Área Jurídica</th>
                <th className="text-left p-3">Etapa do Funil</th>
                <th className="text-right p-3">Honorário Estimado</th>
                <th className="text-left p-3">Na etapa</th>
                <th className="p-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {isLoading && Array.from({ length: 5 }).map((_, index) => (
                <tr key={`loading-${index}`}>
                  <td colSpan={7} className="p-3">
                    <div className="skeleton h-8 rounded-md" />
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.map((c) => {
                const m = getMeta(c);
                const stage = STAGES.find((s) => s.id === stageOf(c.status)) ?? STAGES[0];
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    onClick={() => handleCardClick(c)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleCardClick(c);
                      }
                    }}
                    aria-label={`Abrir cliente ${c.name}`}
                  >
                    <td className="p-3 pl-4 font-semibold text-foreground">
                      <div className="flex items-center gap-2">
                        <span>{c.name}</span>
                        {m.hot && (
                          <Badge className="bg-destructive/12 px-1.5 py-0 text-xs text-destructive">Quente</Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{c.phone || c.email || "—"}</td>
                    <td className="p-3"><Badge variant="outline" className="text-xs">{m.area}</Badge></td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                        {stage.label}
                      </span>
                    </td>
                    <td className="p-3 text-right font-bold text-foreground">{brl(m.value)}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {elapsedLabel(c.stage_entered_at ?? c.updated_at)}
                    </td>
                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/10"
                        title="Abrir WhatsApp"
                        aria-label={`Abrir WhatsApp de ${c.name}`}
                        onClick={() => openWhatsapp(c.phone, c.name)}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-muted-foreground text-xs">
                    {clients.length === 0
                      ? "Nenhum cliente cadastrado. Use “Novo Lead / Cliente” para começar."
                      : "Nenhum cliente corresponde aos filtros atuais."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Conversational CRM drawer */}
      <CrmLeadDrawer
        client={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        meta={selected ? getMeta(selected) : { area: "Não definido", value: 0, valueCents: 0, owner: "Sem responsável", hot: false }}
        stages={STAGES}
        onUpdateStage={moveStageHandler}
        onSaveNotes={saveNotes}
      />
    </div>
  );
}

function OperationalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-5 py-3 lg:px-8">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function KanbanStage({
  id,
  label,
  subtitle,
  color,
  totalValue,
  itemIds,
  isLoading,
  children,
}: {
  id: string;
  label: string;
  subtitle: string;
  color: string;
  totalValue: number;
  itemIds: string[];
  isLoading: boolean;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    data: { type: "crm-stage", stageId: id },
  });

  return (
    <section
      ref={setNodeRef}
      aria-label={`Etapa ${label}, ${itemIds.length} clientes`}
      className={`flex min-h-[540px] w-[304px] shrink-0 flex-col rounded-xl border p-2.5 transition-colors ${
        isOver
          ? "border-primary/50 bg-primary/10 ring-2 ring-primary/20"
          : "border-border/70 bg-muted/75"
      }`}
    >
      <div className="sticky top-0 z-10 mb-3 rounded-lg bg-muted/95 px-1 pb-2 pt-1 backdrop-blur">
        <div className="mb-2 h-1 w-full rounded-full" style={{ backgroundColor: color }} />
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">{label}</h3>
          <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-muted-foreground shadow-sm">
            {itemIds.length}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{subtitle}</span>
          <span className="rounded bg-card px-1.5 py-0.5 font-semibold tabular-nums text-foreground">
            {brl(totalValue)}
          </span>
        </div>
      </div>

      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div className="flex-1 space-y-2.5 overflow-y-auto pr-0.5">
          {isLoading
            ? Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="skeleton h-32 rounded-xl" />
              ))
            : children}
          {!isLoading && itemIds.length === 0 && (
            <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center">
              <p className="text-xs font-medium text-muted-foreground">Nenhum contato nesta etapa</p>
              <p className="mt-1 text-xs text-muted-foreground/80">
                Arraste um card para cá ou cadastre um novo contato.
              </p>
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
