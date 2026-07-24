-- Phase 1 / P0: protect tenant ownership and WhatsApp credentials.
-- This migration preserves existing tables and columns used by automations.

-- Profiles are created by the auth trigger and linked to a tenant exclusively by
-- create_tenant_with_owner(), both SECURITY DEFINER functions. Browser clients
-- may only edit their own presentation fields.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile fields" ON public.profiles;

REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, phone) ON public.profiles TO authenticated;

CREATE POLICY "Users can update own profile fields"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Keep Z-API credentials server-only. Column grants are used instead of
-- changing the table so direct Postgres/service-role automations remain intact.
REVOKE SELECT, INSERT, UPDATE ON public.whatsapp_instances FROM authenticated;

GRANT SELECT (
  id, tenant_id, user_id, instance_name, external_instance_id, phone_number,
  status, qr_code, last_connected_at, created_at, updated_at
) ON public.whatsapp_instances TO authenticated;

GRANT INSERT (
  tenant_id, user_id, instance_name, external_instance_id, phone_number,
  status, qr_code, last_connected_at
) ON public.whatsapp_instances TO authenticated;

GRANT UPDATE (
  instance_name, external_instance_id, phone_number, status, qr_code,
  last_connected_at
) ON public.whatsapp_instances TO authenticated;
