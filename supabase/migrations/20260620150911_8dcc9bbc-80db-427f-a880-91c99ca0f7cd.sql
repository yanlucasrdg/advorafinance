CREATE TABLE public.whatsapp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  to_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_message_id TEXT,
  error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_logs_tenant ON public.whatsapp_logs(tenant_id, created_at DESC);
CREATE INDEX idx_whatsapp_logs_client ON public.whatsapp_logs(client_id);

GRANT SELECT, INSERT, UPDATE ON public.whatsapp_logs TO authenticated;
GRANT ALL ON public.whatsapp_logs TO service_role;

ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read whatsapp_logs"
  ON public.whatsapp_logs FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant members insert whatsapp_logs"
  ON public.whatsapp_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND user_id = auth.uid());

CREATE POLICY "tenant members update whatsapp_logs"
  ON public.whatsapp_logs FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TRIGGER trg_whatsapp_logs_updated
  BEFORE UPDATE ON public.whatsapp_logs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();