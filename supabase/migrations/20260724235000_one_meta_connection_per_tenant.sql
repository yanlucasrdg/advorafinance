-- The product currently supports one WhatsApp Business number per office.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_meta_connections_one_active_connection_per_tenant_idx
  ON public.whatsapp_meta_connections (tenant_id);
