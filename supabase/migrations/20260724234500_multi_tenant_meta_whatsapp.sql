-- Multi-tenant WhatsApp Business connections.
-- One office owns one active Meta connection. Access tokens are written only by
-- trusted Worker code and are never readable by browser roles.

CREATE TABLE IF NOT EXISTS public.whatsapp_meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL UNIQUE REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  business_account_id text NOT NULL,
  phone_number_id text NOT NULL UNIQUE,
  access_token_ciphertext text NOT NULL,
  access_token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('pending', 'connected', 'error', 'disconnected')),
  connected_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_meta_connections_tenant_instance_unique UNIQUE (tenant_id, instance_id),
  CONSTRAINT whatsapp_meta_connections_one_active_connection_per_tenant UNIQUE (tenant_id)
);

ALTER TABLE public.whatsapp_meta_connections ENABLE ROW LEVEL SECURITY;

-- Credentials must never be exposed through the authenticated/browser role.
REVOKE ALL ON public.whatsapp_meta_connections FROM anon, authenticated;
GRANT ALL ON public.whatsapp_meta_connections TO service_role;

CREATE INDEX IF NOT EXISTS whatsapp_meta_connections_tenant_id_idx
  ON public.whatsapp_meta_connections (tenant_id);

DROP TRIGGER IF EXISTS trg_wmc_updated ON public.whatsapp_meta_connections;
CREATE TRIGGER trg_wmc_updated
  BEFORE UPDATE ON public.whatsapp_meta_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.whatsapp_meta_connections IS
  'Private per-tenant Meta WhatsApp credentials. Browser roles have no access.';
