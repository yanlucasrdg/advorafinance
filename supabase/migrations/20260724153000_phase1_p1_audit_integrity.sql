-- Phase 1 / P1: make financial audit records append-only from trusted database code.
-- Financial entries are already logged by SECURITY DEFINER triggers/functions.
-- Browser clients only need to read the resulting tenant-scoped audit trail.

DROP POLICY IF EXISTS "tenant insert audit" ON public.financial_audit_log;
REVOKE INSERT ON public.financial_audit_log FROM authenticated;

-- RLS remains responsible for tenant scoping of reads via "tenant read audit".
-- service_role and database-owned SECURITY DEFINER routines retain their
-- existing ability to append audit events.
