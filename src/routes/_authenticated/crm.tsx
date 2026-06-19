import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Mail, Phone, Trash2 } from "lucide-react";
import { PageHeader, Panel, EmptyState } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM — Legion AI" }] }),
  component: CRM,
});

type Client = { id: string; name: string; email: string | null; phone: string | null; type: string; status: string; created_at: string };

const STATUSES = ["lead", "prospect", "ativo", "inativo"];
const STATUS_COLOR: Record<string, string> = {
  lead: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  prospect: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ativo: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  inativo: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

function CRM() {
  const { profile } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", doc: "", type: "PF", status: "lead" });

  const load = async () => {
    const { data, error } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    setClients((data ?? []) as Client[]);
  };
  useEffect(() => { if (profile?.tenant_id) load(); }, [profile?.tenant_id]);

  const create = async () => {
    if (!form.name.trim() || !profile?.tenant_id) return;
    const { error } = await supabase.from("clients").insert({ ...form, tenant_id: profile.tenant_id, created_by: profile.id });
    if (error) return toast.error(error.message);
    toast.success("Cliente criado");
    setOpen(false); setForm({ name: "", email: "", phone: "", doc: "", type: "PF", status: "lead" });
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const updateStatus = async (id: string, status: string) => {
    await supabase.from("clients").update({ status }).eq("id", id);
    load();
  };

  // Kanban por status
  const grouped = STATUSES.map(s => ({ status: s, items: clients.filter(c => c.status === s) }));

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader
        title="CRM Jurídico"
        subtitle="Funil de clientes e leads — arraste o status para mover a etapa."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[image:var(--gradient-brand)]"><Plus className="size-4 mr-1" /> Novo cliente</Button>
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
                <Button onClick={create} className="mt-2 bg-[image:var(--gradient-brand)]">Criar</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {grouped.map(col => (
          <Panel key={col.status} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold capitalize">{col.status}</h3>
              <span className="text-xs text-muted-foreground">{col.items.length}</span>
            </div>
            <div className="space-y-2 min-h-[120px]">
              {col.items.length === 0 && <EmptyState title="Sem clientes" />}
              {col.items.map(c => (
                <div key={c.id} className="rounded-xl border border-border/60 bg-card/40 p-3 hover:glow-ring transition-all group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">{c.type}</p>
                    </div>
                    <Badge className={STATUS_COLOR[c.status]} variant="outline">{c.status}</Badge>
                  </div>
                  {(c.email || c.phone) && (
                    <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                      {c.email && <div className="flex items-center gap-1"><Mail className="size-3" />{c.email}</div>}
                      {c.phone && <div className="flex items-center gap-1"><Phone className="size-3" />{c.phone}</div>}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition">
                    <Select value={c.status} onValueChange={v => updateStatus(c.id, v)}>
                      <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" className="size-7" onClick={() => remove(c.id)}><Trash2 className="size-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
