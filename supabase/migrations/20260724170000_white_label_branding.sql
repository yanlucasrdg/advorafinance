-- White Label foundation: tenant-owned visual identity and safe user preferences.

CREATE TABLE IF NOT EXISTS public.tenant_branding (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  brand_name text NOT NULL CHECK (char_length(trim(brand_name)) BETWEEN 1 AND 100),
  logo_url text,
  primary_color text NOT NULL DEFAULT '#5B4CF0'
    CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text NOT NULL DEFAULT '#7C6BFF'
    CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  default_theme text NOT NULL DEFAULT 'dark'
    CHECK (default_theme IN ('light', 'dark')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.tenant_branding (tenant_id, brand_name, logo_url)
SELECT id, name, logo_url
FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_tenant_branding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tenant_branding (tenant_id, brand_name, logo_url)
  VALUES (NEW.id, NEW.name, NEW.logo_url)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_tenant_branding ON public.tenants;
CREATE TRIGGER trg_create_tenant_branding
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.create_tenant_branding();

DROP TRIGGER IF EXISTS trg_tenant_branding_updated ON public.tenant_branding;
CREATE TRIGGER trg_tenant_branding_updated
  BEFORE UPDATE ON public.tenant_branding
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.tenant_branding TO authenticated;
GRANT ALL ON public.tenant_branding TO service_role;
ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view tenant branding"
  ON public.tenant_branding FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant admins can create branding"
  ON public.tenant_branding FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "Tenant admins can update branding"
  ON public.tenant_branding FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'))
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

-- P0 intentionally blocked profile writes broadly. Theme and locale are personal
-- presentation preferences, so grant only those fields in addition to the P0 list.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, phone, locale, theme) ON public.profiles TO authenticated;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_theme_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_theme_check CHECK (theme IN ('light', 'dark'));
