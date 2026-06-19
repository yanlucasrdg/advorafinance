import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Briefcase, Clock, TrendingUp, AlertTriangle } from "lucide-react";
import { PageHeader, Panel, EmptyState, formatBRL } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/processos")({
  head: () => ({ meta: [{ title: "Processos — Advora" }] }),
  component: Processos,
});

type Case = { id: string; number: string | null; title: string; court: string | null; area: string | null; status: string; value_cents: number; client_id: string | null; clients?: { name: string } | null };
type Client = { id: string; name: string };
type Deadline = { id: string; case_id: string | null; due_at: string; done: boolean };
type Entry = { id: string; case_id: string | null; amount_cents: number; status: string; kind: string };
type Metrics = { pending: number; critical: boolean; nextDue: string | null; received: number; receivable: number };

const statusTone: Record<string, string> = {
  ativo: "bg-primary/15 text-primary border-primary/30",
  suspenso: "bg-warning/15 text-warning border-warning/30",
  arquivado: "bg-muted/40 text-muted-foreground border-border",
  ganho: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  perdido: "bg-destructive/15 text-destructive border-destructive/30",
};

function Processos() {
  const { profile } = useAuth();
  const [cases, setCases] = useState<Case[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ number: "", title: "", court: "", area: "civel", status: "ativo", value_cents: 0, client_id: "", description: "" });

  const load = async () => {
    setLoading(true);
    const [{ data: cs }, { data: cls }, { data: dls }, { data: fes }] = await Promise.all([
      supabase.from("cases").select("*, clients(name)").order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name").order("name"),
      supabase.from("deadlines").select("id, case_id, due_at, done"),
      supabase.from("financial_entries").select("id, case_id, amount_cents, status, kind"),
    ]);
    setCases((cs ?? []) as Case[]);
    setClients((cls ?? []) as Client[]);
    setDeadlines((dls ?? []) as Deadline[]);
    setEntries((fes ?? []) as Entry[]);
    setLoading(false);
  };
  useEffect(() => { if (profile?.tenant_id) load(); }, [profile?.tenant_id]);

  const metricsByCase = useMemo(() => {
    const map = new Map<string, Metrics>();
    const now = Date.now();
    const in48 = now + 48 * 3600 * 1000;
    for (const c of cases) map.set(c.id, { pending: 0, critical: false, nextDue: null, received: 0, receivable: 0 });
    for (const d of deadlines) {
      if (!d.case_id || d.done) continue;
      const m = map.get(d.case_id); if (!m) continue;
      const t = new Date(d.due_at).getTime();
      if (t < now) continue;
      m.pending += 1;
      if (t <= in48) m.critical = true;
      if (!m.nextDue || t < new Date(m.nextDue).getTime()) m.nextDue = d.due_at;
    }
    for (const e of entries) {
      if (!e.case_id || e.kind !== "receita") continue;
      const m = map.get(e.case_id); if (!m) continue;
      if (e.status === "pago") m.received += e.amount_cents ?? 0;
      else if (e.status === "pendente") m.receivable += e.amount_cents ?? 0;
    }
    return map;
  }, [cases, deadlines, entries]);

  const totals = useMemo(() => {
    const t = { active: 0, value: 0, pendingDeadlines: 0, criticalCases: 0 };
    for (const c of cases) {
      if (c.status === "ativo") t.active += 1;
      t.value += c.value_cents ?? 0;
      const m = metricsByCase.get(c.id);
      if (m) { t.pendingDeadlines += m.pending; if (m.critical) t.criticalCases += 1; }
    }
    return t;
  }, [cases, metricsByCase]);

  const create = async () => {
    if (!form.title.trim() || !profile?.tenant_id) return;
    const { error } = await supabase.from("cases").insert({
      tenant_id: profile.tenant_id,
      title: form.title,
      number: form.number || null,
      court: form.court || null,
      area: form.area,
      status: form.status,
      value_cents: form.value_cents,
      description: form.description || null,
      client_id: form.client_id || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Processo criado");
    setOpen(false);
    setForm({ number: "", title: "", court: "", area: "civel", status: "ativo", value_cents: 0, client_id: "", description: "" });
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("cases").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const kpis = [
    { label: "Processos ativos", value: String(totals.active), icon: Briefcase, tone: "text-primary" },
    { label: "Valor em causa", value: formatBRL(totals.value), icon: TrendingUp, tone: "text-emerald-400" },
    { label: "Prazos pendentes", value: String(totals.pendingDeadlines), icon: Clock, tone: "text-warning" },
    { label: "Processos críticos (48h)", value: String(totals.criticalCases), icon: AlertTriangle, tone: "text-destructive" },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Gestão Processual"
        subtitle="Processos, valores em causa, prazos e financeiro por caso."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-[image:var(--gradient-brand)] hover-lift"><Plus className="size-4 mr-1" /> Novo processo</Button></DialogTrigger>
            <DialogContent className="glass max-w-lg">
              <DialogHeader><DialogTitle>Cadastrar processo</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Título*</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Número CNJ</Label><Input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} /></div>
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
                      <SelectContent>{["ativo", "suspenso", "arquivado", "ganho", "perdido"].map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
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
        }
      />

      <section className="stagger grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {kpis.map(k => (
          <div key={k.label} className="glass rounded-2xl p-4 hover-lift">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider truncate">{k.label}</p>
                <p className="text-lg font-bold tabular-nums mt-1 truncate">{k.value}</p>
              </div>
              <div className="size-8 rounded-lg bg-primary/10 grid place-items-center shrink-0">
                <k.icon className={`size-4 ${k.tone}`} />
              </div>
            </div>
          </div>
        ))}
      </section>

      <Panel className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-12 w-full" />)}
          </div>
        ) : cases.length === 0 ? (
          <EmptyState title="Nenhum processo cadastrado" hint="Clique em 'Novo processo' para começar." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-card/40 border-b border-border/60">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Processo</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Área</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Métricas</th>
                <th className="px-4 py-3 font-medium text-right">Valor</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="stagger">
              {cases.map(c => {
                const m = metricsByCase.get(c.id);
                const next = m?.nextDue ? new Date(m.nextDue) : null;
                const tone = statusTone[c.status] ?? "bg-muted/40 text-muted-foreground border-border";
                return (
                  <tr key={c.id} className="row-hover border-b border-border/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="size-8 rounded-lg bg-primary/10 grid place-items-center shrink-0">
                          <Briefcase className="size-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{c.title}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{c.number || "Sem número"} • {c.court || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{c.clients?.name ?? "—"}</td>
                    <td className="px-4 py-3 capitalize">{c.area}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className={`capitalize ${tone}`}>{c.status}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5 text-[11px]">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border ${m?.critical ? "bg-destructive/15 text-destructive border-destructive/30 animate-pulse-soft" : "bg-card/40 border-border text-muted-foreground"}`}>
                          <Clock className="size-3" /> {m?.pending ?? 0} prazo{(m?.pending ?? 0) === 1 ? "" : "s"}
                        </span>
                        {next && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md border bg-card/40 border-border text-muted-foreground">
                            próx. {next.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                          </span>
                        )}
                        {(m?.received ?? 0) > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md border bg-emerald-500/10 border-emerald-500/30 text-emerald-400 tabular-nums">
                            ↑ {formatBRL(m!.received)}
                          </span>
                        )}
                        {(m?.receivable ?? 0) > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md border bg-warning/10 border-warning/30 text-warning tabular-nums">
                            • {formatBRL(m!.receivable)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatBRL(c.value_cents)}</td>
                    <td className="px-4 py-3 text-right"><Button size="icon" variant="ghost" className="size-7 hover:text-destructive" onClick={() => remove(c.id)}><Trash2 className="size-3.5" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

