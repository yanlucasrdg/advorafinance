import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/config")({
  head: () => ({ meta: [{ title: "Configurações — Legion AI" }] }),
  component: Config,
});

function Config() {
  const { profile, refreshProfile } = useAuth();
  const [tenant, setTenant] = useState<{ name: string; slug: string; plan: string } | null>(null);
  const [fullName, setFullName] = useState(profile?.full_name ?? "");

  useEffect(() => { setFullName(profile?.full_name ?? ""); }, [profile?.full_name]);
  useEffect(() => {
    if (!profile?.tenant_id) return;
    supabase.from("tenants").select("name, slug, plan").eq("id", profile.tenant_id).maybeSingle()
      .then(({ data }) => setTenant(data as { name: string; slug: string; plan: string } | null));
  }, [profile?.tenant_id]);

  const saveProfile = async () => {
    const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", profile!.id);
    if (error) return toast.error(error.message);
    await refreshProfile();
    toast.success("Perfil atualizado");
  };

  const saveTenant = async () => {
    if (!tenant || !profile?.tenant_id) return;
    const { error } = await supabase.from("tenants").update({ name: tenant.name }).eq("id", profile.tenant_id);
    if (error) return toast.error(error.message);
    toast.success("Escritório atualizado");
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <PageHeader title="Configurações" subtitle="Perfil, escritório e plano." />

      <Panel className="p-6 space-y-4">
        <h3 className="text-sm font-semibold">Meu perfil</h3>
        <div className="grid gap-3 max-w-md">
          <div><Label>Nome completo</Label><Input value={fullName} onChange={e => setFullName(e.target.value)} /></div>
          <div><Label>Email</Label><Input value={profile?.email ?? ""} disabled /></div>
          <Button onClick={saveProfile} className="w-fit bg-[image:var(--gradient-brand)]">Salvar perfil</Button>
        </div>
      </Panel>

      <Panel className="p-6 space-y-4">
        <h3 className="text-sm font-semibold">Escritório</h3>
        {tenant ? (
          <div className="grid gap-3 max-w-md">
            <div><Label>Nome do escritório</Label><Input value={tenant.name} onChange={e => setTenant({ ...tenant, name: e.target.value })} /></div>
            <div><Label>Slug</Label><Input value={tenant.slug} disabled /></div>
            <div>
              <Label>Plano atual</Label>
              <div className="mt-1 inline-flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-sm capitalize">
                {tenant.plan}
              </div>
            </div>
            <Button onClick={saveTenant} className="w-fit bg-[image:var(--gradient-brand)]">Salvar escritório</Button>
          </div>
        ) : <p className="text-sm text-muted-foreground">Carregando…</p>}
      </Panel>
    </div>
  );
}
