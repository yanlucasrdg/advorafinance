-- Enterprise P0: enforce RBAC at the database boundary, close a cross-tenant
-- financial write path and make subscription access authoritative.

-- Reconcile the exact production drift captured on 2026-08-05: billing was
-- never installed, even though the application and later migrations use it.
ALTER TYPE public.tenant_plan ADD VALUE IF NOT EXISTS 'essential';
ALTER TYPE public.tenant_plan ADD VALUE IF NOT EXISTS 'performance';
ALTER TYPE public.tenant_plan ADD VALUE IF NOT EXISTS 'business';

DO $billing_types$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'subscription_status'
  ) THEN
    CREATE TYPE public.subscription_status AS ENUM (
      'trialing','active','past_due','canceled','expired','refunded','chargeback'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'billing_interval'
  ) THEN
    CREATE TYPE public.billing_interval AS ENUM ('monthly','annual');
  END IF;
END;
$billing_types$;

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan public.tenant_plan NOT NULL DEFAULT 'trial',
  status public.subscription_status NOT NULL DEFAULT 'trialing',
  provider text NOT NULL DEFAULT 'kirvano' CHECK (provider IN ('kirvano','manual')),
  billing_interval public.billing_interval,
  kirvano_sale_id text UNIQUE,
  kirvano_checkout_id text,
  kirvano_offer_id text,
  kirvano_product_id text,
  customer_email text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  sale_id text,
  checkout_id text,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processed','ignored','error')),
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS tenant_subscriptions_status_idx
  ON public.tenant_subscriptions (status, current_period_end);
CREATE INDEX IF NOT EXISTS billing_webhook_events_tenant_idx
  ON public.billing_webhook_events (tenant_id, received_at DESC);
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.tenant_subscriptions TO authenticated;
GRANT ALL ON public.tenant_subscriptions, public.billing_webhook_events TO service_role;

DROP POLICY IF EXISTS "tenant members view subscription" ON public.tenant_subscriptions;
CREATE POLICY "tenant members view subscription" ON public.tenant_subscriptions
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_master_admin(auth.uid()));

INSERT INTO public.tenant_subscriptions (tenant_id, plan, status, trial_ends_at)
SELECT
  id,
  plan,
  CASE WHEN plan = 'trial'
    THEN 'trialing'::public.subscription_status
    ELSE 'active'::public.subscription_status
  END,
  CASE WHEN plan = 'trial' THEN now() + interval '14 days' ELSE NULL END
FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.tenant_subscriptions (tenant_id, plan, status, trial_ends_at)
  VALUES (NEW.id, 'trial', 'trialing', now() + interval '14 days')
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_trial_subscription_after_tenant ON public.tenants;
CREATE TRIGGER create_trial_subscription_after_tenant
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.create_trial_subscription();

CREATE OR REPLACE FUNCTION public.tenant_plan_limit(_tenant_id uuid, _resource text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_plan text;
BEGIN
  SELECT plan::text INTO v_plan FROM public.tenants WHERE id = _tenant_id;
  RETURN CASE _resource
    WHEN 'users' THEN CASE v_plan
      WHEN 'business' THEN 20 WHEN 'enterprise' THEN 20
      WHEN 'performance' THEN 7 WHEN 'professional' THEN 7 ELSE 2 END
    WHEN 'cases' THEN CASE v_plan
      WHEN 'business' THEN 5000 WHEN 'enterprise' THEN 5000
      WHEN 'performance' THEN 1000 WHEN 'professional' THEN 1000
      WHEN 'essential' THEN 200 WHEN 'starter' THEN 200 ELSE 50 END
    WHEN 'ai_credits' THEN CASE v_plan
      WHEN 'business' THEN 2000 WHEN 'enterprise' THEN 2000
      WHEN 'performance' THEN 500 WHEN 'professional' THEN 500
      WHEN 'essential' THEN 100 WHEN 'starter' THEN 100 ELSE 30 END
    ELSE 0
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_has_subscription_access(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.tenant_subscriptions s
    WHERE s.tenant_id = _tenant_id AND (
      s.status = 'active'
      OR (s.status = 'trialing' AND s.trial_ends_at > now())
      OR (s.status = 'canceled' AND s.current_period_end > now())
      OR (s.status = 'past_due' AND s.grace_ends_at > now())
    )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.enforce_profile_plan_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_current integer; v_limit integer;
BEGIN
  IF NEW.tenant_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id) THEN RETURN NEW; END IF;
  IF NOT public.tenant_has_subscription_access(NEW.tenant_id) THEN RAISE EXCEPTION 'SUBSCRIPTION_ACCESS_DENIED'; END IF;
  SELECT count(*) INTO v_current FROM public.profiles WHERE tenant_id = NEW.tenant_id;
  v_limit := public.tenant_plan_limit(NEW.tenant_id, 'users');
  IF v_current >= v_limit THEN RAISE EXCEPTION 'PLAN_USER_LIMIT_REACHED'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_case_plan_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_current integer; v_limit integer;
BEGIN
  IF NOT public.tenant_has_subscription_access(NEW.tenant_id) THEN RAISE EXCEPTION 'SUBSCRIPTION_ACCESS_DENIED'; END IF;
  SELECT count(*) INTO v_current FROM public.cases WHERE tenant_id = NEW.tenant_id AND deleted_at IS NULL;
  v_limit := public.tenant_plan_limit(NEW.tenant_id, 'cases');
  IF v_current >= v_limit THEN RAISE EXCEPTION 'PLAN_CASE_LIMIT_REACHED'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_ai_plan_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_current integer; v_limit integer;
BEGIN
  IF NEW.role <> 'user' THEN RETURN NEW; END IF;
  IF NOT public.tenant_has_subscription_access(NEW.tenant_id) THEN RAISE EXCEPTION 'SUBSCRIPTION_ACCESS_DENIED'; END IF;
  SELECT count(*) INTO v_current FROM public.ai_messages
  WHERE tenant_id = NEW.tenant_id AND role = 'user' AND created_at >= date_trunc('month', now());
  v_limit := public.tenant_plan_limit(NEW.tenant_id, 'ai_credits');
  IF v_current >= v_limit THEN RAISE EXCEPTION 'PLAN_AI_LIMIT_REACHED'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_profile_plan_limit_trigger ON public.profiles;
CREATE TRIGGER enforce_profile_plan_limit_trigger
  BEFORE INSERT OR UPDATE OF tenant_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_plan_limit();
DROP TRIGGER IF EXISTS enforce_case_plan_limit_trigger ON public.cases;
CREATE TRIGGER enforce_case_plan_limit_trigger
  BEFORE INSERT ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.enforce_case_plan_limit();
DROP TRIGGER IF EXISTS enforce_ai_plan_limit_trigger ON public.ai_messages;
CREATE TRIGGER enforce_ai_plan_limit_trigger
  BEFORE INSERT ON public.ai_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ai_plan_limit();

REVOKE ALL ON FUNCTION public.create_trial_subscription() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_plan_limit(uuid, text), public.tenant_has_subscription_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_profile_plan_limit(), public.enforce_case_plan_limit(), public.enforce_ai_plan_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_trial_subscription() TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_plan_limit(uuid, text), public.tenant_has_subscription_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_profile_plan_limit(), public.enforce_case_plan_limit(), public.enforce_ai_plan_limit() TO service_role;

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

-- Restore the deadline/process RPC layer that is absent from the diagnosed
-- production schema. Optimistic versioning prevents silent concurrent edits.
UPDATE public.deadlines
SET kind = CASE
  WHEN kind = 'prazo' THEN 'prazo_processual'
  WHEN kind IN (
    'audiencia','prazo_processual','reuniao','tarefa','primeiro_atendimento',
    'followup','vencimento','protocolo','compromisso','outro'
  ) THEN kind ELSE 'outro' END,
  priority = CASE priority
    WHEN 'baixa' THEN 'low' WHEN 'media' THEN 'medium'
    WHEN 'alta' THEN 'high' WHEN 'critica' THEN 'critical'
    WHEN 'low' THEN 'low' WHEN 'medium' THEN 'medium'
    WHEN 'high' THEN 'high' WHEN 'critical' THEN 'critical'
    ELSE 'medium' END;

ALTER TABLE public.deadlines ALTER COLUMN kind SET DEFAULT 'prazo_processual';
ALTER TABLE public.deadlines ALTER COLUMN priority SET DEFAULT 'medium';
ALTER TABLE public.deadlines DROP CONSTRAINT IF EXISTS chk_deadlines_kind;
ALTER TABLE public.deadlines ADD CONSTRAINT chk_deadlines_kind CHECK (kind IN (
  'audiencia','prazo_processual','reuniao','tarefa','primeiro_atendimento',
  'followup','vencimento','protocolo','compromisso','outro'
));
ALTER TABLE public.deadlines DROP CONSTRAINT IF EXISTS chk_deadlines_priority;
ALTER TABLE public.deadlines ADD CONSTRAINT chk_deadlines_priority
  CHECK (priority IN ('low','medium','high','critical'));

CREATE OR REPLACE FUNCTION public.bump_deadline_status_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.status_version := OLD.status_version + 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_deadlines_status_version ON public.deadlines;
CREATE TRIGGER trg_deadlines_status_version
  BEFORE UPDATE ON public.deadlines
  FOR EACH ROW EXECUTE FUNCTION public.bump_deadline_status_version();
CREATE TRIGGER trg_deadline_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.deadlines
  FOR EACH ROW EXECUTE FUNCTION public.fn_deadline_audit();

CREATE OR REPLACE FUNCTION public.create_deadline(
  p_title text,
  p_kind text,
  p_due_at timestamptz,
  p_priority text DEFAULT 'medium',
  p_case_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.deadlines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_deadline public.deadlines%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'DEADLINE_AUTH_REQUIRED'; END IF;
  IF length(trim(COALESCE(p_title, ''))) NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION 'DEADLINE_TITLE_INVALID'; END IF;
  IF p_kind NOT IN (
    'audiencia','prazo_processual','reuniao','tarefa','primeiro_atendimento',
    'followup','vencimento','protocolo','compromisso','outro'
  ) THEN RAISE EXCEPTION 'DEADLINE_KIND_INVALID'; END IF;
  IF p_priority NOT IN ('low','medium','high','critical') THEN RAISE EXCEPTION 'DEADLINE_PRIORITY_INVALID'; END IF;
  IF p_due_at <= '1990-01-01'::timestamptz THEN RAISE EXCEPTION 'DEADLINE_DATE_INVALID'; END IF;
  IF p_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cases WHERE id = p_case_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'DEADLINE_CASE_INVALID'; END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = p_client_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'DEADLINE_CLIENT_INVALID'; END IF;

  INSERT INTO public.deadlines (
    tenant_id, created_by, title, kind, due_at, priority, case_id, client_id, notes
  ) VALUES (
    v_tenant_id, auth.uid(), trim(p_title), p_kind, p_due_at, p_priority,
    p_case_id, p_client_id, NULLIF(trim(COALESCE(p_notes, '')), '')
  ) RETURNING * INTO v_deadline;
  RETURN v_deadline;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_deadline(
  p_deadline_id uuid,
  p_expected_version integer,
  p_patch jsonb
)
RETURNS public.deadlines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_deadline public.deadlines%ROWTYPE;
  v_title text; v_kind text; v_due_at timestamptz; v_priority text;
  v_case_id uuid; v_client_id uuid; v_notes text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'DEADLINE_AUTH_REQUIRED'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_patch) AS key
    WHERE key NOT IN ('title','kind','due_at','priority','case_id','client_id','notes')
  ) THEN RAISE EXCEPTION 'DEADLINE_PATCH_INVALID'; END IF;

  SELECT * INTO v_deadline FROM public.deadlines
  WHERE id = p_deadline_id AND tenant_id = v_tenant_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEADLINE_NOT_FOUND'; END IF;
  IF v_deadline.status_version <> p_expected_version THEN RAISE EXCEPTION 'DEADLINE_VERSION_CONFLICT'; END IF;

  v_title := CASE WHEN p_patch ? 'title' THEN trim(p_patch->>'title') ELSE v_deadline.title END;
  v_kind := CASE WHEN p_patch ? 'kind' THEN p_patch->>'kind' ELSE v_deadline.kind END;
  v_due_at := CASE WHEN p_patch ? 'due_at' THEN (p_patch->>'due_at')::timestamptz ELSE v_deadline.due_at END;
  v_priority := CASE WHEN p_patch ? 'priority' THEN p_patch->>'priority' ELSE v_deadline.priority END;
  v_case_id := CASE WHEN p_patch ? 'case_id' THEN NULLIF(p_patch->>'case_id', '')::uuid ELSE v_deadline.case_id END;
  v_client_id := CASE WHEN p_patch ? 'client_id' THEN NULLIF(p_patch->>'client_id', '')::uuid ELSE v_deadline.client_id END;
  v_notes := CASE WHEN p_patch ? 'notes' THEN NULLIF(trim(COALESCE(p_patch->>'notes', '')), '') ELSE v_deadline.notes END;

  IF length(COALESCE(v_title, '')) NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION 'DEADLINE_TITLE_INVALID'; END IF;
  IF v_kind NOT IN (
    'audiencia','prazo_processual','reuniao','tarefa','primeiro_atendimento',
    'followup','vencimento','protocolo','compromisso','outro'
  ) THEN RAISE EXCEPTION 'DEADLINE_KIND_INVALID'; END IF;
  IF v_priority NOT IN ('low','medium','high','critical') THEN RAISE EXCEPTION 'DEADLINE_PRIORITY_INVALID'; END IF;
  IF v_due_at <= '1990-01-01'::timestamptz THEN RAISE EXCEPTION 'DEADLINE_DATE_INVALID'; END IF;
  IF v_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cases WHERE id = v_case_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'DEADLINE_CASE_INVALID'; END IF;
  IF v_client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = v_client_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'DEADLINE_CLIENT_INVALID'; END IF;

  UPDATE public.deadlines SET
    title = v_title, kind = v_kind, due_at = v_due_at, priority = v_priority,
    case_id = v_case_id, client_id = v_client_id, notes = v_notes
  WHERE id = p_deadline_id RETURNING * INTO v_deadline;
  RETURN v_deadline;
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_deadline_completion(
  p_deadline_id uuid, p_expected_version integer
)
RETURNS public.deadlines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_deadline public.deadlines%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'DEADLINE_AUTH_REQUIRED'; END IF;
  SELECT * INTO v_deadline FROM public.deadlines
  WHERE id = p_deadline_id AND tenant_id = v_tenant_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEADLINE_NOT_FOUND'; END IF;
  IF v_deadline.status_version <> p_expected_version THEN RAISE EXCEPTION 'DEADLINE_VERSION_CONFLICT'; END IF;
  UPDATE public.deadlines SET
    done = NOT v_deadline.done,
    completed_at = CASE WHEN NOT v_deadline.done THEN now() ELSE NULL END,
    completed_by = CASE WHEN NOT v_deadline.done THEN auth.uid() ELSE NULL END
  WHERE id = p_deadline_id RETURNING * INTO v_deadline;
  RETURN v_deadline;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_deadline(
  p_deadline_id uuid, p_expected_version integer
)
RETURNS public.deadlines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_deadline public.deadlines%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'DEADLINE_AUTH_REQUIRED'; END IF;
  SELECT * INTO v_deadline FROM public.deadlines
  WHERE id = p_deadline_id AND tenant_id = v_tenant_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEADLINE_NOT_FOUND'; END IF;
  IF v_deadline.status_version <> p_expected_version THEN RAISE EXCEPTION 'DEADLINE_VERSION_CONFLICT'; END IF;
  UPDATE public.deadlines SET deleted_at = now()
  WHERE id = p_deadline_id RETURNING * INTO v_deadline;
  RETURN v_deadline;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_case(
  p_case_id uuid, p_expected_version integer
)
RETURNS public.cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_case public.cases%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'CASE_AUTH_REQUIRED'; END IF;
  SELECT * INTO v_case FROM public.cases
  WHERE id = p_case_id AND tenant_id = v_tenant_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND'; END IF;
  IF v_case.status_version <> p_expected_version THEN RAISE EXCEPTION 'CASE_STATUS_CONFLICT'; END IF;
  UPDATE public.cases SET deleted_at = now()
  WHERE id = p_case_id RETURNING * INTO v_case;
  RETURN v_case;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON public.deadlines FROM authenticated;
REVOKE DELETE, UPDATE ON public.cases FROM authenticated;
GRANT UPDATE (
  title, number, tribunal, court, area, value_cents, description,
  client_id, responsible, parties, class_name, distribution_date,
  instance, subjects, conversation_id, lead_source, lead_temperature,
  pipeline_stage, pipeline_value_cents
) ON public.cases TO authenticated;

REVOKE ALL ON FUNCTION public.create_deadline(text, text, timestamptz, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_deadline(uuid, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_deadline_completion(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_deadline(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_case(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_deadline(text, text, timestamptz, text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_deadline(uuid, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_deadline_completion(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_deadline(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_case(uuid, integer) TO authenticated;
CREATE INDEX IF NOT EXISTS idx_deadlines_tenant_active_due
  ON public.deadlines (tenant_id, done, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cases_tenant_active_status
  ON public.cases (tenant_id, status, updated_at DESC) WHERE deleted_at IS NULL;

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
-- Clean up a partially committed prior attempt before recreating the complete
-- policy set. This makes the script safe in SQL editors that autocommit DDL.
DO $rbac_cleanup$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE policyname LIKE 'rbac %'
      AND schemaname IN ('public', 'storage')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename
    );
  END LOOP;
END;
$rbac_cleanup$;

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
DROP POLICY IF EXISTS "Owners can manage tenant roles" ON public.user_roles;
DROP POLICY IF EXISTS "Owners manage tenant roles (no master_admin)" ON public.user_roles;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
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

DROP TRIGGER IF EXISTS trg_apply_fin_payment ON public.financial_payments;
CREATE TRIGGER trg_apply_fin_payment
  AFTER INSERT ON public.financial_payments
  FOR EACH ROW EXECUTE FUNCTION public.apply_financial_payment();
REVOKE ALL ON FUNCTION public.apply_financial_payment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_financial_payment() TO service_role;

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
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_external_message_id_unique
  ON public.whatsapp_messages (tenant_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

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

-- Fail with one consolidated message if the reconciled contract is incomplete.
DO $contract_check$
DECLARE
  missing_relations text[];
  missing_functions text[];
BEGIN
  SELECT array_agg(name ORDER BY name) INTO missing_relations
  FROM (VALUES
    ('public.documents'), ('public.deadline_audit_log'),
    ('public.tenant_subscriptions'), ('public.billing_webhook_events')
  ) AS required(name)
  WHERE to_regclass(name) IS NULL;

  SELECT array_agg(signature ORDER BY signature) INTO missing_functions
  FROM (VALUES
    ('public.tenant_has_subscription_access(uuid)'),
    ('public.soft_delete_case(uuid,integer)'),
    ('public.soft_delete_deadline(uuid,integer)'),
    ('public.update_deadline(uuid,integer,jsonb)'),
    ('public.toggle_deadline_completion(uuid,integer)'),
    ('public.create_intake_followup(uuid,text)'),
    ('public.ingest_meta_whatsapp_message(uuid,uuid,text,text,timestamptz,text[],text,boolean,text)')
  ) AS required(signature)
  WHERE to_regprocedure(signature) IS NULL;

  IF missing_relations IS NOT NULL OR missing_functions IS NOT NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_CONTRACT_INCOMPLETE relations=% functions=%',
      COALESCE(missing_relations, ARRAY[]::text[]),
      COALESCE(missing_functions, ARRAY[]::text[]);
  END IF;
END;
$contract_check$;

SELECT
  'enterprise_p0_ready' AS status,
  count(*) AS tenants_with_subscription
FROM public.tenant_subscriptions;
