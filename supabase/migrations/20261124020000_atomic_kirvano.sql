-- Commit the delivery receipt and subscription together so failed deliveries can retry.
CREATE OR REPLACE FUNCTION public.apply_kirvano_event(p_event jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  office uuid;
  owner_office uuid;
  receipt uuid;
  event_time timestamptz := (p_event->>'at')::timestamptz;
  deadline timestamptz := (p_event->>'period_end')::timestamptz;
  state public.subscription_status := (p_event->>'status')::public.subscription_status;
  tier public.tenant_plan := (p_event->>'plan')::public.tenant_plan;
  sub public.tenant_subscriptions%ROWTYPE;
BEGIN
  INSERT INTO public.billing_webhook_events(event_key,event_type,sale_id,checkout_id)
    VALUES(p_event->>'key',p_event->>'event',p_event->>'sale',p_event->>'checkout')
    ON CONFLICT (event_key) DO UPDATE SET processing_status = 'received'
      WHERE billing_webhook_events.processing_status IN ('received','error')
    RETURNING id INTO receipt;
  IF receipt IS NULL THEN RETURN 'duplicate'; END IF;

  SELECT tenant_id INTO office FROM public.tenant_subscriptions WHERE kirvano_sale_id = p_event->>'sale';
  IF office IS NULL THEN
    SELECT r.tenant_id INTO STRICT owner_office FROM public.user_roles r
      JOIN auth.users u ON u.id = r.user_id
      WHERE r.role = 'owner' AND lower(u.email) = lower(p_event->>'email')
        AND u.email_confirmed_at IS NOT NULL;
    office := owner_office;
  END IF;
  IF (p_event->>'tenant')::uuid IS NOT NULL AND office IS DISTINCT FROM (p_event->>'tenant')::uuid THEN
    RAISE EXCEPTION 'BILLING_TENANT_MISMATCH';
  END IF;
  SELECT * INTO STRICT sub FROM public.tenant_subscriptions WHERE tenant_id = office FOR UPDATE;
  IF event_time < sub.last_event_at OR
     (state <> 'active' AND sub.kirvano_sale_id IS DISTINCT FROM (p_event->>'sale')) THEN
    UPDATE public.billing_webhook_events SET tenant_id = office, processing_status = 'ignored',
      error_message = 'superseded_event', processed_at = now() WHERE id = receipt;
    RETURN 'ignored';
  END IF;
  IF state = 'canceled' THEN deadline := coalesce(deadline,sub.current_period_end); END IF;
  UPDATE public.tenant_subscriptions SET plan = tier, status = state, provider = 'kirvano',
    billing_interval = coalesce((p_event->>'interval')::public.billing_interval, sub.billing_interval),
    kirvano_sale_id = p_event->>'sale', kirvano_checkout_id = p_event->>'checkout',
    kirvano_offer_id = p_event->>'offer', kirvano_product_id = p_event->>'product',
    customer_email = p_event->>'email', trial_ends_at = NULL, current_period_end = deadline,
    cancel_at_period_end = state = 'canceled',
    grace_ends_at = CASE WHEN state = 'past_due' THEN event_time + interval '72 hours' END,
    last_event_at = event_time, updated_at = now() WHERE tenant_id = office;
  UPDATE public.tenants SET plan = CASE WHEN public.tenant_has_subscription_access(office)
    THEN tier ELSE 'trial'::public.tenant_plan END, updated_at = now() WHERE id = office;
  UPDATE public.billing_webhook_events SET tenant_id = office, processing_status = 'processed',
    processed_at = now(), error_message = NULL WHERE id = receipt;
  RETURN 'processed';
END;
$$;
REVOKE ALL ON FUNCTION public.apply_kirvano_event(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_kirvano_event(jsonb) TO service_role;
