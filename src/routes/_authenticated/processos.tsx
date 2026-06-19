import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Briefcase } from "lucide-react";
import { AppShell } from "@/components/app-shell";
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
  head: () => ({ meta: [{ title: "Processos — Legion AI" }] }),
  component: () => <AppShell><Processos /></AppShell>,
});

type Case = { id: string; number: string | null; title: string; court: string | null; area: string | null; status: string; value_cents: number; client_id: string | null; clients?: { name: string } | null };
type Client = { id: string; name: string };

function Processos() {
  const { profile } = useAuth();
  const [cases, setCases] = useState<Case[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ number: "", title: "", court: "", area: "civel", status: "ativo", value_cents: 0, client_id: "", description: "" });

  const load = async () => {
    const [{ data: cs }, { data: cls }] = await Promise.all([
      supabase.from("cases").select("*, clients(name)").order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name").order("name"),
    ]);
    setCases((cs ?? []) as Case[]);
    setClients((cls ?? []) as Client[]);
  };
  useEffect(() => { if (profile?.tenant_id) load(); }, [profile?.tenant_id]);

  const create = async () => {
    if (!form.title.trim() || !profile?.tenant_id) return;
    const payload: Record<string, unknown> = { ...form, tenant_id: profile.tenant_id };
    if (!payload.client_id) payload.client_id = null;
    const { error } = await supabase.from("cases").insert(payload);
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

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Gestão Processual"
        subtitle="Processos, valores em causa e responsáveis."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-[image:var(--gradient-brand)]"><Plus className="size-4 mr-1" /> Novo processo</Button></DialogTrigger>
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

      <Panel className="p-0 overflow-hidden">
        {cases.length === 0 ? (
          <EmptyState title="Nenhum processo cadastrado" hint="Clique em 'Novo processo' para começar." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-card/40 border-b border-border/60">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Processo</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Área</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Valor</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {cases.map(c => (
                <tr key={c.id} className="border-b border-border/40 hover:bg-card/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2"><Briefcase className="size-4 text-primary" />
                      <div><div className="font-medium">{c.title}</div><div className="text-[11px] text-muted-foreground">{c.number || "Sem número"} • {c.court || "—"}</div></div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{c.clients?.name ?? "—"}</td>
                  <td className="px-4 py-3 capitalize">{c.area}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="capitalize">{c.status}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatBRL(c.value_cents)}</td>
                  <td className="px-4 py-3 text-right"><Button size="icon" variant="ghost" className="size-7" onClick={() => remove(c.id)}><Trash2 className="size-3.5" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
