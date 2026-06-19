import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Scale, Loader2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({ meta: [{ title: "Configurar escritório — Legion AI" }] }),
  component: Onboarding,
});

function Onboarding() {
  const navigate = useNavigate();
  const { user, profile, loading, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
    if (!loading && profile?.tenant_id) navigate({ to: "/dashboard" });
  }, [user, profile, loading, navigate]);

  const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const finalSlug = slug || slugify(name);
    const { error } = await supabase.rpc("create_tenant_with_owner", { _name: name, _slug: finalSlug });
    if (error) {
      toast.error(error.message);
      setBusy(false);
      return;
    }
    await refreshProfile();
    toast.success("Escritório criado!");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="size-9 rounded-lg bg-[image:var(--gradient-brand)] grid place-items-center shadow-[var(--shadow-glow)]">
            <Scale className="size-4 text-primary-foreground" />
          </div>
          <span className="font-semibold tracking-tight text-lg">Legion <span className="gradient-text">AI</span></span>
        </div>

        <div className="glass rounded-2xl p-8">
          <div className="size-12 rounded-xl bg-primary/10 grid place-items-center mb-4">
            <Building2 className="size-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Configure seu escritório</h1>
          <p className="text-sm text-muted-foreground mt-1">Vamos criar seu workspace. Você será o owner.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nome do escritório</Label>
              <Input required value={name} onChange={e => { setName(e.target.value); if (!slug) setSlug(slugify(e.target.value)); }} placeholder="Silva & Associados" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Identificador (URL)</Label>
              <div className="flex items-center rounded-md border border-input bg-input/40">
                <span className="px-3 text-xs text-muted-foreground">legion.app/</span>
                <Input className="border-0 bg-transparent" required value={slug} onChange={e => setSlug(slugify(e.target.value))} placeholder="silva-associados" />
              </div>
            </div>
            <Button type="submit" disabled={busy || !name} className="w-full bg-[image:var(--gradient-brand)] hover:opacity-90">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Criar escritório"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
