-- Private tenant-to-session mapping for the self-hosted WAHA provider.
-- The WAHA API key and webhook secret remain Worker secrets and are never
-- stored in a browser-readable table.

CREATE TABLE IF NOT EXISTS public.whatsapp_waha_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL UNIQUE REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  session_name text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'connecting'
    CHECK (status IN ('disconnected', 'connecting', 'connected', 'error')),
  connected_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_waha_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_waha_connections FROM anon, authenticated;
GRANT ALL ON public.whatsapp_waha_connections TO service_role;

CREATE INDEX IF NOT EXISTS whatsapp_waha_connections_tenant_id_idx
  ON public.whatsapp_waha_connections (tenant_id);

DROP TRIGGER IF EXISTS trg_wwc_updated ON public.whatsapp_waha_connections;
CREATE TRIGGER trg_wwc_updated
  BEFORE UPDATE ON public.whatsapp_waha_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.whatsapp_waha_connections IS
  'Private per-tenant WAHA session mapping. WAHA credentials live only in Worker secrets.';
