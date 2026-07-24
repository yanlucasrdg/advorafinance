import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Download, ImageIcon, Palette, ShieldCheck } from "lucide-react";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

const BRAND_PALETTES = [
  { name: "Indigo", description: "Equilibrada e institucional", primary: "#5B4CF0", secondary: "#7C6BFF" },
  { name: "Oceano", description: "Clara e confiável", primary: "#0284C7", secondary: "#06B6D4" },
  { name: "Esmeralda", description: "Próxima e contemporânea", primary: "#059669", secondary: "#22C55E" },
  { name: "Violeta", description: "Sofisticada e marcante", primary: "#7C3AED", secondary: "#C026D3" },
  { name: "Coral", description: "Direta e energética", primary: "#E11D48", secondary: "#F97316" },
  { name: "Grafite", description: "Sólida e discreta", primary: "#334155", secondary: "#64748B" },
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
      return toast.error("Selecione uma paleta de cores válida.");
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

      <Panel className="p-6 space-y-6">
        <div>
          <h3 className="text-sm font-semibold">Identidade White Label</h3>
          <p className="mt-1 text-sm text-muted-foreground">Defina a marca do escritório sem alterar as cores originais do seu logotipo.</p>
        </div>
        <div className="grid gap-6 max-w-3xl">
          <section className="grid gap-4 rounded-xl border border-border bg-secondary/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><ImageIcon className="size-4 text-primary" /> Marca</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Nome da marca</Label><Input value={brand.brand_name} onChange={e => setBrand({ ...brand, brand_name: e.target.value })} placeholder="Nome exibido para os usuários" /></div>
              <div><Label>URL do logotipo</Label><Input type="url" value={brand.logo_url} onChange={e => setBrand({ ...brand, logo_url: e.target.value })} placeholder="https://.../logo.png" /></div>
            </div>
            <p className="text-xs text-muted-foreground">Use uma imagem PNG, SVG ou WebP com fundo transparente. O sistema não aplica filtros, inversão ou recoloração ao arquivo.</p>
          </section>

          <section className="grid gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold"><Palette className="size-4 text-primary" /> Paleta da interface</div>
              <p className="mt-1 text-xs text-muted-foreground">A paleta colore apenas ações, links, foco, indicadores e fundos de seleção. Não colore fotos, documentos ou conteúdos dos clientes.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {BRAND_PALETTES.map((palette) => {
                const selected = selectedPalette === palette.name;
                return (
                  <button
                    key={palette.name}
                    type="button"
                    onClick={() => setBrand({ ...brand, primary_color: palette.primary, secondary_color: palette.secondary })}
                    className={`relative flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${selected ? "border-primary bg-primary-soft ring-2 ring-primary/15" : "border-border bg-card hover:border-primary/35 hover:bg-secondary/50"}`}
                    aria-pressed={selected}
                  >
                    <span className="grid size-10 place-items-center rounded-xl" style={{ background: `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})` }}>
                      {selected && <Check className="size-5 text-white" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0"><span className="block font-semibold text-sm">{palette.name}</span><span className="block mt-0.5 text-xs text-muted-foreground">{palette.description}</span></span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-xl grid place-items-center overflow-hidden shrink-0" style={{ borderColor: `color-mix(in srgb, ${brand.primary_color} 22%, transparent)`, backgroundColor: `color-mix(in srgb, ${brand.primary_color} 10%, transparent)` }}>
                {brand.logo_url ? <img src={brand.logo_url} alt="Prévia do logotipo" className="size-8 object-contain" /> : <span className="text-sm font-bold" style={{ color: brand.primary_color }}>{(brand.brand_name || "A")[0].toUpperCase()}</span>}
              </div>
              <div className="min-w-0"><p className="text-sm font-semibold truncate">{brand.brand_name || "Sua marca"}</p><p className="text-xs text-muted-foreground">Prévia do cabeçalho e da navegação</p></div>
              <Button type="button" size="sm" className="ml-auto" style={{ backgroundImage: `linear-gradient(135deg, ${brand.primary_color}, ${brand.secondary_color})` }}>Ação</Button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg px-2.5 py-2 font-medium" style={{ backgroundColor: `color-mix(in srgb, ${brand.primary_color} 11%, transparent)`, color: brand.primary_color }}>Seleção</div>
              <div className="rounded-lg border px-2.5 py-2 font-medium" style={{ borderColor: `color-mix(in srgb, ${brand.primary_color} 28%, transparent)`, color: brand.primary_color }}>Foco</div>
              <div className="rounded-lg bg-secondary px-2.5 py-2 text-muted-foreground">Neutro</div>
            </div>
          </section>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/35 p-3 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /> A mesma paleta é aplicada de forma consistente em toda a área autenticada do escritório.</div>
          <Button onClick={saveBranding} className="w-fit bg-[image:var(--gradient-brand)]">Salvar identidade visual</Button>
        </div>
      </Panel>

      <Panel className="p-6 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Exportar dados</h3>
          <p className="mt-1 text-sm text-muted-foreground">Baixe os dados deste escritório em um arquivo JSON para portabilidade e migração.</p>
        </div>
        <Button asChild variant="outline" className="w-fit">
          <Link to="/exportar-dados">
            <Download className="size-4" />
            Abrir exportação de dados
          </Link>
        </Button>
      </Panel>
    </div>
  );
}
