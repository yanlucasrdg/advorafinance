-- Platform administration for tenant plans. This does not expose service-role credentials
-- and every callable RPC verifies the authenticated user has the global master_admin role.
ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'suspended';

ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS admin_notes text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tenant_subscriptions'
    )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_subscriptions;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.subscription_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  previous_plan text,
  new_plan text NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  previous_expires_at timestamptz,
  new_expires_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_admin_audit_tenant_created_idx
  ON public.subscription_admin_audit (tenant_id, created_at DESC);

ALTER TABLE public.subscription_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_admin_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.subscription_admin_audit TO authenticated;
GRANT ALL ON public.subscription_admin_audit TO service_role;

DROP POLICY IF EXISTS "master admins view subscription audit" ON public.subscription_admin_audit;
CREATE POLICY "master admins view subscription audit"
  ON public.subscription_admin_audit FOR SELECT TO authenticated
  USING (public.is_master_admin(auth.uid()));

-- Prevent office owners/admins from granting themselves a paid plan through PostgREST.
CREATE OR REPLACE FUNCTION public.protect_tenant_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
    AND NEW.plan IS DISTINCT FROM OLD.plan
    AND NOT public.is_master_admin(auth.uid())
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_tenant_plan_trigger ON public.tenants;
CREATE TRIGGER protect_tenant_plan_trigger
  BEFORE UPDATE OF plan ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.protect_tenant_plan();

-- Effective plan is downgraded to Free after a manually-managed expiration.
CREATE OR REPLACE FUNCTION public.tenant_effective_plan(_tenant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN s.provider = 'manual'
      AND (s.status::text = 'expired' OR (s.current_period_end IS NOT NULL AND s.current_period_end <= now()))
      THEN 'free'
    WHEN COALESCE(s.plan::text, t.plan::text) IN ('essential', 'starter') THEN 'starter'
    WHEN COALESCE(s.plan::text, t.plan::text) IN ('performance', 'professional') THEN 'pro'
    WHEN COALESCE(s.plan::text, t.plan::text) IN ('business', 'enterprise') THEN 'enterprise'
    ELSE 'free'
  END
  FROM public.tenants t
  LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = t.id
  WHERE t.id = _tenant_id;
$$;

CREATE OR REPLACE FUNCTION public.current_effective_plan()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.tenant_effective_plan(p.tenant_id)
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.tenant_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.tenant_plan_limit(_tenant_id uuid, _resource text)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _plan text;
BEGIN
  _plan := public.tenant_effective_plan(_tenant_id);
  RETURN CASE _resource
    WHEN 'users' THEN CASE _plan WHEN 'enterprise' THEN 20 WHEN 'pro' THEN 7 WHEN 'starter' THEN 2 ELSE 2 END
    WHEN 'cases' THEN CASE _plan WHEN 'enterprise' THEN 5000 WHEN 'pro' THEN 1000 WHEN 'starter' THEN 200 ELSE 50 END
    WHEN 'ai_credits' THEN CASE _plan WHEN 'enterprise' THEN 2000 WHEN 'pro' THEN 500 WHEN 'starter' THEN 100 ELSE 30 END
    ELSE 0
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_has_subscription_access(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.tenant_subscriptions s
    WHERE s.tenant_id = _tenant_id AND (
      (s.provider = 'manual' AND s.status::text <> 'suspended')
      OR (s.provider <> 'manual' AND (
        s.status::text = 'active'
        OR (s.status::text = 'trialing' AND s.trial_ends_at > now())
        OR (s.status::text = 'canceled' AND s.current_period_end > now())
        OR (s.status::text = 'past_due' AND s.grace_ends_at > now())
      ))
    )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  WITH users AS (
    SELECT p.id,
      CASE
        WHEN COALESCE(s.plan::text, t.plan::text) IN ('essential','starter') THEN 'starter'
        WHEN COALESCE(s.plan::text, t.plan::text) IN ('performance','professional') THEN 'pro'
        WHEN COALESCE(s.plan::text, t.plan::text) IN ('business','enterprise') THEN 'enterprise'
        ELSE 'free'
      END AS plan,
      CASE
        WHEN s.status::text = 'suspended' OR s.status::text = 'past_due' THEN 'suspended'
        WHEN s.status::text IN ('expired','refunded','chargeback') OR (s.current_period_end IS NOT NULL AND s.current_period_end <= now()) THEN 'expired'
        ELSE 'active'
      END AS access_status
    FROM public.profiles p
    LEFT JOIN public.tenants t ON t.id = p.tenant_id
    LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = p.tenant_id
  )
  SELECT jsonb_build_object(
    'totalUsers', count(*),
    'freeUsers', count(*) FILTER (WHERE plan = 'free'),
    'starterUsers', count(*) FILTER (WHERE plan = 'starter'),
    'proUsers', count(*) FILTER (WHERE plan = 'pro'),
    'enterpriseUsers', count(*) FILTER (WHERE plan = 'enterprise'),
    'activeUsers', count(*) FILTER (WHERE access_status = 'active'),
    'suspendedUsers', count(*) FILTER (WHERE access_status = 'suspended'),
    'expiredUsers', count(*) FILTER (WHERE access_status = 'expired')
  ) INTO result FROM users;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_users(
  p_search text DEFAULT NULL,
  p_plan text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20
)
RETURNS TABLE (
  user_id uuid, full_name text, email text, created_at timestamptz,
  tenant_id uuid, tenant_name text, plan text, access_status text,
  expires_at timestamptz, total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_REQUIRED';
  END IF;
  IF p_page < 1 OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PAGINATION';
  END IF;

  RETURN QUERY
  WITH normalized AS (
    SELECT p.id AS uid, p.full_name AS uname, p.email AS uemail, p.created_at AS ucreated,
      p.tenant_id AS tid, t.name AS tname,
      CASE
        WHEN COALESCE(s.plan::text, t.plan::text) IN ('essential','starter') THEN 'starter'
        WHEN COALESCE(s.plan::text, t.plan::text) IN ('performance','professional') THEN 'pro'
        WHEN COALESCE(s.plan::text, t.plan::text) IN ('business','enterprise') THEN 'enterprise'
        ELSE 'free'
      END AS uplan,
      CASE
        WHEN s.status::text = 'suspended' OR s.status::text = 'past_due' THEN 'suspended'
        WHEN s.status::text IN ('expired','refunded','chargeback') OR (s.current_period_end IS NOT NULL AND s.current_period_end <= now()) THEN 'expired'
        ELSE 'active'
      END AS ustatus,
      s.current_period_end AS uexpires
    FROM public.profiles p
    LEFT JOIN public.tenants t ON t.id = p.tenant_id
    LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = p.tenant_id
  ), filtered AS (
    SELECT * FROM normalized n
    WHERE (NULLIF(trim(p_search), '') IS NULL OR n.uname ILIKE '%' || trim(p_search) || '%' OR n.uemail ILIKE '%' || trim(p_search) || '%')
      AND (NULLIF(p_plan, '') IS NULL OR n.uplan = p_plan)
      AND (NULLIF(p_status, '') IS NULL OR n.ustatus = p_status)
  )
  SELECT f.uid, f.uname, f.uemail, f.ucreated, f.tid, f.tname, f.uplan, f.ustatus,
    f.uexpires, count(*) OVER()
  FROM filtered f
  ORDER BY f.ucreated DESC
  OFFSET (p_page - 1) * p_page_size LIMIT p_page_size;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_user_detail(p_user_id uuid)
RETURNS TABLE (
  user_id uuid, full_name text, email text, created_at timestamptz,
  tenant_id uuid, tenant_name text, plan text, access_status text,
  expires_at timestamptz, admin_notes text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.email, p.created_at, p.tenant_id, t.name,
    CASE
      WHEN COALESCE(s.plan::text, t.plan::text) IN ('essential','starter') THEN 'starter'
      WHEN COALESCE(s.plan::text, t.plan::text) IN ('performance','professional') THEN 'pro'
      WHEN COALESCE(s.plan::text, t.plan::text) IN ('business','enterprise') THEN 'enterprise'
      ELSE 'free'
    END,
    CASE
      WHEN s.status::text = 'suspended' OR s.status::text = 'past_due' THEN 'suspended'
      WHEN s.status::text IN ('expired','refunded','chargeback') OR (s.current_period_end IS NOT NULL AND s.current_period_end <= now()) THEN 'expired'
      ELSE 'active'
    END,
    s.current_period_end, s.admin_notes
  FROM public.profiles p
  LEFT JOIN public.tenants t ON t.id = p.tenant_id
  LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = p.tenant_id
  WHERE p.id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_update_subscription(
  p_user_id uuid,
  p_plan text,
  p_status text,
  p_expires_at timestamptz DEFAULT NULL,
  p_admin_notes text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_old_plan text;
  v_old_status text;
  v_old_expires timestamptz;
  v_stored_plan public.tenant_plan;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_REQUIRED';
  END IF;
  IF p_plan NOT IN ('free','starter','pro','enterprise') OR p_status NOT IN ('active','suspended','expired') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLAN_OR_STATUS';
  END IF;
  IF length(COALESCE(p_admin_notes, '')) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ADMIN_NOTES_TOO_LONG';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM public.profiles WHERE id = p_user_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'USER_TENANT_NOT_FOUND'; END IF;

  SELECT plan::text, status::text, current_period_end
    INTO v_old_plan, v_old_status, v_old_expires
  FROM public.tenant_subscriptions WHERE tenant_id = v_tenant_id FOR UPDATE;

  v_stored_plan := (CASE p_plan WHEN 'starter' THEN 'essential' WHEN 'pro' THEN 'performance' WHEN 'enterprise' THEN 'business' ELSE 'trial' END)::public.tenant_plan;

  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan, status, provider, current_period_end, trial_ends_at,
    grace_ends_at, cancel_at_period_end, admin_notes, updated_at
  ) VALUES (
    v_tenant_id, v_stored_plan, p_status::public.subscription_status, 'manual', p_expires_at, NULL,
    NULL, false, NULLIF(trim(p_admin_notes), ''), now()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    plan = EXCLUDED.plan, status = EXCLUDED.status, provider = 'manual',
    current_period_end = EXCLUDED.current_period_end, trial_ends_at = NULL,
    grace_ends_at = NULL, cancel_at_period_end = false,
    admin_notes = EXCLUDED.admin_notes, updated_at = now();

  UPDATE public.tenants SET plan = v_stored_plan, updated_at = now() WHERE id = v_tenant_id;

  INSERT INTO public.subscription_admin_audit (
    admin_user_id, target_user_id, tenant_id, previous_plan, new_plan,
    previous_status, new_status, previous_expires_at, new_expires_at, note
  ) VALUES (
    auth.uid(), p_user_id, v_tenant_id, v_old_plan, p_plan,
    v_old_status, p_status, v_old_expires, p_expires_at, NULLIF(trim(p_admin_notes), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.protect_tenant_plan(), public.tenant_effective_plan(uuid),
  public.current_effective_plan(),
  public.platform_admin_dashboard(), public.platform_admin_list_users(text,text,text,integer,integer),
  public.platform_admin_user_detail(uuid), public.platform_admin_update_subscription(uuid,text,text,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_effective_plan(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.current_effective_plan() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_dashboard(), public.platform_admin_list_users(text,text,text,integer,integer),
  public.platform_admin_user_detail(uuid), public.platform_admin_update_subscription(uuid,text,text,timestamptz,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.protect_tenant_plan() TO service_role;

COMMENT ON TABLE public.subscription_admin_audit IS 'Immutable audit trail for platform administrator subscription changes.';
COMMENT ON FUNCTION public.platform_admin_update_subscription(uuid,text,text,timestamptz,text) IS 'Atomically updates a tenant subscription after a master_admin authorization check.';
