-- Repair environments where move_client_stage() was installed before the
-- client activity audit table. The RPC intentionally keeps the stage change
-- and its audit record in the same transaction.

CREATE TABLE IF NOT EXISTS public.client_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'note',
  title text NOT NULL,
  body text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_activities TO authenticated;
GRANT ALL ON public.client_activities TO service_role;

ALTER TABLE public.client_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read activities" ON public.client_activities;
CREATE POLICY "tenant read activities" ON public.client_activities
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "tenant insert activities" ON public.client_activities;
CREATE POLICY "tenant insert activities" ON public.client_activities
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "tenant update activities" ON public.client_activities;
CREATE POLICY "tenant update activities" ON public.client_activities
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "tenant delete activities" ON public.client_activities;
CREATE POLICY "tenant delete activities" ON public.client_activities
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_client_activities_client
  ON public.client_activities (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_activities_tenant
  ON public.client_activities (tenant_id, created_at DESC);
