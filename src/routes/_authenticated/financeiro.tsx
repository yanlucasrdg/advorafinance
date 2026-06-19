import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader, Panel, EmptyState, formatBRL } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro — Legion AI" }] }),
  component: () => <AppShell><Financeiro /></AppShell>,
});

type Entry = { id: string; description: string; kind: string; amount_cents: number; status: string; due_date: string | null; paid_at: string | null; clients?: { name: string } | null };

function Financeiro() {
  const { profile } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ description: "", kind: "receita", amount_cents: 0, status: "pendente", due_date: "", client_id: "" });

  const load = async () => {
    const [{ data: es }, { data: cs }] = await Promise.all([
      supabase.from("financial_entries").select("*, clients(name)").order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("clients").select("id, name"),
    ]);
    setEntries((es ?? []) as Entry[]);
    setClients((cs ?? []) as { id: string; name: string }[]);
  };
  useEffect(() => { if (profile?.tenant_id) load(); }, [profile?.tenant_id]);

  const create = async () => {
    if (!form.description.trim() || !profile?.tenant_id) return;
    const { error } = await supabase.from("financial_entries").insert({
      tenant_id: profile.tenant_id,
      description: form.description,
      kind: form.kind,
      amount_cents: form.amount_cents,
      status: form.status,
      due_date: form.due_date || null,
      client_id: form.client_id || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Lançamento criado");
    setOpen(false); setForm({ description: "", kind: "receita", amount_cents: 0, status: "pendente", due_date: "", client_id: "" });
    load();
  };
  const markPaid = async (e: Entry) => { await supabase.from("financial_entries").update({ status: "pago", paid_at: new Date().toISOString() }).eq("id", e.id); load(); };
  const remove = async (id: string) => { await supabase.from("financial_entries").delete().eq("id", id); load(); };

  const totals = useMemo(() => {
    const receita = entries.filter(e => e.kind === "receita" && e.status === "pago").reduce((s, e) => s + e.amount_cents, 0);
    const despesa = entries.filter(e => e.kind === "despesa" && e.status === "pago").reduce((s, e) => s + e.amount_cents, 0);
    const aReceber = entries.filter(e => e.kind === "receita" && e.status === "pendente").reduce((s, e) => s + e.amount_cents, 0);
    return { receita, despesa, saldo: receita - despesa, aReceber };
  }, [entries]);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Financeiro"
        subtitle="Honorários, mensalidades, recebíveis e despesas."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="bg-[image:var(--gradient-brand)]"><Plus className="size-4 mr-1" /> Novo lançamento</Button></DialogTrigger>
            <DialogContent className="glass">
              <DialogHeader><DialogTitle>Cadastrar lançamento</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Descrição*</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Tipo</Label>
                    <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="receita">Receita</SelectItem><SelectItem value="despesa">Despesa</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><Label>Valor (R$)*</Label><Input type="number" value={form.amount_cents / 100} onChange={e => setForm({ ...form, amount_cents: Math.round(Number(e.target.value) * 100) })} /></div>
                  <div><Label>Vencimento</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
                </div>
                <div>
                  <Label>Cliente</Label>
                  <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button onClick={create} className="mt-2 bg-[image:var(--gradient-brand)]">Criar</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Receita realizada", v: totals.receita, icon: TrendingUp, tone: "text-emerald-400" },
          { label: "Despesa realizada", v: totals.despesa, icon: TrendingDown, tone: "text-rose-400" },
          { label: "Saldo", v: totals.saldo, icon: Wallet, tone: "text-primary" },
          { label: "A receber", v: totals.aReceber, icon: TrendingUp, tone: "text-amber-400" },
        ].map(k => (
          <Panel key={k.label} className="p-5">
            <div className="flex items-start justify-between">
              <div><p className="text-xs text-muted-foreground">{k.label}</p><p className="text-xl font-bold mt-1 tabular-nums">{formatBRL(k.v)}</p></div>
              <k.icon className={`size-5 ${k.tone}`} />
            </div>
          </Panel>
        ))}
      </section>

      <Panel className="p-0 overflow-hidden">
        {entries.length === 0 ? <EmptyState title="Nenhum lançamento" /> : (
          <table className="w-full text-sm">
            <thead className="bg-card/40 border-b border-border/60">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Descrição</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Vencimento</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Valor</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-b border-border/40 hover:bg-card/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{e.description}</div>
                    <div className="text-[11px] text-muted-foreground capitalize">{e.kind}</div>
                  </td>
                  <td className="px-4 py-3">{e.clients?.name ?? "—"}</td>
                  <td className="px-4 py-3">{e.due_date ? new Date(e.due_date).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="capitalize">{e.status}</Badge></td>
                  <td className={`px-4 py-3 text-right tabular-nums ${e.kind === "despesa" ? "text-rose-400" : "text-emerald-400"}`}>{e.kind === "despesa" ? "-" : "+"}{formatBRL(e.amount_cents)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {e.status !== "pago" && <Button size="sm" variant="outline" className="h-7" onClick={() => markPaid(e)}>Baixar</Button>}
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => remove(e.id)}><Trash2 className="size-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
