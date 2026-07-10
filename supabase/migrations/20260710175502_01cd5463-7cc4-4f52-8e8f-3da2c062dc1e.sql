
-- 1) Extend financial_entries
ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS paid_amount_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'previsto',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.financial_entries
  DROP CONSTRAINT IF EXISTS financial_entries_settlement_status_check;
ALTER TABLE public.financial_entries
  ADD CONSTRAINT financial_entries_settlement_status_check
  CHECK (settlement_status IN ('previsto','confirmado','conciliado'));

-- 2) Partial payments table
CREATE TABLE IF NOT EXISTS public.financial_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.financial_entries(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  method text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_payments_entry ON public.financial_payments(entry_id);
CREATE INDEX IF NOT EXISTS idx_fin_payments_tenant ON public.financial_payments(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_payments TO authenticated;
GRANT ALL ON public.financial_payments TO service_role;
ALTER TABLE public.financial_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant rw fin_payments" ON public.financial_payments
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TRIGGER trg_fin_payments_updated
  BEFORE UPDATE ON public.financial_payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Audit log
CREATE TABLE IF NOT EXISTS public.financial_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES public.financial_entries(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.financial_payments(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_audit_entry ON public.financial_audit_log(entry_id);
CREATE INDEX IF NOT EXISTS idx_fin_audit_tenant_created ON public.financial_audit_log(tenant_id, created_at DESC);

GRANT SELECT, INSERT ON public.financial_audit_log TO authenticated;
GRANT ALL ON public.financial_audit_log TO service_role;
ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read audit" ON public.financial_audit_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant insert audit" ON public.financial_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

-- 4) Trigger: apply partial payment to parent entry
CREATE OR REPLACE FUNCTION public.apply_financial_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_amount bigint;
  v_new_paid bigint;
  v_new_status text;
  v_new_settle text;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT amount_cents, COALESCE(paid_amount_cents,0)
      INTO v_amount, v_new_paid
      FROM public.financial_entries WHERE id = NEW.entry_id FOR UPDATE;

    v_new_paid := v_new_paid + NEW.amount_cents;
    IF v_new_paid >= v_amount THEN
      v_new_status := 'pago';
      v_new_settle := 'confirmado';
    ELSE
      v_new_status := 'pendente';
      v_new_settle := 'confirmado';
    END IF;

    SELECT to_jsonb(fe.*) INTO v_old FROM public.financial_entries fe WHERE id = NEW.entry_id;

    UPDATE public.financial_entries
      SET paid_amount_cents = v_new_paid,
          status = v_new_status,
          settlement_status = v_new_settle,
          paid_at = CASE WHEN v_new_paid >= v_amount THEN NEW.paid_at ELSE paid_at END,
          payment_method = COALESCE(NEW.method, payment_method)
      WHERE id = NEW.entry_id;

    SELECT to_jsonb(fe.*) INTO v_new FROM public.financial_entries fe WHERE id = NEW.entry_id;

    INSERT INTO public.financial_audit_log (tenant_id, entry_id, payment_id, action, actor_id, before, after)
    VALUES (NEW.tenant_id, NEW.entry_id, NEW.id, 'partial_payment', NEW.created_by, v_old, v_new);
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_fin_payment ON public.financial_payments;
CREATE TRIGGER trg_apply_fin_payment
  AFTER INSERT ON public.financial_payments
  FOR EACH ROW EXECUTE FUNCTION public.apply_financial_payment();

REVOKE EXECUTE ON FUNCTION public.apply_financial_payment() FROM PUBLIC, anon;

-- 5) Reconcile helper: marks entry as conciliado and logs
CREATE OR REPLACE FUNCTION public.reconcile_financial_entry(_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old jsonb; v_new jsonb; v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.financial_entries WHERE id = _entry_id;
  IF v_tenant IS NULL OR v_tenant <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT to_jsonb(fe.*) INTO v_old FROM public.financial_entries fe WHERE id = _entry_id;
  UPDATE public.financial_entries
    SET settlement_status = 'conciliado',
        reconciled_at = now(),
        reconciled_by = auth.uid()
    WHERE id = _entry_id;
  SELECT to_jsonb(fe.*) INTO v_new FROM public.financial_entries fe WHERE id = _entry_id;
  INSERT INTO public.financial_audit_log (tenant_id, entry_id, action, actor_id, before, after)
  VALUES (v_tenant, _entry_id, 'reconcile', auth.uid(), v_old, v_new);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reconcile_financial_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_financial_entry(uuid) TO authenticated;

-- 6) Backfill existing paid entries
UPDATE public.financial_entries
  SET paid_amount_cents = amount_cents,
      settlement_status = 'confirmado'
  WHERE status = 'pago' AND paid_amount_cents = 0;
