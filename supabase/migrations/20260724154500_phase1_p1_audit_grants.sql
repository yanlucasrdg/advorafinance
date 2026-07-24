-- Phase 1 / P1 follow-up: remove legacy table-level grants from browser users.
-- Keep only the read permission required by the finance UI; tenant isolation is
-- still enforced by the existing "tenant read audit" RLS policy.

REVOKE ALL PRIVILEGES ON public.financial_audit_log FROM authenticated;
GRANT SELECT ON public.financial_audit_log TO authenticated;
