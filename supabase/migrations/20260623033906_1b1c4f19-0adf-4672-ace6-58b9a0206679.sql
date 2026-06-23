
-- Add DataJud-related columns to cases
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS tribunal text,
  ADD COLUMN IF NOT EXISTS instance text,
  ADD COLUMN IF NOT EXISTS class_name text,
  ADD COLUMN IF NOT EXISTS subjects jsonb,
  ADD COLUMN IF NOT EXISTS parties jsonb,
  ADD COLUMN IF NOT EXISTS distribution_date timestamptz,
  ADD COLUMN IF NOT EXISTS last_movement_at timestamptz,
  ADD COLUMN IF NOT EXISTS datajud_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS cases_number_idx ON public.cases (tenant_id, number);

-- Movements timeline
CREATE TABLE IF NOT EXISTS public.case_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  code text,
  name text NOT NULL,
  complement text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_movements TO authenticated;
GRANT ALL ON public.case_movements TO service_role;

ALTER TABLE public.case_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read movements" ON public.case_movements
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant write movements" ON public.case_movements
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant update movements" ON public.case_movements
  FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant delete movements" ON public.case_movements
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS case_movements_case_idx ON public.case_movements (case_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS case_movements_unique ON public.case_movements (case_id, occurred_at, COALESCE(code, ''), name);
