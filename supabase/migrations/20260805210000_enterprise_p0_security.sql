-- Enterprise P0: enforce RBAC at the database boundary, close a cross-tenant
-- financial write path and make subscription access authoritative.

CREATE OR REPLACE FUNCTION public.has_any_tenant_role(_roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_master_admin(auth.uid()) OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.tenant_id = public.current_tenant_id()
      AND ur.role = ANY(_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.has_any_tenant_role(public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_tenant_role(public.app_role[]) TO authenticated, service_role;

-- A user may own one tenant only. This closes repeated trial creation and
-- prevents abandoning an existing workspace through a direct RPC call.
CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(_name text, _slug text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_tenant_id uuid;
  existing_tenant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT tenant_id INTO existing_tenant_id
  FROM public.profiles
  WHERE id = auth.uid()
  FOR UPDATE;

  IF existing_tenant_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'USER_ALREADY_HAS_TENANT';
  END IF;
  IF length(trim(COALESCE(_name, ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'TENANT_NAME_INVALID';
  END IF;
  IF COALESCE(_slug, '') !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' THEN
    RAISE EXCEPTION 'TENANT_SLUG_INVALID';
  END IF;

  INSERT INTO public.tenants (name, slug)
  VALUES (trim(_name), _slug)
  RETURNING id INTO new_tenant_id;

  UPDATE public.profiles SET tenant_id = new_tenant_id WHERE id = auth.uid();
  INSERT INTO public.user_roles (user_id, tenant_id, role)
  VALUES (auth.uid(), new_tenant_id, 'owner');
  RETURN new_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_with_owner(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(text, text) TO authenticated;

-- Tenant creation is only valid through the atomic RPC above. The original
-- onboarding policies allowed an authenticated user to insert unlimited
-- orphan tenants and bypass the one-workspace rule.
DROP POLICY IF EXISTS "Authenticated can create tenant (onboarding)" ON public.tenants;
DROP POLICY IF EXISTS "Onboarding insert tenant" ON public.tenants;
REVOKE INSERT ON public.tenants FROM authenticated;

-- Some production projects were created before the documents migration was
-- registered in migration history. Repair that schema drift here because the
-- P0 policies and the current application both depend on this table.
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  file_type text NOT NULL,
  document_type text NOT NULL DEFAULT 'other',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
CREATE INDEX IF NOT EXISTS documents_tenant_created_idx
  ON public.documents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_case_idx
  ON public.documents (case_id) WHERE case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_client_idx
  ON public.documents (client_id) WHERE client_id IS NOT NULL;
DROP TRIGGER IF EXISTS trg_documents_updated ON public.documents;
CREATE TRIGGER trg_documents_updated
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Repair the deadline audit dependency as well. This version deliberately
-- stores operational metadata only and works across older deadline schemas.
CREATE TABLE IF NOT EXISTS public.deadline_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deadline_id uuid NOT NULL REFERENCES public.deadlines(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deadline_audit_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.deadline_audit_log TO authenticated;
GRANT ALL ON public.deadline_audit_log TO service_role;
CREATE INDEX IF NOT EXISTS idx_deadline_audit_deadline
  ON public.deadline_audit_log (deadline_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deadline_audit_tenant
  ON public.deadline_audit_log (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_deadline_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_action text := lower(TG_OP);
  v_deadline_id uuid := COALESCE((v_new->>'id')::uuid, (v_old->>'id')::uuid);
  v_tenant_id uuid := COALESCE((v_new->>'tenant_id')::uuid, (v_old->>'tenant_id')::uuid);
  v_redacted text[] := ARRAY[
    'title','notes','tenant_id','created_by','updated_at','description',
    'party_name','contact_name','process_number'
  ];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE((v_old->>'done')::boolean, false) = false
      AND COALESCE((v_new->>'done')::boolean, false) = true THEN
      v_action := 'completed';
    ELSIF COALESCE((v_old->>'done')::boolean, false) = true
      AND COALESCE((v_new->>'done')::boolean, false) = false THEN
      v_action := 'reopened';
    ELSIF v_old->>'deleted_at' IS NULL AND v_new->>'deleted_at' IS NOT NULL THEN
      v_action := 'removed';
    ELSE
      v_action := 'updated';
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_action := 'created';
  ELSE
    v_action := 'deleted';
  END IF;

  v_old := v_old - v_redacted;
  v_new := v_new - v_redacted;
  IF TG_OP = 'UPDATE' AND v_old = v_new THEN RETURN NEW; END IF;

  INSERT INTO public.deadline_audit_log (
    deadline_id, tenant_id, actor_id, action, before, after
  ) VALUES (
    v_deadline_id, v_tenant_id, auth.uid(), v_action, v_old, v_new
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deadline_audit ON public.deadlines;
CREATE TRIGGER trg_deadline_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.deadlines
  FOR EACH ROW EXECUTE FUNCTION public.fn_deadline_audit();

-- Defense in depth for every browser-originated business write, including
-- SECURITY DEFINER RPCs. Service-role webhooks keep operating with auth.uid null.
CREATE OR REPLACE FUNCTION public.enforce_business_write_access()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF v_tenant_id IS NULL OR v_tenant_id <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'TENANT_ACCESS_DENIED';
  END IF;

  v_allowed := CASE TG_TABLE_NAME
    WHEN 'financial_entries' THEN public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[])
    WHEN 'financial_payments' THEN public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[])
    WHEN 'dre_settings' THEN public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[])
    WHEN 'cases' THEN public.has_any_tenant_role(ARRAY['owner','admin','lawyer']::public.app_role[])
    WHEN 'case_movements' THEN public.has_any_tenant_role(ARRAY['owner','admin','lawyer']::public.app_role[])
    WHEN 'clients' THEN public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[])
    WHEN 'deadlines' THEN public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[])
    WHEN 'documents' THEN public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[])
    WHEN 'client_activities' THEN public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[])
    WHEN 'whatsapp_conversations' THEN public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[])
    WHEN 'whatsapp_messages' THEN public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[])
    ELSE false
  END;

  IF NOT v_allowed THEN RAISE EXCEPTION 'ROLE_ACCESS_DENIED'; END IF;
  IF NOT public.tenant_has_subscription_access(v_tenant_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ACCESS_DENIED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DO $triggers$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT unnest(ARRAY[
      'clients','cases','case_movements','deadlines','financial_entries','financial_payments',
      'dre_settings','documents','client_activities','whatsapp_conversations','whatsapp_messages'
    ]::text[])
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_enterprise_write_access ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_enterprise_write_access BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_business_write_access()',
      table_name
    );
  END LOOP;
END;
$triggers$;

-- RBAC read/write policies. Triggers remain the final write guard for RPCs.
DROP POLICY IF EXISTS "tenant read clients" ON public.clients;
DROP POLICY IF EXISTS "tenant write clients" ON public.clients;
DROP POLICY IF EXISTS "tenant update clients" ON public.clients;
DROP POLICY IF EXISTS "tenant delete clients" ON public.clients;
CREATE POLICY "rbac read clients" ON public.clients FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary','intern']::public.app_role[]));
CREATE POLICY "rbac insert clients" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]));
CREATE POLICY "rbac update clients" ON public.clients FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]))
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "tenant read cases" ON public.cases;
DROP POLICY IF EXISTS "tenant write cases" ON public.cases;
DROP POLICY IF EXISTS "tenant update cases" ON public.cases;
DROP POLICY IF EXISTS "tenant delete cases" ON public.cases;
CREATE POLICY "rbac read cases" ON public.cases FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary','intern']::public.app_role[]));
CREATE POLICY "rbac insert cases" ON public.cases FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer']::public.app_role[]));
CREATE POLICY "rbac update cases" ON public.cases FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer']::public.app_role[]))
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "tenant rw deadlines" ON public.deadlines;
CREATE POLICY "rbac read deadlines" ON public.deadlines FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary','intern']::public.app_role[]));
CREATE POLICY "rbac write deadlines" ON public.deadlines FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]));

DROP POLICY IF EXISTS "tenant read movements" ON public.case_movements;
DROP POLICY IF EXISTS "tenant write movements" ON public.case_movements;
DROP POLICY IF EXISTS "tenant update movements" ON public.case_movements;
DROP POLICY IF EXISTS "tenant delete movements" ON public.case_movements;
CREATE POLICY "rbac read case movements" ON public.case_movements FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary','intern']::public.app_role[]));
CREATE POLICY "rbac insert case movements" ON public.case_movements FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer']::public.app_role[]));

DROP POLICY IF EXISTS "tenant rw fin" ON public.financial_entries;
CREATE POLICY "rbac finance entries" ON public.financial_entries FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[]))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[]));

DROP POLICY IF EXISTS "tenant rw fin_payments" ON public.financial_payments;
CREATE POLICY "rbac read financial payments" ON public.financial_payments FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[]));
CREATE POLICY "rbac insert financial payments" ON public.financial_payments FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[]));

REVOKE UPDATE, DELETE ON public.financial_payments FROM authenticated;

DROP POLICY IF EXISTS "tenant read audit" ON public.financial_audit_log;
CREATE POLICY "rbac read financial audit" ON public.financial_audit_log FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[]));

DROP POLICY IF EXISTS "dre_settings tenant read" ON public.dre_settings;
DROP POLICY IF EXISTS "dre_settings tenant write" ON public.dre_settings;
CREATE POLICY "rbac dre settings" ON public.dre_settings FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[]))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[]));

DROP POLICY IF EXISTS "tenant read documents" ON public.documents;
DROP POLICY IF EXISTS "tenant insert documents" ON public.documents;
DROP POLICY IF EXISTS "tenant update documents" ON public.documents;
DROP POLICY IF EXISTS "tenant delete documents" ON public.documents;
CREATE POLICY "rbac read documents" ON public.documents FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary','intern']::public.app_role[]));
CREATE POLICY "rbac write documents" ON public.documents FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]));

DROP POLICY IF EXISTS "tenant rw conversations" ON public.whatsapp_conversations;
DROP POLICY IF EXISTS "tenant rw messages" ON public.whatsapp_messages;
CREATE POLICY "rbac conversations" ON public.whatsapp_conversations FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]));
CREATE POLICY "rbac messages" ON public.whatsapp_messages FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]));

DROP POLICY IF EXISTS "tenant read activities" ON public.client_activities;
DROP POLICY IF EXISTS "tenant insert activities" ON public.client_activities;
DROP POLICY IF EXISTS "tenant update activities" ON public.client_activities;
DROP POLICY IF EXISTS "tenant delete activities" ON public.client_activities;
CREATE POLICY "rbac read client activities" ON public.client_activities FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary','intern']::public.app_role[]));
CREATE POLICY "rbac write client activities" ON public.client_activities FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]));

DROP POLICY IF EXISTS "deadline_audit_log_tenant_read" ON public.deadline_audit_log;
CREATE POLICY "rbac read deadline audit" ON public.deadline_audit_log FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer']::public.app_role[]));

DROP POLICY IF EXISTS "tenant select instances" ON public.whatsapp_instances;
DROP POLICY IF EXISTS "tenant insert instances" ON public.whatsapp_instances;
DROP POLICY IF EXISTS "tenant update instances" ON public.whatsapp_instances;
DROP POLICY IF EXISTS "tenant delete instances" ON public.whatsapp_instances;
CREATE POLICY "rbac read whatsapp instances" ON public.whatsapp_instances FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[]));
CREATE POLICY "rbac write whatsapp instances" ON public.whatsapp_instances FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[]))
  WITH CHECK (tenant_id = public.current_tenant_id() AND user_id = auth.uid() AND public.has_any_tenant_role(ARRAY['owner','admin']::public.app_role[]));

DROP POLICY IF EXISTS "notifications read" ON public.notifications;
DROP POLICY IF EXISTS "notifications update" ON public.notifications;
CREATE POLICY "rbac notifications read" ON public.notifications FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (user_id IS NULL OR user_id = auth.uid())
    AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary','intern']::public.app_role[])
  );
CREATE POLICY "rbac notifications update" ON public.notifications FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (user_id IS NULL OR user_id = auth.uid())
    AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary','intern']::public.app_role[])
  )
  WITH CHECK (tenant_id = public.current_tenant_id() AND (user_id IS NULL OR user_id = auth.uid()));

DROP POLICY IF EXISTS "tenant read ai" ON public.ai_messages;
DROP POLICY IF EXISTS "user insert ai" ON public.ai_messages;
CREATE POLICY "rbac read ai" ON public.ai_messages FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer']::public.app_role[]));
CREATE POLICY "rbac insert ai" ON public.ai_messages FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND user_id = auth.uid() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer']::public.app_role[]));

DROP POLICY IF EXISTS "Users can view profiles in their tenant" ON public.profiles;
CREATE POLICY "rbac view profiles" ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_master_admin(auth.uid())
    OR (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary','intern']::public.app_role[]))
  );

DROP POLICY IF EXISTS "Users see roles in their tenant" ON public.user_roles;
CREATE POLICY "rbac view roles" ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_master_admin(auth.uid())
    OR (tenant_id = public.current_tenant_id() AND public.has_any_tenant_role(ARRAY['owner']::public.app_role[]))
  );

DROP POLICY IF EXISTS "tenant access documents" ON storage.objects;
DROP POLICY IF EXISTS "tenant insert documents" ON storage.objects;
DROP POLICY IF EXISTS "tenant update documents" ON storage.objects;
DROP POLICY IF EXISTS "tenant delete documents" ON storage.objects;
CREATE POLICY "rbac read document objects" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary','intern']::public.app_role[]));
CREATE POLICY "rbac insert document objects" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[])
    AND public.tenant_has_subscription_access(public.current_tenant_id()));
CREATE POLICY "rbac update document objects" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[])
    AND public.tenant_has_subscription_access(public.current_tenant_id()));
CREATE POLICY "rbac delete document objects" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[])
    AND public.tenant_has_subscription_access(public.current_tenant_id()));

-- Validate the parent entry before the SECURITY DEFINER payment trigger runs.
CREATE OR REPLACE FUNCTION public.normalize_financial_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry public.financial_entries%ROWTYPE;
  v_remaining bigint;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_entry
  FROM public.financial_entries
  WHERE id = NEW.entry_id
  FOR UPDATE;

  IF NOT FOUND OR v_entry.tenant_id <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'FINANCIAL_ENTRY_NOT_FOUND';
  END IF;
  IF v_entry.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_REMOVED'; END IF;
  IF v_entry.settlement_status = 'conciliado' THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_RECONCILED'; END IF;
  v_remaining := v_entry.amount_cents - COALESCE(v_entry.paid_amount_cents, 0);
  IF NEW.amount_cents <= 0 OR NEW.amount_cents > v_remaining THEN
    RAISE EXCEPTION 'FINANCIAL_PAYMENT_AMOUNT_INVALID';
  END IF;

  NEW.tenant_id := v_entry.tenant_id;
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_financial_payment ON public.financial_payments;
CREATE TRIGGER trg_normalize_financial_payment
  BEFORE INSERT ON public.financial_payments
  FOR EACH ROW EXECUTE FUNCTION public.normalize_financial_payment();

CREATE OR REPLACE FUNCTION public.apply_financial_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry public.financial_entries%ROWTYPE;
  v_new_paid bigint;
  v_old jsonb;
  v_new jsonb;
BEGIN
  SELECT * INTO v_entry
  FROM public.financial_entries
  WHERE id = NEW.entry_id AND tenant_id = NEW.tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_TENANT_MISMATCH'; END IF;

  v_old := to_jsonb(v_entry);
  v_new_paid := COALESCE(v_entry.paid_amount_cents, 0) + NEW.amount_cents;

  UPDATE public.financial_entries
  SET paid_amount_cents = v_new_paid,
      status = CASE WHEN v_new_paid = amount_cents THEN 'pago' ELSE 'pendente' END,
      settlement_status = 'confirmado',
      paid_at = CASE WHEN v_new_paid = amount_cents THEN NEW.paid_at ELSE paid_at END,
      payment_method = COALESCE(NEW.method, payment_method)
  WHERE id = NEW.entry_id AND tenant_id = NEW.tenant_id;

  SELECT to_jsonb(fe.*) INTO v_new
  FROM public.financial_entries fe
  WHERE fe.id = NEW.entry_id AND fe.tenant_id = NEW.tenant_id;

  INSERT INTO public.financial_audit_log (
    tenant_id, entry_id, payment_id, action, actor_id, before, after
  ) VALUES (
    NEW.tenant_id, NEW.entry_id, NEW.id, 'partial_payment', NEW.created_by, v_old, v_new
  );
  RETURN NEW;
END;
$$;

-- Atomic SLA + notification creation used by the communications intake flow.
CREATE OR REPLACE FUNCTION public.create_intake_followup(
  p_client_id uuid,
  p_contact_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_deadline_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.has_any_tenant_role(ARRAY['owner','admin','lawyer','secretary']::public.app_role[]) THEN
    RAISE EXCEPTION 'ROLE_ACCESS_DENIED';
  END IF;
  IF NOT public.tenant_has_subscription_access(v_tenant_id) THEN RAISE EXCEPTION 'SUBSCRIPTION_ACCESS_DENIED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = p_client_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;

  INSERT INTO public.deadlines (
    tenant_id, created_by, client_id, title, due_at, kind, priority, notes
  ) VALUES (
    v_tenant_id, auth.uid(), p_client_id,
    'Responder novo contato: ' || left(trim(p_contact_name), 120),
    now() + interval '15 minutes', 'primeiro_atendimento', 'high',
    'Criado automaticamente pelo fluxo de entrada de Comunicações.'
  ) RETURNING id INTO v_deadline_id;

  INSERT INTO public.notifications (
    tenant_id, user_id, kind, severity, title, body, link_action
  ) VALUES (
    v_tenant_id, auth.uid(), 'novo_lead', 'info', 'Novo contato em triagem',
    left(trim(p_contact_name), 120) || ' precisa de uma primeira resposta em até 15 minutos.',
    '/comunicacoes'
  );
  RETURN v_deadline_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_intake_followup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_intake_followup(uuid, text) TO authenticated;

-- Team membership changes must be atomic. The previous server flow deleted a
-- role and inserted the replacement in separate requests, which could leave a
-- user without permissions after a transient failure.
CREATE OR REPLACE FUNCTION public.provision_tenant_member(
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_role public.app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_target_tenant_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL
    OR NOT public.has_any_tenant_role(ARRAY['owner']::public.app_role[])
  THEN RAISE EXCEPTION 'OWNER_ACCESS_REQUIRED'; END IF;
  IF p_role NOT IN ('admin','lawyer','secretary','intern') THEN
    RAISE EXCEPTION 'ROLE_NOT_ASSIGNABLE';
  END IF;

  SELECT tenant_id INTO v_target_tenant_id
  FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_PROFILE_NOT_FOUND'; END IF;
  IF v_target_tenant_id IS NOT NULL AND v_target_tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'USER_BELONGS_TO_ANOTHER_TENANT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role IN ('owner','master_admin')
  ) THEN RAISE EXCEPTION 'PROTECTED_ROLE'; END IF;

  UPDATE public.profiles
  SET tenant_id = v_tenant_id,
      full_name = left(trim(p_full_name), 100),
      email = lower(trim(p_email)),
      phone = NULLIF(left(trim(COALESCE(p_phone, '')), 30), '')
  WHERE id = p_user_id;

  DELETE FROM public.user_roles
  WHERE tenant_id = v_tenant_id AND user_id = p_user_id;
  INSERT INTO public.user_roles (user_id, tenant_id, role)
  VALUES (p_user_id, v_tenant_id, p_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_tenant_member_role(
  p_user_id uuid,
  p_role public.app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL
    OR NOT public.has_any_tenant_role(ARRAY['owner']::public.app_role[])
  THEN RAISE EXCEPTION 'OWNER_ACCESS_REQUIRED'; END IF;
  IF p_role NOT IN ('admin','lawyer','secretary','intern') THEN
    RAISE EXCEPTION 'ROLE_NOT_ASSIGNABLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id AND tenant_id = v_tenant_id
  ) THEN RAISE EXCEPTION 'TENANT_MEMBER_NOT_FOUND'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role IN ('owner','master_admin')
  ) THEN RAISE EXCEPTION 'PROTECTED_ROLE'; END IF;

  DELETE FROM public.user_roles
  WHERE tenant_id = v_tenant_id AND user_id = p_user_id;
  INSERT INTO public.user_roles (user_id, tenant_id, role)
  VALUES (p_user_id, v_tenant_id, p_role);
END;
$$;

REVOKE ALL ON FUNCTION public.provision_tenant_member(uuid, text, text, text, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.replace_tenant_member_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_tenant_member(uuid, text, text, text, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_tenant_member_role(uuid, public.app_role) TO authenticated;

-- Persist an inbound Meta message, inbox preview, unread counter and urgent
-- notification in one transaction. Retries are idempotent by external ID.
CREATE OR REPLACE FUNCTION public.ingest_meta_whatsapp_message(
  p_tenant_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_external_message_id text,
  p_created_at timestamptz,
  p_tags text[],
  p_category text,
  p_urgent boolean,
  p_notification_body text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_conversations
    WHERE id = p_conversation_id AND tenant_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'CONVERSATION_TENANT_MISMATCH'; END IF;

  INSERT INTO public.whatsapp_messages (
    tenant_id, conversation_id, direction, body, status,
    external_message_id, created_at
  ) VALUES (
    p_tenant_id, p_conversation_id, 'inbound', left(p_body, 10000), 'received',
    p_external_message_id, p_created_at
  )
  ON CONFLICT (tenant_id, external_message_id)
    WHERE external_message_id IS NOT NULL
  DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN false; END IF;

  UPDATE public.whatsapp_conversations
  SET last_message = left(p_body, 10000),
      last_message_at = p_created_at,
      unread_count = unread_count + 1,
      tags = COALESCE(p_tags, ARRAY[]::text[]),
      category = p_category
  WHERE id = p_conversation_id AND tenant_id = p_tenant_id;

  IF p_urgent THEN
    INSERT INTO public.notifications (
      tenant_id, kind, severity, title, body, link_action
    ) VALUES (
      p_tenant_id, 'atendimento_urgente', 'warning',
      'Novo atendimento com indício de urgência',
      left(p_notification_body, 500), '/comunicacoes'
    );
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_meta_whatsapp_message(uuid, uuid, text, text, timestamptz, text[], text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_meta_whatsapp_message(uuid, uuid, text, text, timestamptz, text[], text, boolean, text) TO service_role;

UPDATE storage.buckets
SET file_size_limit = 26214400,
    allowed_mime_types = ARRAY[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'text/plain', 'application/rtf', 'text/rtf',
      'image/png', 'image/jpeg'
    ]
WHERE id = 'documents';
