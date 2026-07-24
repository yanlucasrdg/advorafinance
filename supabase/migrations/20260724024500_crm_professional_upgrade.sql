-- =============================================================
-- CRM JURÍDICO — Professional Upgrade
-- Adds dedicated columns to clients + client_activities table
-- =============================================================

-- 1. Add dedicated columns to clients (replaces JSON hacks in notes)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS area         TEXT,
  ADD COLUMN IF NOT EXISTS value_cents  BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner        TEXT,
  ADD COLUMN IF NOT EXISTS is_hot       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS address      TEXT,
  ADD COLUMN IF NOT EXISTS city         TEXT,
  ADD COLUMN IF NOT EXISTS state        TEXT;

-- 2. Migrate existing data from notes JSON into dedicated columns
UPDATE public.clients
SET
  area        = COALESCE(area,        (notes::jsonb)->>'area'),
  value_cents = COALESCE(value_cents, (((notes::jsonb)->>'value')::numeric * 100)::bigint),
  owner       = COALESCE(owner,       (notes::jsonb)->>'owner'),
  is_hot      = COALESCE(is_hot,      ((notes::jsonb)->>'hot')::boolean)
WHERE notes IS NOT NULL
  AND notes ~ '^\s*\{';  -- only update rows that have valid JSON in notes

-- 3. Create client_activities table for real interaction history
CREATE TABLE IF NOT EXISTS public.client_activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'note',  -- note | call | email | meeting | stage_change | document
  title       TEXT NOT NULL,
  body        TEXT,
  meta        JSONB,                         -- e.g. { old_stage: 'novo_contato', new_stage: 'triagem' }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_activities TO authenticated;
GRANT ALL ON public.client_activities TO service_role;
ALTER TABLE public.client_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read activities" ON public.client_activities
  FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "tenant insert activities" ON public.client_activities
  FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant update activities" ON public.client_activities
  FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "tenant delete activities" ON public.client_activities
  FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_client_activities_client
  ON public.client_activities (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_activities_tenant
  ON public.client_activities (tenant_id, created_at DESC);
