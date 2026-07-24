
-- Restringe execuções
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_master_admin(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_in_tenant(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_in_tenant(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(TEXT, TEXT) TO authenticated;

-- Substitui INSERT aberto por regra que só permite quando o usuário ainda não tem tenant
DROP POLICY IF EXISTS "Authenticated can create tenant (onboarding)" ON public.tenants;
CREATE POLICY "Onboarding insert tenant" ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (public.current_tenant_id() IS NULL);

-- Search path em touch_updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
