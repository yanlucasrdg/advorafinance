
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_in_tenant(uuid, uuid) TO authenticated;
