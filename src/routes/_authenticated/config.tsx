import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

const BRAND_PALETTES = [
  { name: "Indigo", primary: "#5B4CF0", secondary: "#7C6BFF" },
  { name: "Ocean", primary: "#0284C7", secondary: "#06B6D4" },
  { name: "Emerald", primary: "#059669", secondary: "#22C55E" },
  { name: "Violet", primary: "#7C3AED", secondary: "#C026D3" },
  { name: "Rose", primary: "#E11D48", secondary: "#F97316" },
  { name: "Slate", primary: "#334155", secondary: "#64748B" },
] as const;

export const Route = createFileRoute("/_authenticated/config")({
  head: () => ({ meta: [{ title: "Configurações — Advora" }] }),
  component: Config,
});

function Config() {
  const { profile, branding, refreshProfile, refreshBranding } = useAuth();
  const [tenant, setTenant] = useState<{ name: string; slug: string; plan: string } | null>(null);
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [brand, setBrand] = useState({
    brand_name: "",
    logo_url: "",
    primary_color: "#5B4CF0",
    secondary_color: "#7C6BFF",
    default_theme: "dark" as "light" | "dark",
  });

  useEffect(() => { setFullName(profile?.full_name ?? ""); }, [profile?.full_name]);
  useEffect(() => {
    if (!branding) return;
    setBrand({
      brand_name: branding.brand_name,
      logo_url: branding.logo_url ?? "",
      primary_color: branding.primary_color,
      secondary_color: branding.secondary_color,
      default_theme: branding.default_theme,
    });
  }, [branding]);
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

  const saveBranding = async () => {
    if (!profile?.tenant_id) return;
    const brandName = brand.brand_name.trim();
    const hex = /^#[0-9A-Fa-f]{6}$/;
    if (!brandName || brandName.length > 100) return toast.error("Informe um nome de marca de ate 100 caracteres.");
    if (!hex.test(brand.primary_color) || !hex.test(brand.secondary_color)) {
      return toast.error("Use cores no formato hexadecimal, por exemplo #5B4CF0.");
    }

    const { error } = await supabase.from("tenant_branding").update({
      brand_name: brandName,
      logo_url: brand.logo_url.trim() || null,
      primary_color: brand.primary_color.toUpperCase(),
      secondary_color: brand.secondary_color.toUpperCase(),
      default_theme: brand.default_theme,
    }).eq("tenant_id", profile.tenant_id);
    if (error) return toast.error(error.message);
    await refreshBranding();
    toast.success("Identidade visual atualizada");
  };

  const selectedPalette = BRAND_PALETTES.find(
    (palette) => palette.primary === brand.primary_color && palette.secondary === brand.secondary_color,
  )?.name;

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

      <Panel className="p-6 space-y-5">
        <div>
          <h3 className="text-sm font-semibold">White Label</h3>
          <p className="mt-1 text-sm text-muted-foreground">A marca abaixo e aplicada a navegacao e aos elementos principais deste escritorio.</p>
        </div>
        <div className="grid gap-4 max-w-2xl">
          <div><Label>Nome da marca</Label><Input value={brand.brand_name} onChange={e => setBrand({ ...brand, brand_name: e.target.value })} placeholder="Nome exibido para os usuarios" /></div>
          <div><Label>URL do logo</Label><Input type="url" value={brand.logo_url} onChange={e => setBrand({ ...brand, logo_url: e.target.value })} placeholder="https://.../logo.png" /></div>
          <div>
            <Label>Paleta de cores</Label>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {BRAND_PALETTES.map((palette) => {
                const selected = selectedPalette === palette.name;
                return (
                  <button
                    key={palette.name}
                    type="button"
                    onClick={() => setBrand({ ...brand, primary_color: palette.primary, secondary_color: palette.secondary })}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${selected ? "border-primary ring-2 ring-primary/20" : "border-border hover:bg-secondary"}`}
                    aria-pressed={selected}
                  >
                    <span className="flex -space-x-1"><span className="size-4 rounded-full border-2 border-card" style={{ backgroundColor: palette.primary }} /><span className="size-4 rounded-full border-2 border-card" style={{ backgroundColor: palette.secondary }} /></span>
                    <span className="font-medium">{palette.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className="size-10 rounded-xl" style={{ background: `linear-gradient(135deg, ${brand.primary_color}, ${brand.secondary_color})` }} />
            <div><p className="text-sm font-semibold">{brand.brand_name || "Sua marca"}</p><p className="text-xs text-muted-foreground">Pre-visualizacao das cores</p></div>
          </div>
          <Button onClick={saveBranding} className="w-fit bg-[image:var(--gradient-brand)]">Salvar identidade visual</Button>
        </div>
      </Panel>
    </div>
  );
}
