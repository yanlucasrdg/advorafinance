
-- =========== ENUMS ===========
CREATE TYPE public.app_role AS ENUM ('master_admin','owner','admin','lawyer','secretary','intern','client');
CREATE TYPE public.tenant_plan AS ENUM ('trial','starter','professional','enterprise');

-- =========== TENANTS ===========
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan public.tenant_plan NOT NULL DEFAULT 'trial',
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- =========== PROFILES ===========
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_profiles_tenant ON public.profiles(tenant_id);

-- =========== USER ROLES ===========
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_tenant ON public.user_roles(tenant_id);

-- =========== SECURITY DEFINER FUNCTIONS ===========
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_master_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'master_admin');
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.user_in_tenant(_user_id UUID, _tenant_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND tenant_id = _tenant_id);
$$;

-- =========== TENANTS POLICIES ===========
CREATE POLICY "Members can view their tenant" ON public.tenants FOR SELECT TO authenticated
  USING (id = public.current_tenant_id() OR public.is_master_admin(auth.uid()));
CREATE POLICY "Authenticated can create tenant (onboarding)" ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Owners/admins can update their tenant" ON public.tenants FOR UPDATE TO authenticated
  USING (id = public.current_tenant_id() AND (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')))
  WITH CHECK (id = public.current_tenant_id());
CREATE POLICY "Master admin full access tenants" ON public.tenants FOR ALL TO authenticated
  USING (public.is_master_admin(auth.uid())) WITH CHECK (public.is_master_admin(auth.uid()));

-- =========== PROFILES POLICIES ===========
CREATE POLICY "Users can view profiles in their tenant" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR tenant_id = public.current_tenant_id() OR public.is_master_admin(auth.uid()));
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- =========== USER ROLES POLICIES ===========
CREATE POLICY "Users see roles in their tenant" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR tenant_id = public.current_tenant_id() OR public.is_master_admin(auth.uid()));
CREATE POLICY "Owners can manage tenant roles" ON public.user_roles FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'owner'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'owner'));

-- =========== TRIGGERS ===========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========== RPC: create tenant + assign owner atomically ===========
CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(_name TEXT, _slug TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_tenant_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.tenants (name, slug) VALUES (_name, _slug) RETURNING id INTO new_tenant_id;
  UPDATE public.profiles SET tenant_id = new_tenant_id WHERE id = auth.uid();
  INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (auth.uid(), new_tenant_id, 'owner');
  RETURN new_tenant_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT) TO authenticated;
