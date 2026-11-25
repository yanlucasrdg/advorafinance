-- Scoped production definition captured before the seven-day release.
-- Restores only future trial provisioning; preserves existing deadlines.
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  deadline timestamptz := now() + interval '72 hours';
BEGIN
  INSERT INTO public.tenant_subscriptions
    (tenant_id, plan, status, trial_ends_at, current_period_end)
  VALUES (NEW.id, 'business', 'trialing', deadline, deadline)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;
