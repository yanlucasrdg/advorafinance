-- Financial ledger P0: tenant-safe entries, authorized reconciliation,
-- append-only payment reversals and cash metrics based on actual movements.

-- Compatibility bootstrap: some deployed databases predate the enterprise
-- security/timezone migrations. Keep this migration runnable on those schemas
-- without requiring unrelated tables such as documents or deadline_audit_log.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

CREATE OR REPLACE FUNCTION public.tenant_timezone()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT tenant.timezone
     FROM public.tenants tenant
     WHERE tenant.id = public.current_tenant_id()),
    'America/Sao_Paulo'
  )
$$;

CREATE OR REPLACE FUNCTION public.tz_today()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE public.tenant_timezone())::date
$$;

CREATE OR REPLACE FUNCTION public.financial_has_any_tenant_role(_roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_master_admin(auth.uid()) OR EXISTS (
    SELECT 1
    FROM public.user_roles tenant_role
    WHERE tenant_role.user_id = auth.uid()
      AND tenant_role.tenant_id = public.current_tenant_id()
      AND tenant_role.role = ANY(_roles)
  )
$$;

CREATE OR REPLACE FUNCTION public.financial_tenant_has_subscription_access(_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed boolean;
BEGIN
  IF _tenant_id IS NULL OR (
    _tenant_id IS DISTINCT FROM public.current_tenant_id()
    AND NOT public.is_master_admin(auth.uid())
  ) THEN
    RETURN false;
  END IF;

  -- Legacy installations store only tenants.plan and have no subscription
  -- ledger yet. Existing tenant membership remains the access authority there.
  IF to_regclass('public.tenant_subscriptions') IS NULL THEN
    RETURN EXISTS (SELECT 1 FROM public.tenants tenant WHERE tenant.id = _tenant_id);
  END IF;

  BEGIN
    EXECUTE $query$
      SELECT COALESCE(EXISTS (
        SELECT 1
        FROM public.tenant_subscriptions subscription
        WHERE subscription.tenant_id = $1
          AND (
            subscription.status::text = 'active'
            OR (subscription.status::text = 'trialing' AND subscription.trial_ends_at > now())
            OR (subscription.status::text = 'canceled' AND subscription.current_period_end > now())
            OR (subscription.status::text = 'past_due' AND subscription.grace_ends_at > now())
          )
      ), false)
    $query$ INTO v_allowed USING _tenant_id;
  EXCEPTION
    WHEN undefined_table OR undefined_column THEN
      RETURN EXISTS (SELECT 1 FROM public.tenants tenant WHERE tenant.id = _tenant_id);
  END;

  RETURN v_allowed;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_timezone(), public.tz_today(),
  public.financial_has_any_tenant_role(public.app_role[]),
  public.financial_tenant_has_subscription_access(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_timezone(), public.tz_today(),
  public.financial_has_any_tenant_role(public.app_role[]),
  public.financial_tenant_has_subscription_access(uuid)
  TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.financial_payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.financial_payments(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
  reversed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_payment_reversals_payment_idx
  ON public.financial_payment_reversals (payment_id, reversed_at DESC);
CREATE INDEX IF NOT EXISTS financial_payment_reversals_tenant_date_idx
  ON public.financial_payment_reversals (tenant_id, reversed_at DESC);

ALTER TABLE public.financial_payment_reversals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rbac read financial payment reversals" ON public.financial_payment_reversals;
CREATE POLICY "rbac read financial payment reversals"
  ON public.financial_payment_reversals FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.financial_has_any_tenant_role(ARRAY['owner', 'admin']::public.app_role[])
  );

REVOKE ALL ON public.financial_payment_reversals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_payment_reversals TO authenticated;
GRANT ALL ON public.financial_payment_reversals TO service_role;

-- The legacy database granted direct audit writes and mutable payments. Make
-- both ledgers append-only before installing the trusted trigger path.
ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant insert audit" ON public.financial_audit_log;
DROP POLICY IF EXISTS "tenant read audit" ON public.financial_audit_log;
DROP POLICY IF EXISTS "rbac read financial audit" ON public.financial_audit_log;
CREATE POLICY "rbac read financial audit"
  ON public.financial_audit_log FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.financial_has_any_tenant_role(ARRAY['owner', 'admin']::public.app_role[])
  );
REVOKE ALL ON public.financial_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_audit_log TO authenticated;
GRANT ALL ON public.financial_audit_log TO service_role;

ALTER TABLE public.financial_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant rw fin_payments" ON public.financial_payments;
DROP POLICY IF EXISTS "rbac read financial payments" ON public.financial_payments;
DROP POLICY IF EXISTS "rbac insert financial payments" ON public.financial_payments;
CREATE POLICY "rbac read financial payments"
  ON public.financial_payments FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.financial_has_any_tenant_role(ARRAY['owner', 'admin']::public.app_role[])
  );
CREATE POLICY "rbac insert financial payments"
  ON public.financial_payments FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.financial_has_any_tenant_role(ARRAY['owner', 'admin']::public.app_role[])
  );
REVOKE UPDATE, DELETE ON public.financial_payments FROM authenticated;

CREATE OR REPLACE FUNCTION public.normalize_financial_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_entry public.financial_entries%ROWTYPE;
  v_remaining bigint;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'FINANCIAL_AUTH_REQUIRED'; END IF;
  IF NOT public.financial_has_any_tenant_role(ARRAY['owner', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'ROLE_ACCESS_DENIED';
  END IF;
  IF NOT public.financial_tenant_has_subscription_access(v_tenant_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ACCESS_DENIED';
  END IF;

  SELECT * INTO v_entry
  FROM public.financial_entries
  WHERE id = NEW.entry_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_NOT_FOUND'; END IF;
  IF v_entry.status = 'cancelado' THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_CANCELLED'; END IF;
  IF v_entry.settlement_status = 'conciliado' THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_RECONCILED'; END IF;

  v_remaining := v_entry.amount_cents - COALESCE(v_entry.paid_amount_cents, 0);
  IF NEW.amount_cents <= 0 OR NEW.amount_cents > v_remaining THEN
    RAISE EXCEPTION 'FINANCIAL_PAYMENT_AMOUNT_INVALID';
  END IF;

  NEW.tenant_id := v_tenant_id;
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
  v_before jsonb;
BEGIN
  SELECT * INTO v_entry
  FROM public.financial_entries
  WHERE id = NEW.entry_id AND tenant_id = NEW.tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_TENANT_MISMATCH'; END IF;

  v_before := to_jsonb(v_entry);
  v_new_paid := COALESCE(v_entry.paid_amount_cents, 0) + NEW.amount_cents;
  IF v_new_paid > v_entry.amount_cents THEN RAISE EXCEPTION 'FINANCIAL_PAYMENT_AMOUNT_INVALID'; END IF;

  UPDATE public.financial_entries
  SET paid_amount_cents = v_new_paid,
      status = CASE WHEN v_new_paid = amount_cents THEN 'pago' ELSE 'pendente' END,
      settlement_status = 'confirmado',
      paid_at = CASE WHEN v_new_paid = amount_cents THEN NEW.paid_at ELSE paid_at END,
      payment_method = COALESCE(NEW.method, payment_method)
  WHERE id = NEW.entry_id AND tenant_id = NEW.tenant_id
  RETURNING * INTO v_entry;

  INSERT INTO public.financial_audit_log (
    tenant_id, entry_id, payment_id, action, actor_id, before, after
  ) VALUES (
    NEW.tenant_id, NEW.entry_id, NEW.id, 'partial_payment', NEW.created_by,
    v_before, to_jsonb(v_entry)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_fin_payment ON public.financial_payments;
CREATE TRIGGER trg_apply_fin_payment
  AFTER INSERT ON public.financial_payments
  FOR EACH ROW EXECUTE FUNCTION public.apply_financial_payment();

REVOKE ALL ON FUNCTION public.normalize_financial_payment(), public.apply_financial_payment()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_financial_payment(), public.apply_financial_payment()
  TO service_role;

CREATE OR REPLACE FUNCTION public.normalize_financial_entry_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_case_client_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF v_tenant_id IS NULL OR NEW.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'TENANT_ACCESS_DENIED';
  END IF;
  IF NOT public.financial_has_any_tenant_role(ARRAY['owner', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'ROLE_ACCESS_DENIED';
  END IF;
  IF NOT public.financial_tenant_has_subscription_access(v_tenant_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ACCESS_DENIED';
  END IF;
  IF NEW.kind NOT IN ('receita', 'despesa') OR NEW.amount_cents <= 0 THEN
    RAISE EXCEPTION 'FINANCIAL_ENTRY_INVALID';
  END IF;

  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients client
    WHERE client.id = NEW.client_id
      AND client.tenant_id = v_tenant_id
      AND client.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'FINANCIAL_CLIENT_NOT_FOUND';
  END IF;

  IF NEW.case_id IS NOT NULL THEN
    SELECT legal_case.client_id INTO v_case_client_id
    FROM public.cases legal_case
    WHERE legal_case.id = NEW.case_id
      AND legal_case.tenant_id = v_tenant_id
      AND legal_case.deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_CASE_NOT_FOUND'; END IF;
    IF NEW.client_id IS NULL THEN NEW.client_id := v_case_client_id; END IF;
    IF v_case_client_id IS NOT NULL AND NEW.client_id <> v_case_client_id THEN
      RAISE EXCEPTION 'FINANCIAL_CASE_CLIENT_MISMATCH';
    END IF;
  END IF;

  -- Settlement fields are controlled exclusively by payment/reconciliation RPCs.
  NEW.status := 'pendente';
  NEW.paid_amount_cents := 0;
  NEW.paid_at := NULL;
  NEW.payment_method := NULL;
  NEW.settlement_status := 'previsto';
  NEW.reconciled_at := NULL;
  NEW.reconciled_by := NULL;
  NEW.deleted_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_financial_entry_integrity ON public.financial_entries;
CREATE TRIGGER trg_financial_entry_integrity
  BEFORE INSERT ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION public.normalize_financial_entry_insert();

REVOKE UPDATE, DELETE ON public.financial_entries FROM authenticated;
REVOKE ALL ON FUNCTION public.normalize_financial_entry_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_financial_entry_insert() TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_financial_entry(_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_entry public.financial_entries%ROWTYPE;
  v_before jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'FINANCIAL_AUTH_REQUIRED'; END IF;
  IF NOT public.financial_has_any_tenant_role(ARRAY['owner', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'ROLE_ACCESS_DENIED';
  END IF;
  IF NOT public.financial_tenant_has_subscription_access(v_tenant_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ACCESS_DENIED';
  END IF;

  SELECT * INTO v_entry
  FROM public.financial_entries
  WHERE id = _entry_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_NOT_FOUND'; END IF;
  IF v_entry.status = 'cancelado' THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_CANCELLED'; END IF;
  IF v_entry.status <> 'pago' OR COALESCE(v_entry.paid_amount_cents, 0) <> v_entry.amount_cents THEN
    RAISE EXCEPTION 'FINANCIAL_ENTRY_NOT_FULLY_PAID';
  END IF;
  IF v_entry.settlement_status = 'conciliado' THEN RETURN; END IF;

  v_before := to_jsonb(v_entry);
  UPDATE public.financial_entries
  SET settlement_status = 'conciliado', reconciled_at = now(), reconciled_by = auth.uid()
  WHERE id = _entry_id AND tenant_id = v_tenant_id;

  INSERT INTO public.financial_audit_log (
    tenant_id, entry_id, action, actor_id, before, after
  )
  SELECT v_tenant_id, _entry_id, 'reconciled', auth.uid(), v_before, to_jsonb(entry_after)
  FROM public.financial_entries entry_after
  WHERE entry_after.id = _entry_id AND entry_after.tenant_id = v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_financial_entry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_financial_entry(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_financial_payment(
  p_payment_id uuid,
  p_reason text,
  p_amount_cents bigint DEFAULT NULL
)
RETURNS public.financial_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_payment public.financial_payments%ROWTYPE;
  v_entry public.financial_entries%ROWTYPE;
  v_already_reversed bigint;
  v_reversal_amount bigint;
  v_new_paid bigint;
  v_reversal_id uuid;
  v_before jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'FINANCIAL_AUTH_REQUIRED'; END IF;
  IF NOT public.financial_has_any_tenant_role(ARRAY['owner', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'ROLE_ACCESS_DENIED';
  END IF;
  IF NOT public.financial_tenant_has_subscription_access(v_tenant_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ACCESS_DENIED';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'FINANCIAL_REVERSAL_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_payment
  FROM public.financial_payments
  WHERE id = p_payment_id AND tenant_id = v_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_PAYMENT_NOT_FOUND'; END IF;

  SELECT * INTO v_entry
  FROM public.financial_entries
  WHERE id = v_payment.entry_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_NOT_FOUND'; END IF;
  IF v_entry.settlement_status = 'conciliado' THEN
    RAISE EXCEPTION 'FINANCIAL_ENTRY_RECONCILED';
  END IF;

  SELECT COALESCE(SUM(reversal.amount_cents), 0)
  INTO v_already_reversed
  FROM public.financial_payment_reversals reversal
  WHERE reversal.payment_id = v_payment.id AND reversal.tenant_id = v_tenant_id;

  v_reversal_amount := COALESCE(p_amount_cents, v_payment.amount_cents - v_already_reversed);
  IF v_reversal_amount <= 0 OR v_reversal_amount > v_payment.amount_cents - v_already_reversed THEN
    RAISE EXCEPTION 'FINANCIAL_REVERSAL_AMOUNT_INVALID';
  END IF;
  IF v_reversal_amount > COALESCE(v_entry.paid_amount_cents, 0) THEN
    RAISE EXCEPTION 'FINANCIAL_REVERSAL_EXCEEDS_ENTRY_PAID';
  END IF;

  v_before := to_jsonb(v_entry);
  INSERT INTO public.financial_payment_reversals (
    tenant_id, payment_id, amount_cents, reason, created_by
  ) VALUES (
    v_tenant_id, v_payment.id, v_reversal_amount, btrim(p_reason), auth.uid()
  ) RETURNING id INTO v_reversal_id;

  v_new_paid := COALESCE(v_entry.paid_amount_cents, 0) - v_reversal_amount;
  UPDATE public.financial_entries
  SET paid_amount_cents = v_new_paid,
      status = CASE WHEN v_new_paid = amount_cents THEN 'pago' ELSE 'pendente' END,
      settlement_status = CASE WHEN v_new_paid > 0 THEN 'confirmado' ELSE 'previsto' END,
      paid_at = CASE WHEN v_new_paid = amount_cents THEN paid_at ELSE NULL END,
      reconciled_at = NULL,
      reconciled_by = NULL
  WHERE id = v_entry.id AND tenant_id = v_tenant_id
  RETURNING * INTO v_entry;

  INSERT INTO public.financial_audit_log (
    tenant_id, entry_id, payment_id, action, actor_id, before, after
  ) VALUES (
    v_tenant_id,
    v_entry.id,
    v_payment.id,
    'payment_reversed',
    auth.uid(),
    v_before,
    to_jsonb(v_entry) || jsonb_build_object(
      'reversal_id', v_reversal_id,
      'reversal_amount_cents', v_reversal_amount,
      'reversal_reason', btrim(p_reason)
    )
  );
  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_financial_payment(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_financial_payment(uuid, text, bigint) TO authenticated;

DROP FUNCTION IF EXISTS public.metrics_financeiro(date, date);

CREATE OR REPLACE FUNCTION public.metrics_financeiro(
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _client_id uuid DEFAULT NULL,
  _area text DEFAULT NULL,
  _responsible text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone text := public.tenant_timezone();
  today date := public.tz_today();
  month_start date := date_trunc('month', today)::date;
  year_start date := date_trunc('year', today)::date;
  twelve_ago date := (date_trunc('month', today) - interval '11 months')::date;
  period_from date := COALESCE(_from, month_start);
  period_to date := COALESCE(_to, today);
  period_days integer;
  previous_from date;
  previous_to date;
  rev_period bigint := 0; rev_previous bigint := 0; rev_year bigint := 0; rev_12 bigint := 0;
  exp_period bigint := 0; exp_year bigint := 0;
  open_recv bigint := 0; over_recv bigint := 0;
  open_pay bigint := 0; over_pay bigint := 0;
  paid_count bigint := 0;
  series jsonb;
BEGIN
  IF period_to < period_from THEN RAISE EXCEPTION 'FINANCIAL_PERIOD_INVALID'; END IF;
  period_days := period_to - period_from + 1;
  previous_to := period_from - 1;
  previous_from := period_from - period_days;

  WITH scoped_entries AS (
    SELECT entry.*
    FROM public.financial_entries entry
    LEFT JOIN public.cases legal_case
      ON legal_case.id = entry.case_id AND legal_case.tenant_id = entry.tenant_id
    WHERE entry.tenant_id = public.current_tenant_id()
      AND entry.deleted_at IS NULL
      AND entry.status <> 'cancelado'
      AND (_client_id IS NULL OR entry.client_id = _client_id)
      AND (_area IS NULL OR legal_case.area = _area)
      AND (_responsible IS NULL OR legal_case.responsible::text = _responsible)
  ), cash_movements AS (
    SELECT payment.entry_id, payment.method, payment.paid_at AS occurred_at,
      payment.amount_cents AS amount_cents
    FROM public.financial_payments payment
    JOIN scoped_entries entry ON entry.id = payment.entry_id AND entry.tenant_id = payment.tenant_id
    WHERE payment.tenant_id = public.current_tenant_id()
    UNION ALL
    SELECT payment.entry_id, payment.method, reversal.reversed_at AS occurred_at,
      -reversal.amount_cents AS amount_cents
    FROM public.financial_payment_reversals reversal
    JOIN public.financial_payments payment
      ON payment.id = reversal.payment_id AND payment.tenant_id = reversal.tenant_id
    JOIN scoped_entries entry ON entry.id = payment.entry_id AND entry.tenant_id = payment.tenant_id
    WHERE reversal.tenant_id = public.current_tenant_id()
  ), classified_movements AS (
    SELECT movement.*, entry.kind,
      (movement.occurred_at AT TIME ZONE v_timezone)::date AS occurred_on
    FROM cash_movements movement
    JOIN scoped_entries entry ON entry.id = movement.entry_id
  )
  SELECT
    COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'receita' AND occurred_on BETWEEN period_from AND period_to), 0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'receita' AND occurred_on BETWEEN previous_from AND previous_to), 0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'receita' AND occurred_on BETWEEN year_start AND today), 0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'receita' AND occurred_on BETWEEN twelve_ago AND today), 0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'despesa' AND occurred_on BETWEEN period_from AND period_to), 0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'despesa' AND occurred_on BETWEEN year_start AND today), 0),
    COUNT(DISTINCT entry_id) FILTER (WHERE kind = 'receita' AND occurred_on BETWEEN year_start AND today)
  INTO rev_period, rev_previous, rev_year, rev_12, exp_period, exp_year, paid_count
  FROM classified_movements;

  SELECT
    COALESCE(SUM(GREATEST(entry.amount_cents - entry.paid_amount_cents, 0)) FILTER (WHERE entry.kind = 'receita'), 0),
    COALESCE(SUM(GREATEST(entry.amount_cents - entry.paid_amount_cents, 0)) FILTER (
      WHERE entry.kind = 'receita' AND entry.due_date < today
    ), 0),
    COALESCE(SUM(GREATEST(entry.amount_cents - entry.paid_amount_cents, 0)) FILTER (WHERE entry.kind = 'despesa'), 0),
    COALESCE(SUM(GREATEST(entry.amount_cents - entry.paid_amount_cents, 0)) FILTER (
      WHERE entry.kind = 'despesa' AND entry.due_date < today
    ), 0)
  INTO open_recv, over_recv, open_pay, over_pay
  FROM public.financial_entries entry
  LEFT JOIN public.cases legal_case
    ON legal_case.id = entry.case_id AND legal_case.tenant_id = entry.tenant_id
  WHERE entry.tenant_id = public.current_tenant_id()
    AND entry.deleted_at IS NULL
    AND entry.status <> 'cancelado'
    AND entry.paid_amount_cents < entry.amount_cents
    AND (_client_id IS NULL OR entry.client_id = _client_id)
    AND (_area IS NULL OR legal_case.area = _area)
    AND (_responsible IS NULL OR legal_case.responsible::text = _responsible);

  WITH scoped_entries AS (
    SELECT entry.*
    FROM public.financial_entries entry
    LEFT JOIN public.cases legal_case
      ON legal_case.id = entry.case_id AND legal_case.tenant_id = entry.tenant_id
    WHERE entry.tenant_id = public.current_tenant_id()
      AND entry.deleted_at IS NULL
      AND entry.status <> 'cancelado'
      AND (_client_id IS NULL OR entry.client_id = _client_id)
      AND (_area IS NULL OR legal_case.area = _area)
      AND (_responsible IS NULL OR legal_case.responsible::text = _responsible)
  ), cash_movements AS (
    SELECT payment.entry_id, payment.paid_at AS occurred_at, payment.amount_cents AS amount_cents
    FROM public.financial_payments payment
    JOIN scoped_entries entry ON entry.id = payment.entry_id AND entry.tenant_id = payment.tenant_id
    WHERE payment.tenant_id = public.current_tenant_id()
    UNION ALL
    SELECT payment.entry_id, reversal.reversed_at, -reversal.amount_cents
    FROM public.financial_payment_reversals reversal
    JOIN public.financial_payments payment
      ON payment.id = reversal.payment_id AND payment.tenant_id = reversal.tenant_id
    JOIN scoped_entries entry ON entry.id = payment.entry_id AND entry.tenant_id = payment.tenant_id
    WHERE reversal.tenant_id = public.current_tenant_id()
  )
  SELECT jsonb_agg(row_to_json(monthly) ORDER BY monthly.bucket)
  INTO series
  FROM (
    SELECT to_char(month_bucket, 'YYYY-MM') AS bucket,
      COALESCE(SUM(movement.amount_cents) FILTER (WHERE entry.kind = 'receita'), 0)::bigint AS receita,
      COALESCE(SUM(movement.amount_cents) FILTER (WHERE entry.kind = 'despesa'), 0)::bigint AS despesa
    FROM generate_series(twelve_ago::timestamp, month_start::timestamp, interval '1 month') month_bucket
    LEFT JOIN cash_movements movement
      ON date_trunc('month', movement.occurred_at AT TIME ZONE v_timezone) = month_bucket
    LEFT JOIN scoped_entries entry ON entry.id = movement.entry_id
    GROUP BY month_bucket
  ) monthly;

  RETURN jsonb_build_object(
    'rev_month', rev_period,
    'rev_prev', rev_previous,
    'rev_year', rev_year,
    'rev_12', rev_12,
    'exp_month', exp_period,
    'exp_year', exp_year,
    'open_receivable', open_recv,
    'overdue_receivable', over_recv,
    'open_payable', open_pay,
    'overdue_payable', over_pay,
    'delinquency_pct', CASE WHEN open_recv > 0 THEN (over_recv::numeric / open_recv) * 100 ELSE 0 END,
    'ticket_avg', CASE WHEN paid_count > 0 THEN rev_year / paid_count ELSE 0 END,
    'profit_month', rev_period - exp_period,
    'profit_year', rev_year - exp_year,
    'series', COALESCE(series, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.metrics_financeiro(date, date, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.metrics_financeiro(date, date, uuid, text, text) TO authenticated;
