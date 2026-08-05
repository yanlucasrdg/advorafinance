-- Restore the audit dependency expected by the resilient deadlines migration.
-- Some production databases skipped the earlier audit migration, so this file
-- intentionally remains idempotent and safe to run before it.

CREATE TABLE IF NOT EXISTS public.deadline_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deadline_id uuid NOT NULL REFERENCES public.deadlines(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deadline_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deadline_audit_log_tenant_read" ON public.deadline_audit_log;
CREATE POLICY "deadline_audit_log_tenant_read"
  ON public.deadline_audit_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_deadline_audit_deadline
  ON public.deadline_audit_log (deadline_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deadline_audit_tenant
  ON public.deadline_audit_log (tenant_id, created_at DESC);

GRANT SELECT ON public.deadline_audit_log TO authenticated;
GRANT ALL ON public.deadline_audit_log TO service_role;
