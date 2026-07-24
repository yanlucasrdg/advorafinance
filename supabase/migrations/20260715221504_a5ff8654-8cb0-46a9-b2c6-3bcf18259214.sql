
-- 1) DRE settings (per tenant)
CREATE TABLE IF NOT EXISTS public.dre_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  apply_cogs boolean NOT NULL DEFAULT true,
  enabled_categories text[] NOT NULL DEFAULT ARRAY[
    'receita_servico','receita_outra','imposto','cogs',
    'despesa_operacional','despesa_administrativa','despesa_financeira'
  ],
  category_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dre_settings TO authenticated;
GRANT ALL ON public.dre_settings TO service_role;
ALTER TABLE public.dre_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dre_settings tenant read" ON public.dre_settings;
CREATE POLICY "dre_settings tenant read" ON public.dre_settings
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "dre_settings tenant write" ON public.dre_settings;
CREATE POLICY "dre_settings tenant write" ON public.dre_settings
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE OR REPLACE FUNCTION public.touch_dre_settings()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_touch_dre_settings ON public.dre_settings;
CREATE TRIGGER trg_touch_dre_settings BEFORE UPDATE ON public.dre_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_dre_settings();

-- 2) Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES public.financial_entries(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_tenant_created_idx
  ON public.notifications (tenant_id, created_at DESC);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications read" ON public.notifications;
CREATE POLICY "notifications read" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (user_id IS NULL OR user_id = auth.uid())
  );
DROP POLICY IF EXISTS "notifications update" ON public.notifications;
CREATE POLICY "notifications update" ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (user_id IS NULL OR user_id = auth.uid())
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

-- 3) Trigger: emit notification when settlement_status changes to confirmado / conciliado
CREATE OR REPLACE FUNCTION public.notify_financial_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.settlement_status IS DISTINCT FROM OLD.settlement_status
     AND NEW.settlement_status IN ('confirmado','conciliado') THEN
    INSERT INTO public.notifications (tenant_id, entry_id, kind, title, body)
    VALUES (
      NEW.tenant_id,
      NEW.id,
      'financial_' || NEW.settlement_status,
      CASE NEW.settlement_status
        WHEN 'confirmado' THEN 'Lançamento confirmado'
        WHEN 'conciliado' THEN 'Lançamento conciliado'
        ELSE 'Atualização financeira'
      END,
      COALESCE(NEW.description,'') ||
        ' • R$ ' || to_char(COALESCE(NEW.paid_amount_cents, NEW.amount_cents)/100.0, 'FM999G999G990D00')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_financial_status ON public.financial_entries;
CREATE TRIGGER trg_notify_financial_status
AFTER UPDATE OF settlement_status ON public.financial_entries
FOR EACH ROW EXECUTE FUNCTION public.notify_financial_status_change();
