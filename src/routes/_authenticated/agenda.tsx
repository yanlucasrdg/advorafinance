import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { PageHeader, Panel, EmptyState } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/agenda")({
  head: () => ({ meta: [{ title: "Agenda & Prazos — Legion AI" }] }),
  component: Agenda,
});

type Deadline = { id: string; title: string; kind: string; due_at: string; done: boolean; case_id: string | null; cases?: { title: string } | null };

function Agenda() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Deadline[]>([]);
  const [cases, setCases] = useState<{ id: string; title: string }[]>([]);
  const [open, setOpen] = useState(false);
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
      tenant_id: profile.tenant_id,
      title: form.title,
      kind: form.kind,
      due_at: new Date(form.due_at).toISOString(),
      case_id: form.case_id || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Prazo criado");
    setOpen(false); setForm({ title: "", kind: "prazo", due_at: "", case_id: "" });
    load();
  };

  const toggle = async (d: Deadline) => { await supabase.from("deadlines").update({ done: !d.done }).eq("id", d.id); load(); };
  const remove = async (id: string) => { await supabase.from("deadlines").delete().eq("id", id); load(); };

  const now = Date.now();
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Agenda & Prazos"
        subtitle="Audiências, prazos processuais e compromissos."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-[image:var(--gradient-brand)]"><Plus className="size-4 mr-1" /> Novo prazo</Button></DialogTrigger>
            <DialogContent className="glass">
              <DialogHeader><DialogTitle>Cadastrar prazo</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Título*</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Tipo</Label>
                    <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{["prazo", "audiencia", "reuniao", "tarefa"].map(k => <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>)}</SelectContent>
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
        }
      />

      <Panel className="p-0 overflow-hidden">
        {items.length === 0 ? <EmptyState title="Nenhum compromisso na agenda" /> : (
          <ul className="divide-y divide-border/40">
            {items.map(d => {
              const due = new Date(d.due_at).getTime();
              const overdue = !d.done && due < now;
              const soon = !d.done && due - now < 1000 * 60 * 60 * 48;
              return (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-card/30">
                  <button onClick={() => toggle(d)} className="text-muted-foreground hover:text-primary">
                    {d.done ? <CheckCircle2 className="size-5 text-emerald-400" /> : overdue ? <AlertTriangle className="size-5 text-rose-400" /> : <Clock className="size-5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${d.done ? "line-through text-muted-foreground" : ""}`}>{d.title}</div>
                    <div className="text-[11px] text-muted-foreground capitalize">{d.kind} • {d.cases?.title ?? "sem processo"}</div>
                  </div>
                  <div className={`text-xs tabular-nums ${overdue ? "text-rose-400" : soon ? "text-amber-400" : "text-muted-foreground"}`}>
                    {new Date(d.due_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => remove(d.id)}><Trash2 className="size-3.5" /></Button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
