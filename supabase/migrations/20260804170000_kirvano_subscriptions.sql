-- Advora subscriptions and Kirvano webhook event ledger.
ALTER TYPE public.tenant_plan ADD VALUE IF NOT EXISTS 'essential';
ALTER TYPE public.tenant_plan ADD VALUE IF NOT EXISTS 'performance';
ALTER TYPE public.tenant_plan ADD VALUE IF NOT EXISTS 'business';

DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM ('trialing','active','past_due','canceled','expired','refunded','chargeback');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_interval AS ENUM ('monthly','annual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
  processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','ignored','error')),
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS tenant_subscriptions_status_idx ON public.tenant_subscriptions(status, current_period_end);
CREATE INDEX IF NOT EXISTS billing_webhook_events_tenant_idx ON public.billing_webhook_events(tenant_id, received_at DESC);

ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.tenant_subscriptions TO authenticated;
GRANT ALL ON public.tenant_subscriptions, public.billing_webhook_events TO service_role;

DROP POLICY IF EXISTS "tenant members view subscription" ON public.tenant_subscriptions;
CREATE POLICY "tenant members view subscription" ON public.tenant_subscriptions
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id() OR public.is_master_admin(auth.uid()));

INSERT INTO public.tenant_subscriptions (tenant_id, plan, status, trial_ends_at)
SELECT id, plan, CASE WHEN plan = 'trial' THEN 'trialing'::public.subscription_status ELSE 'active'::public.subscription_status END,
  CASE WHEN plan = 'trial' THEN now() + interval '14 days' ELSE NULL END
FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tenant_subscriptions (tenant_id, plan, status, trial_ends_at)
  VALUES (NEW.id, 'trial', 'trialing', now() + interval '14 days')
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_trial_subscription_after_tenant ON public.tenants;
CREATE TRIGGER create_trial_subscription_after_tenant
  AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.create_trial_subscription();

REVOKE ALL ON FUNCTION public.create_trial_subscription() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_trial_subscription() TO service_role;

-- Centralized limits keep server functions and direct PostgREST writes consistent.
CREATE OR REPLACE FUNCTION public.tenant_plan_limit(_tenant_id uuid, _resource text)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _plan public.tenant_plan;
BEGIN
  SELECT plan INTO _plan FROM public.tenants WHERE id = _tenant_id;
  RETURN CASE _resource
    WHEN 'users' THEN CASE _plan WHEN 'business' THEN 20 WHEN 'enterprise' THEN 20 WHEN 'performance' THEN 7 WHEN 'professional' THEN 7 WHEN 'essential' THEN 2 WHEN 'starter' THEN 2 ELSE 2 END
    WHEN 'cases' THEN CASE _plan WHEN 'business' THEN 5000 WHEN 'enterprise' THEN 5000 WHEN 'performance' THEN 1000 WHEN 'professional' THEN 1000 WHEN 'essential' THEN 200 WHEN 'starter' THEN 200 ELSE 50 END
    WHEN 'ai_credits' THEN CASE _plan WHEN 'business' THEN 2000 WHEN 'enterprise' THEN 2000 WHEN 'performance' THEN 500 WHEN 'professional' THEN 500 WHEN 'essential' THEN 100 WHEN 'starter' THEN 100 ELSE 30 END
    ELSE 0
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_has_subscription_access(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _current integer; _limit integer;
BEGIN
  IF NEW.tenant_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id) THEN RETURN NEW; END IF;
  IF NOT public.tenant_has_subscription_access(NEW.tenant_id) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'A assinatura deste escritório não está ativa.'; END IF;
  SELECT count(*) INTO _current FROM public.profiles WHERE tenant_id = NEW.tenant_id;
  _limit := public.tenant_plan_limit(NEW.tenant_id, 'users');
  IF _current >= _limit THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = format('Seu plano permite até %s usuários.', _limit); END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_case_plan_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _current integer; _limit integer;
BEGIN
  IF NOT public.tenant_has_subscription_access(NEW.tenant_id) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'A assinatura deste escritório não está ativa.'; END IF;
  SELECT count(*) INTO _current FROM public.cases WHERE tenant_id = NEW.tenant_id AND deleted_at IS NULL;
  _limit := public.tenant_plan_limit(NEW.tenant_id, 'cases');
  IF _current >= _limit THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = format('Seu plano permite até %s processos ativos.', _limit); END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_ai_plan_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _current integer; _limit integer;
BEGIN
  IF NEW.role <> 'user' THEN RETURN NEW; END IF;
  IF NOT public.tenant_has_subscription_access(NEW.tenant_id) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'A assinatura deste escritório não está ativa.'; END IF;
  SELECT count(*) INTO _current FROM public.ai_messages WHERE tenant_id = NEW.tenant_id AND role = 'user' AND created_at >= date_trunc('month', now());
  _limit := public.tenant_plan_limit(NEW.tenant_id, 'ai_credits');
  IF _current >= _limit THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = format('Os %s créditos mensais de IA do plano foram utilizados.', _limit); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_profile_plan_limit_trigger ON public.profiles;
CREATE TRIGGER enforce_profile_plan_limit_trigger BEFORE INSERT OR UPDATE OF tenant_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_plan_limit();
DROP TRIGGER IF EXISTS enforce_case_plan_limit_trigger ON public.cases;
CREATE TRIGGER enforce_case_plan_limit_trigger BEFORE INSERT ON public.cases FOR EACH ROW EXECUTE FUNCTION public.enforce_case_plan_limit();
DROP TRIGGER IF EXISTS enforce_ai_plan_limit_trigger ON public.ai_messages;
CREATE TRIGGER enforce_ai_plan_limit_trigger BEFORE INSERT ON public.ai_messages FOR EACH ROW EXECUTE FUNCTION public.enforce_ai_plan_limit();

REVOKE ALL ON FUNCTION public.tenant_plan_limit(uuid, text), public.tenant_has_subscription_access(uuid), public.enforce_profile_plan_limit(), public.enforce_case_plan_limit(), public.enforce_ai_plan_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_plan_limit(uuid, text), public.tenant_has_subscription_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_profile_plan_limit(), public.enforce_case_plan_limit(), public.enforce_ai_plan_limit() TO service_role;
