import { Fragment, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Plus, Trash2, AlertTriangle, CheckCircle2, Calendar as CalIcon,
  Gavel, Sparkles, FileText, Users, ChevronRight, ChevronLeft, Bell, Brain, Flame,
} from "lucide-react";
import { PageHeader } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAgenda } from "@/hooks/use-agenda";
import { useMetricsAgenda } from "@/hooks/use-metrics";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/agenda")({
  head: () => ({ meta: [{ title: "Agenda & Prazos — Advora" }] }),
  component: Agenda,
});

type Deadline = {
  id: string;
  title: string;
  kind: string;
  due_at: string;
  done: boolean;
  priority: string | null;
  case_id: string | null;
  client_id: string | null;
  completed_at: string | null;
  cases?: { id: string; title: string; number: string | null } | null;
  clients?: { id: string; name: string } | null;
};

const KIND_STYLES: Record<string, { ring: string; bg: string; text: string; icon: typeof Gavel; label: string; hex: string }> = {
  audiencia:   { ring: "ring-violet-500/30", bg: "bg-violet-500/10", text: "text-violet-600 dark:text-violet-300", icon: Gavel,          label: "Audiência",  hex: "#8b5cf6" },
  prazo:       { ring: "ring-rose-500/30",   bg: "bg-rose-500/10",   text: "text-rose-600 dark:text-rose-300",     icon: AlertTriangle,  label: "Prazo",      hex: "#f43f5e" },
  reuniao:     { ring: "ring-sky-500/30",    bg: "bg-sky-500/10",    text: "text-sky-600 dark:text-sky-300",       icon: Users,          label: "Reunião",    hex: "#0ea5e9" },
  compromisso: { ring: "ring-sky-500/30",    bg: "bg-sky-500/10",    text: "text-sky-600 dark:text-sky-300",       icon: Users,          label: "Compromisso",hex: "#0ea5e9" },
  protocolo:   { ring: "ring-emerald-500/30",bg: "bg-emerald-500/10",text: "text-emerald-600 dark:text-emerald-300",icon: FileText,      label: "Protocolo",  hex: "#10b981" },
  tarefa:      { ring: "ring-amber-500/30",  bg: "bg-amber-500/10",  text: "text-amber-600 dark:text-amber-300",   icon: FileText,       label: "Tarefa",     hex: "#f59e0b" },
};

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

type ListFilter = "vencendo_hoje" | "amanha" | "atraso" | "concluidos_hoje" | null;

function Agenda() {
  const navigate = useNavigate();
  const { deadlines: items, cases, clients, lastComms, isLoading: loading, create, toggle, remove } = useAgenda();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"dia" | "semana" | "mes">("semana");
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));
  const [listFilter, setListFilter] = useState<ListFilter>(null);
  const [form, setForm] = useState({
    title: "", kind: "prazo", due_at: "", case_id: "", client_id: "", priority: "media",
  });

  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const yesterday = addDays(today, -1);

  // KPIs (from Postgres RPC — zero front-end aggregation)
  const { data: agMetrics } = useMetricsAgenda();
  const kpis = useMemo(() => {
    const m = agMetrics;
    const delta = (t: number, y: number) => t === y ? "Igual ontem" : `${t > y ? "+" : ""}${t - y} vs ontem`;
    return [
      { label: "Audiências Hoje", value: m?.audiencias_hoje ?? 0,   delta: m ? delta(m.audiencias_hoje, m.audiencias_yday) : "",     icon: Gavel,          tone: "text-violet-600 dark:text-violet-300", bg: "from-violet-500/15" },
      { label: "Prazos Hoje",     value: m?.prazos_hoje ?? 0,       delta: m ? delta(m.prazos_hoje, m.prazos_yday) : "",             icon: AlertTriangle,  tone: "text-rose-600 dark:text-rose-300",     bg: "from-rose-500/15" },
      { label: "Compromissos",    value: m?.compromissos_hoje ?? 0, delta: m ? delta(m.compromissos_hoje, m.compromissos_yday) : "", icon: CalIcon,        tone: "text-sky-600 dark:text-sky-300",       bg: "from-sky-500/15" },
      { label: "Risco de Atraso", value: m?.risco_48h ?? 0,         delta: m?.atraso ? `${m.atraso} em atraso` : "",                 icon: Flame,          tone: "text-amber-600 dark:text-amber-300",   bg: "from-amber-500/15" },
    ];
  }, [agMetrics]);


  // Selected day items
  const dayItems = useMemo(() => {
    const s = startOfDay(selectedDate);
    const e = addDays(s, 1);
    return items.filter(d => { const t = new Date(d.due_at); return t >= s && t < e; })
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  }, [items, selectedDate]);

  // Week grid
  const weekStart = useMemo(() => {
    const d = new Date(selectedDate);
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day;
    return startOfDay(addDays(d, diff));
  }, [selectedDate]);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekHours = Array.from({ length: 12 }, (_, i) => 7 + i); // 7-18h

  // Month grid
  const monthStart = useMemo(() => { const d = new Date(selectedDate); d.setDate(1); d.setHours(0, 0, 0, 0); return d; }, [selectedDate]);
  const monthGrid = useMemo(() => {
    const startWeekday = monthStart.getDay(); // 0=Sun
    const offset = startWeekday === 0 ? -6 : 1 - startWeekday;
    const gridStart = addDays(monthStart, offset);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [monthStart]);
  const monthCount = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach(it => {
      const k = startOfDay(new Date(it.due_at)).toISOString();
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return m;
  }, [items]);

  // Alerts
  const alerts = useMemo(() => ({
    vencendo_hoje: items.filter(d => !d.done && new Date(d.due_at) >= today && new Date(d.due_at) < tomorrow),
    amanha:        items.filter(d => !d.done && new Date(d.due_at) >= tomorrow && new Date(d.due_at) < dayAfter),
    atraso:        items.filter(d => !d.done && new Date(d.due_at) < now),
    concluidos_hoje: items.filter(d => d.done && d.completed_at && new Date(d.completed_at) >= today && new Date(d.completed_at) < tomorrow),
  }), [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // IA suggestions (real data)
  const suggestions = useMemo(() => {
    const out: { p: "Alta" | "Média" | "Ação"; color: string; text: string; onClick?: () => void }[] = [];
    const upcoming = items
      .filter(d => !d.done && new Date(d.due_at).getTime() > now.getTime() && new Date(d.due_at).getTime() - now.getTime() < 24 * 3600 * 1000)
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0];
    if (upcoming) {
      const hours = Math.max(1, Math.round((new Date(upcoming.due_at).getTime() - now.getTime()) / 3600 / 1000));
      const ref = upcoming.cases?.number ?? upcoming.cases?.title ?? upcoming.title;
      out.push({
        p: "Alta", color: "text-rose-600 dark:text-rose-300 bg-rose-500/15 border-rose-500/30",
        text: `Prazo do processo ${ref} vence em ${hours}h.`,
        onClick: upcoming.case_id ? () => navigate({ to: "/processos" }) : undefined,
      });
    }
    // client with longest silence
    let staleClient: { id: string; name: string; days: number } | null = null;
    clients.forEach(c => {
      const last = lastComms.get(c.id);
      const days = last ? Math.floor((now.getTime() - new Date(last).getTime()) / (24 * 3600 * 1000)) : 999;
      if (days >= 3 && (!staleClient || days > staleClient.days)) staleClient = { id: c.id, name: c.name, days: Math.min(days, 60) };
    });
    if (staleClient) {
      const sc = staleClient as { id: string; name: string; days: number };
      out.push({
        p: "Média", color: "text-amber-600 dark:text-amber-300 bg-amber-500/15 border-amber-500/30",
        text: `Cliente ${sc.name} sem retorno há ${sc.days} dias.`,
        onClick: () => navigate({ to: "/crm" }),
      });
    }
    const nextProto = items
      .filter(d => !d.done && d.kind === "protocolo" && new Date(d.due_at).getTime() > now.getTime())
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0];
    if (nextProto) {
      const when = new Date(nextProto.due_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      const ref = nextProto.cases?.number ?? nextProto.cases?.title ?? nextProto.title;
      out.push({
        p: "Ação", color: "text-violet-600 dark:text-violet-300 bg-violet-500/15 border-violet-500/30",
        text: `Protocolar petição no processo ${ref} até ${when}.`,
      });
    }
    return out;
  }, [items, clients, lastComms, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredList = listFilter ? alerts[listFilter] : null;

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Agenda & Prazos"
        subtitle="Audiências, prazos processuais e compromissos."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setSelectedDate(addDays(selectedDate, view === "mes" ? -30 : view === "semana" ? -7 : -1))}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedDate(startOfDay(new Date()))}>Hoje</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedDate(addDays(selectedDate, view === "mes" ? 30 : view === "semana" ? 7 : 1))}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="flex items-center gap-1 glass rounded-xl p-1">
              {(["dia", "semana", "mes"] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${view === v ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {v === "mes" ? "Mês" : v}
                </button>
              ))}
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button className="bg-[image:var(--gradient-brand)] hover-lift"><Plus className="size-4 mr-1" /> Novo prazo</Button></DialogTrigger>
              <DialogContent className="glass">
                <DialogHeader><DialogTitle>Novo evento / prazo</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <div><Label>Título*</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Tipo</Label>
                      <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(KIND_STYLES).map(([k, s]) => <SelectItem key={k} value={k}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Prioridade</Label>
                      <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="alta">Alta</SelectItem>
                          <SelectItem value="media">Média</SelectItem>
                          <SelectItem value="baixa">Baixa</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div><Label>Data e hora*</Label><Input type="datetime-local" value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Processo</Label>
                      <Select value={form.case_id} onValueChange={v => setForm({ ...form, case_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                        <SelectContent>{cases.map(c => <SelectItem key={c.id} value={c.id}>{c.number ? `${c.number} · ` : ""}{c.title}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Cliente</Label>
                      <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                        <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={async () => {
                    if (!form.title.trim() || !form.due_at) {
                      toast.error("Preencha título e data");
                      return;
                    }
                    try {
                      await create({
                        title: form.title,
                        kind: form.kind,
                        priority: form.priority,
                        due_at: new Date(form.due_at).toISOString(),
                        case_id: form.case_id || null,
                        client_id: form.client_id || null,
                      });
                      setOpen(false);
                      setForm({ title: "", kind: "prazo", due_at: "", case_id: "", client_id: "", priority: "media" });
                    } catch {
                      // error handled by mutation toast
                    }
                  }} className="mt-2 bg-[image:var(--gradient-brand)]">Criar</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* KPIs */}
      <section className="stagger grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {kpis.map(k => (
          <div key={k.label} className={`glass hover-lift rounded-2xl p-4 bg-gradient-to-br ${k.bg} to-transparent`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`size-9 rounded-xl bg-card/60 border border-border/40 grid place-items-center ${k.tone}`}>
                <k.icon className="size-4" />
              </div>
            </div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5">{loading ? "—" : k.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{k.delta}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        <div className="space-y-5">
          {/* Timeline do dia selecionado */}
          <section className="glass rounded-2xl p-5 animate-fade-up">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {sameDay(selectedDate, today) ? "Timeline de hoje" : "Timeline do dia"}
                </p>
                <h3 className="text-lg font-bold mt-0.5">
                  {selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
                </h3>
              </div>
              <Badge variant="outline" className="text-[10px]">{dayItems.length} evento{dayItems.length === 1 ? "" : "s"}</Badge>
            </div>
            {dayItems.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <CalIcon className="size-8 mx-auto mb-2 opacity-40" />
                Nenhum evento agendado para este dia.
              </div>
            ) : (
              <div className="relative pl-6 space-y-3 before:absolute before:left-2 before:top-0 before:bottom-0 before:w-px before:bg-border">
                {dayItems.map(d => {
                  const s = KIND_STYLES[d.kind] ?? KIND_STYLES.tarefa;
                  const subtitle = d.cases?.number
                    ? `Proc. ${d.cases.number}${d.cases.title ? ` · ${d.cases.title}` : ""}`
                    : d.cases?.title ?? d.clients?.name ?? s.label;
                  return (
                    <div key={d.id} className="relative">
                      <span className={`absolute -left-[18px] top-2 size-3 rounded-full ${s.bg} ring-2 ${s.ring}`} />
                      <button
                        className="w-full text-left glass hover-lift rounded-xl p-3 flex items-start gap-3"
                        onClick={() => {
                          if (d.case_id) navigate({ to: "/processos" });
                          else if (d.client_id) navigate({ to: "/crm" });
                        }}
                      >
                        <span className="text-xs font-bold tabular-nums text-muted-foreground w-12 shrink-0 mt-0.5">
                          {new Date(d.due_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-semibold truncate ${d.done ? "line-through text-muted-foreground" : ""}`}>{d.title}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
                        </div>
                        <s.icon className={`size-4 shrink-0 ${s.text}`} />
                        <span
                          onClick={(e) => { e.stopPropagation(); toggle(d); }}
                          className={`shrink-0 cursor-pointer ${d.done ? "text-emerald-500" : "text-muted-foreground hover:text-primary"}`}
                        >
                          <CheckCircle2 className="size-4" />
                        </span>
                        <span
                          onClick={(e) => { e.stopPropagation(); remove(d.id); }}
                          className="shrink-0 cursor-pointer text-muted-foreground hover:text-rose-400"
                        >
                          <Trash2 className="size-3.5" />
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Week view */}
          {view === "semana" && (
            <section className="glass rounded-2xl p-5 animate-fade-up overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">
                  {weekStart.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – {weekDays[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <div className="grid grid-cols-[48px_repeat(7,minmax(90px,1fr))] gap-px bg-border/30 rounded-xl overflow-hidden min-w-[700px]">
                  <div className="bg-card/40 p-2"></div>
                  {weekDays.map((d, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedDate(startOfDay(d))}
                      className={`bg-card/40 p-2 text-center hover:bg-card/60 ${sameDay(d, today) ? "bg-primary/15" : ""} ${sameDay(d, selectedDate) ? "ring-1 ring-primary/40" : ""}`}
                    >
                      <p className="text-[10px] uppercase text-muted-foreground">{d.toLocaleDateString("pt-BR", { weekday: "short" })}</p>
                      <p className={`text-sm font-bold ${sameDay(d, today) ? "text-primary" : ""}`}>{d.getDate()}</p>
                    </button>
                  ))}
                  {weekHours.map(h => (
                    <Fragment key={`h-${h}`}>
                      <div className="bg-card/20 p-2 text-[10px] text-muted-foreground text-right tabular-nums">{h}:00</div>
                      {weekDays.map((day, di) => {
                        const cellStart = new Date(day); cellStart.setHours(h, 0, 0, 0);
                        const cellEnd = new Date(day); cellEnd.setHours(h + 1, 0, 0, 0);
                        const cellItems = items.filter(it => {
                          const t = new Date(it.due_at);
                          return t >= cellStart && t < cellEnd;
                        });
                        return (
                          <div key={`${h}-${di}`} className="bg-card/20 min-h-[44px] p-1 relative space-y-0.5">
                            {cellItems.map(it => {
                              const s = KIND_STYLES[it.kind] ?? KIND_STYLES.tarefa;
                              return (
                                <button
                                  key={it.id}
                                  onClick={() => { setSelectedDate(startOfDay(day)); if (it.case_id) navigate({ to: "/processos" }); }}
                                  className={`w-full text-left text-[10px] px-1.5 py-0.5 rounded ${s.bg} ${s.text} truncate border ${s.ring} ring-1 hover:opacity-80`}
                                  title={it.title}
                                >
                                  {new Date(it.due_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} {it.title}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Month view */}
          {view === "mes" && (
            <section className="glass rounded-2xl p-5 animate-fade-up overflow-hidden">
              <h3 className="text-sm font-semibold mb-4 capitalize">
                {monthStart.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
              </h3>
              <div className="grid grid-cols-7 gap-px bg-border/30 rounded-xl overflow-hidden">
                {["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map(w => (
                  <div key={w} className="bg-card/40 p-2 text-center text-[10px] uppercase text-muted-foreground">{w}</div>
                ))}
                {monthGrid.map((d, i) => {
                  const inMonth = d.getMonth() === monthStart.getMonth();
                  const count = monthCount.get(startOfDay(d).toISOString()) ?? 0;
                  const isToday = sameDay(d, today);
                  const isSel = sameDay(d, selectedDate);
                  return (
                    <button
                      key={i}
                      onClick={() => { setSelectedDate(startOfDay(d)); setView("dia"); }}
                      className={`bg-card/20 min-h-[72px] p-2 text-left hover:bg-card/40 ${!inMonth ? "opacity-40" : ""} ${isSel ? "ring-1 ring-primary/40" : ""}`}
                    >
                      <div className={`text-xs font-bold ${isToday ? "text-primary" : ""}`}>{d.getDate()}</div>
                      {count > 0 && (
                        <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px]">
                          <span className="size-1 rounded-full bg-primary" />{count}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          {/* IA */}
          <section className="glass rounded-2xl p-4 animate-fade-up bg-gradient-to-br from-violet-500/10 to-transparent border-l-2 border-l-violet-500/60">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="size-4 text-violet-600 dark:text-violet-300" />
              <h3 className="text-sm font-semibold">Sugestões da IA</h3>
            </div>
            <div className="space-y-2">
              {suggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">Sem sugestões no momento.</p>
              ) : suggestions.map((s, i) => (
                <button key={i} onClick={s.onClick} className="w-full text-left glass hover-lift rounded-xl p-3 group">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <Badge variant="outline" className={`text-[9px] ${s.color}`}>Prioridade {s.p}</Badge>
                    <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                  </div>
                  <p className="text-xs leading-relaxed">{s.text}</p>
                </button>
              ))}
              {suggestions.length > 0 && (
                <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground hover:text-foreground">
                  <Brain className="size-3.5 mr-1.5" /> Analisar mais
                </Button>
              )}
            </div>
          </section>

          {/* Alerts */}
          <section className="glass rounded-2xl p-4 animate-fade-up">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="size-4 text-amber-600 dark:text-amber-300" />
              <h3 className="text-sm font-semibold">Alertas</h3>
            </div>
            <div className="space-y-2">
              {([
                { key: "vencendo_hoje" as const, label: "Vencendo hoje", color: "text-rose-600 dark:text-rose-300", dot: "bg-rose-500" },
                { key: "amanha" as const, label: "Vencendo amanhã", color: "text-amber-600 dark:text-amber-300", dot: "bg-amber-500" },
                { key: "atraso" as const, label: "Em atraso", color: "text-orange-600 dark:text-orange-300", dot: "bg-orange-500" },
                { key: "concluidos_hoje" as const, label: "Concluídos hoje", color: "text-emerald-600 dark:text-emerald-300", dot: "bg-emerald-500" },
              ]).map(a => (
                <button
                  key={a.key}
                  onClick={() => setListFilter(a.key)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-card/40 border border-border/40 hover-lift"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`size-1.5 rounded-full ${a.dot} animate-pulse-soft`} />
                    <span className="text-xs">{a.label}</span>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${a.color}`}>{alerts[a.key].length}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Filtered list dialog */}
      <Dialog open={!!listFilter} onOpenChange={(o) => !o && setListFilter(null)}>
        <DialogContent className="glass max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {listFilter === "vencendo_hoje" && "Vencendo hoje"}
              {listFilter === "amanha" && "Vencendo amanhã"}
              {listFilter === "atraso" && "Em atraso"}
              {listFilter === "concluidos_hoje" && "Concluídos hoje"}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {(filteredList ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhum item.</p>
            ) : (filteredList ?? []).map(d => {
              const s = KIND_STYLES[d.kind] ?? KIND_STYLES.tarefa;
              return (
                <div key={d.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/40 hover:bg-card/40">
                  <s.icon className={`size-4 mt-0.5 ${s.text}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{d.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {new Date(d.due_at).toLocaleString("pt-BR")}{d.cases?.number ? ` · Proc. ${d.cases.number}` : ""}{d.clients?.name ? ` · ${d.clients.name}` : ""}
                    </p>
                  </div>
                  {!d.done && (
                    <Button size="sm" variant="ghost" onClick={() => toggle(d)}>
                      <CheckCircle2 className="size-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
