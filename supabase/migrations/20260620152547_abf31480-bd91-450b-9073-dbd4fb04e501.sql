
-- WhatsApp instances per tenant
CREATE TABLE public.whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  external_instance_id TEXT,
  phone_number TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connecting','connected','error')),
  qr_code TEXT,
  last_connected_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_instances TO authenticated;
GRANT ALL ON public.whatsapp_instances TO service_role;
ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant select instances" ON public.whatsapp_instances FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant insert instances" ON public.whatsapp_instances FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND user_id = auth.uid());
CREATE POLICY "tenant update instances" ON public.whatsapp_instances FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant delete instances" ON public.whatsapp_instances FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE TRIGGER trg_wi_updated BEFORE UPDATE ON public.whatsapp_instances FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Conversations
CREATE TABLE public.whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  contact_avatar TEXT,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instance_id, contact_phone)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_conversations TO authenticated;
GRANT ALL ON public.whatsapp_conversations TO service_role;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant rw conversations" ON public.whatsapp_conversations FOR ALL TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER trg_wc_updated BEFORE UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Messages
CREATE TABLE public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  external_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant rw messages" ON public.whatsapp_messages FOR ALL TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX idx_wc_instance ON public.whatsapp_conversations(instance_id, last_message_at DESC);
CREATE INDEX idx_wm_conversation ON public.whatsapp_messages(conversation_id, created_at);
