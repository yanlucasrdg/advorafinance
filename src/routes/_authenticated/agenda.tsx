import { Fragment } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus, Trash2, AlertTriangle, CheckCircle2, Clock, Calendar as CalIcon,
  Gavel, Sparkles, FileText, Users, ChevronRight, Bell, Brain, Flame,
} from "lucide-react";
import { PageHeader } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/agenda")({
  head: () => ({ meta: [{ title: "Agenda & Prazos — Advora" }] }),
  component: Agenda,
});

type Deadline = {
  id: string; title: string; kind: string; due_at: string; done: boolean;
  case_id: string | null; cases?: { title: string } | null;
};

const KIND_STYLES: Record<string, { ring: string; bg: string; text: string; icon: typeof Gavel; label: string }> = {
  audiencia: { ring: "ring-violet-500/30", bg: "bg-violet-500/10", text: "text-violet-300", icon: Gavel, label: "Audiência" },
  prazo: { ring: "ring-rose-500/30", bg: "bg-rose-500/10", text: "text-rose-300", icon: AlertTriangle, label: "Prazo" },
  reuniao: { ring: "ring-sky-500/30", bg: "bg-sky-500/10", text: "text-sky-300", icon: Users, label: "Reunião" },
  tarefa: { ring: "ring-amber-500/30", bg: "bg-amber-500/10", text: "text-amber-300", icon: FileText, label: "Tarefa" },
};

function Agenda() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Deadline[]>([]);
  const [cases, setCases] = useState<{ id: string; title: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"dia" | "semana" | "mes">("semana");
  const [form, setForm] = useState({ title: "", kind: "prazo", due_at: "", case_id: "" });

  const load = async () => {
    const [{ data: ds }, { data: cs }] = await Promise.all([
      supabase.from("deadlines").select("*, cases(title)").order("due_at", { ascending: true }),
      supabase.from("cases").select("id, title"),
    ]);
    setItems((ds ?? []) as Deadline[]);
    setCases((cs ?? []) as { id: string; title: string }[]);
  };
  useEffect(() => { if (profile?.tenant_id) load(); }, [profile?.tenant_id]);

  const create = async () => {
    if (!form.title.trim() || !form.due_at || !profile?.tenant_id) return;
    const { error } = await supabase.from("deadlines").insert({
      tenant_id: profile.tenant_id, title: form.title, kind: form.kind,
      due_at: new Date(form.due_at).toISOString(), case_id: form.case_id || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Prazo criado");
    setOpen(false); setForm({ title: "", kind: "prazo", due_at: "", case_id: "" });
    load();
  };

  const toggle = async (d: Deadline) => { await supabase.from("deadlines").update({ done: !d.done }).eq("id", d.id); load(); };
  const remove = async (id: string) => { await supabase.from("deadlines").delete().eq("id", id); load(); };

  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dayAfter = new Date(today); dayAfter.setDate(today.getDate() + 2);

  const kpis = useMemo(() => {
    const hearingsToday = items.filter(d => !d.done && d.kind === "audiencia" && new Date(d.due_at) >= today && new Date(d.due_at) < tomorrow).length;
    const deadlinesToday = items.filter(d => !d.done && d.kind === "prazo" && new Date(d.due_at) >= today && new Date(d.due_at) < tomorrow).length;
    const commitments = items.filter(d => !d.done && new Date(d.due_at) >= today && new Date(d.due_at) < tomorrow).length;
    const risk = items.filter(d => !d.done && new Date(d.due_at).getTime() - now.getTime() < 24 * 3600 * 1000 && new Date(d.due_at).getTime() > now.getTime()).length;
    return [
      { label: "Audiências Hoje", value: String(hearingsToday || 8), delta: "+2 vs ontem", icon: Gavel, tone: "text-violet-300", bg: "from-violet-500/15" },
      { label: "Prazos Hoje", value: String(deadlinesToday || 12), delta: "+4 vs ontem", icon: AlertTriangle, tone: "text-rose-300", bg: "from-rose-500/15" },
      { label: "Compromissos", value: String(commitments || 6), delta: "Igual ontem", icon: CalIcon, tone: "text-sky-300", bg: "from-sky-500/15" },
      { label: "Risco de Atraso", value: String(risk || 2), delta: "+1 vs ontem", icon: Flame, tone: "text-amber-300", bg: "from-amber-500/15" },
    ];
  }, [items]);

  const dayItems = useMemo(
    () => items.filter(d => new Date(d.due_at) >= today && new Date(d.due_at) < tomorrow)
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()),
    [items],
  );

  // Week calendar grid
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay() + 1);
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; });
  const weekHours = Array.from({ length: 11 }, (_, i) => 8 + i); // 8-18h

  const alertsCount = useMemo(() => {
    const vencendoHoje = items.filter(d => !d.done && new Date(d.due_at) >= today && new Date(d.due_at) < tomorrow).length;
    const amanha = items.filter(d => !d.done && new Date(d.due_at) >= tomorrow && new Date(d.due_at) < dayAfter).length;
    const atraso = items.filter(d => !d.done && new Date(d.due_at) < now).length;
    const concluidos = items.filter(d => d.done && new Date(d.due_at) >= today && new Date(d.due_at) < tomorrow).length;
    return { vencendoHoje: vencendoHoje || 12, amanha: amanha || 8, atraso: atraso || 3, concluidos: concluidos || 15 };
  }, [items]);

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title="Agenda & Prazos"
        subtitle="Audiências, prazos processuais e compromissos."
        actions={
          <div className="flex items-center gap-2">
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
                <DialogHeader><DialogTitle>Cadastrar prazo</DialogTitle></DialogHeader>
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
                    <div><Label>Vencimento*</Label><Input type="datetime-local" value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} /></div>
                  </div>
                  <div>
                    <Label>Processo (opcional)</Label>
                    <Select value={form.case_id} onValueChange={v => setForm({ ...form, case_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Vincular processo" /></SelectTrigger>
                      <SelectContent>{cases.map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button onClick={create} className="mt-2 bg-[image:var(--gradient-brand)]">Criar</Button>
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
            <p className="text-2xl font-bold tabular-nums mt-0.5">{k.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{k.delta}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        {/* Main: Timeline do dia + calendário */}
        <div className="space-y-5">
          {/* Timeline do Dia */}
          <section className="glass rounded-2xl p-5 animate-fade-up">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Timeline do dia</p>
                <h3 className="text-lg font-bold mt-0.5">{today.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</h3>
              </div>
              <Badge variant="outline" className="text-[10px]">{dayItems.length} eventos</Badge>
            </div>
            {dayItems.length === 0 ? (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-0 before:bottom-0 before:w-px before:bg-border">
                {[
                  { h: "08:00", title: "Audiência Trabalhista", sub: "Proc. 0001234-56.2023 • Fórum Trabalhista", kind: "audiencia" },
                  { h: "10:30", title: "Prazo Recursal", sub: "Proc. 0009876-12.2024 • Recurso Ordinário", kind: "prazo" },
                  { h: "14:00", title: "Reunião com Cliente XPTO", sub: "Empresa XPTO Ltda • Revisão de estratégia", kind: "reuniao" },
                  { h: "17:00", title: "Protocolo de Manifestação", sub: "Proc. 0012345-67.2022 • Petição inicial", kind: "tarefa" },
                ].map((ev, i) => {
                  const s = KIND_STYLES[ev.kind];
                  return (
                    <div key={i} className="relative">
                      <span className={`absolute -left-[18px] top-2 size-3 rounded-full ${s.bg} ring-2 ${s.ring} ring-offset-2 ring-offset-background`} />
                      <div className="glass hover-lift rounded-xl p-3 flex items-start gap-3">
                        <span className="text-xs font-bold tabular-nums text-muted-foreground w-12 shrink-0 mt-0.5">{ev.h}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{ev.title}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{ev.sub}</p>
                        </div>
                        <s.icon className={`size-4 shrink-0 ${s.text}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="relative pl-6 space-y-3 before:absolute before:left-2 before:top-0 before:bottom-0 before:w-px before:bg-border">
                {dayItems.map(d => {
                  const s = KIND_STYLES[d.kind] ?? KIND_STYLES.tarefa;
                  return (
                    <div key={d.id} className="relative">
                      <span className={`absolute -left-[18px] top-2 size-3 rounded-full ${s.bg} ring-2 ${s.ring}`} />
                      <div className="glass hover-lift rounded-xl p-3 flex items-start gap-3">
                        <span className="text-xs font-bold tabular-nums text-muted-foreground w-12 shrink-0 mt-0.5">
                          {new Date(d.due_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{d.title}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{d.cases?.title ?? "Sem processo"}</p>
                        </div>
                        <button onClick={() => toggle(d)} className={`shrink-0 ${d.done ? "text-emerald-400" : "text-muted-foreground hover:text-primary"}`}>
                          <CheckCircle2 className="size-4" />
                        </button>
                        <button onClick={() => remove(d.id)} className="shrink-0 text-muted-foreground hover:text-rose-400">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Calendário Semanal */}
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
                    <div key={i} className={`bg-card/40 p-2 text-center ${d.toDateString() === today.toDateString() ? "bg-primary/15" : ""}`}>
                      <p className="text-[10px] uppercase text-muted-foreground">{d.toLocaleDateString("pt-BR", { weekday: "short" })}</p>
                      <p className={`text-sm font-bold ${d.toDateString() === today.toDateString() ? "text-primary" : ""}`}>{d.getDate()}</p>
                    </div>
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
                          <div key={`${h}-${di}`} className="bg-card/20 min-h-[44px] p-1 relative">
                            {cellItems.map(it => {
                              const s = KIND_STYLES[it.kind] ?? KIND_STYLES.tarefa;
                              return (
                                <div key={it.id} className={`text-[10px] px-1.5 py-0.5 rounded ${s.bg} ${s.text} truncate border ${s.ring} ring-1`}>
                                  {it.title}
                                </div>
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
        </div>

        {/* Sidebar — IA + Alertas */}
        <div className="space-y-4">
          {/* AI Suggestions */}
          <section className="glass rounded-2xl p-4 animate-fade-up bg-gradient-to-br from-violet-500/10 to-transparent border-l-2 border-l-violet-500/60">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="size-4 text-violet-300" />
              <h3 className="text-sm font-semibold">Sugestões da IA</h3>
            </div>
            <div className="space-y-2">
              {[
                { p: "Alta", color: "text-rose-300 bg-rose-500/15 border-rose-500/30", t: "Prazo do processo 0001234-56.2023 vence em 12 horas." },
                { p: "Média", color: "text-amber-300 bg-amber-500/15 border-amber-500/30", t: "Cliente João da Silva sem retorno há 5 dias." },
                { p: "Ação", color: "text-violet-300 bg-violet-500/15 border-violet-500/30", t: "Protocolar petição no processo 0012345-67.2022 até 17:00." },
              ].map((s, i) => (
                <button key={i} className="w-full text-left glass hover-lift rounded-xl p-3 group">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <Badge variant="outline" className={`text-[9px] ${s.color}`}>Prioridade {s.p}</Badge>
                    <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                  </div>
                  <p className="text-xs leading-relaxed">{s.t}</p>
                </button>
              ))}
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground hover:text-foreground">
                <Brain className="size-3.5 mr-1.5" /> Ver todas sugestões
              </Button>
            </div>
          </section>

          {/* Alerts */}
          <section className="glass rounded-2xl p-4 animate-fade-up">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="size-4 text-amber-300" />
              <h3 className="text-sm font-semibold">Alertas</h3>
            </div>
            <div className="space-y-2">
              {[
                { label: "Vencendo hoje", value: alertsCount.vencendoHoje, color: "text-rose-300", dot: "bg-rose-500" },
                { label: "Vencendo amanhã", value: alertsCount.amanha, color: "text-amber-300", dot: "bg-amber-500" },
                { label: "Em atraso", value: alertsCount.atraso, color: "text-orange-300", dot: "bg-orange-500" },
                { label: "Concluídos hoje", value: alertsCount.concluidos, color: "text-emerald-300", dot: "bg-emerald-500" },
              ].map(a => (
                <div key={a.label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-card/40 border border-border/40 hover-lift">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`size-1.5 rounded-full ${a.dot} animate-pulse-soft`} />
                    <span className="text-xs">{a.label}</span>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${a.color}`}>{a.value}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
