-- Runs once per new office, including password and OAuth onboarding.
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  deadline timestamptz := now() + interval '168 hours';
BEGIN
  INSERT INTO public.tenant_subscriptions
    (tenant_id, plan, status, trial_ends_at, current_period_end)
  VALUES (NEW.id, 'business', 'trialing', deadline, deadline)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_effective_plan(_tenant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN NOT public.tenant_has_subscription_access(_tenant_id)
      OR (s.provider = 'manual' AND (s.status::text = 'expired' OR s.current_period_end <= now()))
      THEN 'free'
    WHEN s.plan::text IN ('business','enterprise') THEN 'enterprise'
    WHEN s.plan::text IN ('performance','professional') THEN 'pro'
    WHEN s.plan::text IN ('essential','starter') THEN 'starter'
    ELSE 'free'
  END
  FROM public.tenant_subscriptions s WHERE s.tenant_id = _tenant_id;
$$;

CREATE OR REPLACE FUNCTION public.platform_admin_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_master_admin(auth.uid()) OR auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_REQUIRED';
  END IF;
  RETURN (
    WITH offices AS MATERIALIZED (
      SELECT s.tenant_id, public.tenant_effective_plan(s.tenant_id) AS plan,
        s.status, s.provider, s.trial_ends_at,
        CASE WHEN s.status::text = 'suspended' THEN 'suspended'
          WHEN NOT public.tenant_has_subscription_access(s.tenant_id)
            OR (s.provider = 'manual' AND (s.status::text = 'expired' OR s.current_period_end <= now()))
            THEN 'expired' ELSE 'active' END AS access
      FROM public.tenant_subscriptions s
    )
    SELECT jsonb_build_object(
      'totalUsers', count(*), 'activeUsers', count(*) FILTER (WHERE o.access = 'active'),
      'freeUsers', count(*) FILTER (WHERE coalesce(o.plan,'free') = 'free'),
      'starterUsers', count(*) FILTER (WHERE o.plan = 'starter'),
      'proUsers', count(*) FILTER (WHERE o.plan = 'pro'),
      'enterpriseUsers', count(*) FILTER (WHERE o.plan = 'enterprise'),
      'expiredUsers', count(*) FILTER (WHERE o.access = 'expired'),
      'suspendedUsers', count(*) FILTER (WHERE o.access = 'suspended'),
      'trialOffices', (SELECT count(*) FROM offices WHERE status::text = 'trialing' AND trial_ends_at > now()),
      'paidOffices', (SELECT count(*) FROM offices WHERE provider = 'kirvano' AND status::text = 'active')
    ) FROM public.profiles p LEFT JOIN offices o ON o.tenant_id = p.tenant_id
  );
END;
$$;
