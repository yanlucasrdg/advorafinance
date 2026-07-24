
-- CLIENTS
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  doc TEXT,
  type TEXT NOT NULL DEFAULT 'PF',
  status TEXT NOT NULL DEFAULT 'lead',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read clients" ON public.clients FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "tenant write clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant update clients" ON public.clients FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant delete clients" ON public.clients FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- CASES (Processos)
CREATE TABLE public.cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  number TEXT,
  title TEXT NOT NULL,
  court TEXT,
  area TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  value_cents BIGINT DEFAULT 0,
  responsible UUID REFERENCES auth.users(id),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases TO authenticated;
GRANT ALL ON public.cases TO service_role;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read cases" ON public.cases FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "tenant write cases" ON public.cases FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant update cases" ON public.cases FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant delete cases" ON public.cases FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());
CREATE TRIGGER trg_cases_updated BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- DEADLINES (Prazos / agenda)
CREATE TABLE public.deadlines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'prazo',
  due_at TIMESTAMPTZ NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deadlines TO authenticated;
GRANT ALL ON public.deadlines TO service_role;
ALTER TABLE public.deadlines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant rw deadlines" ON public.deadlines FOR ALL TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE TRIGGER trg_deadlines_updated BEFORE UPDATE ON public.deadlines FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- FINANCIAL ENTRIES
CREATE TABLE public.financial_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'receita',
  amount_cents BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente',
  due_date DATE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_entries TO authenticated;
GRANT ALL ON public.financial_entries TO service_role;
ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant rw fin" ON public.financial_entries FOR ALL TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE TRIGGER trg_fin_updated BEFORE UPDATE ON public.financial_entries FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- AI CONVERSATIONS
CREATE TABLE public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_messages TO authenticated;
GRANT ALL ON public.ai_messages TO service_role;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read ai" ON public.ai_messages FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "user insert ai" ON public.ai_messages FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id() AND user_id = auth.uid());
