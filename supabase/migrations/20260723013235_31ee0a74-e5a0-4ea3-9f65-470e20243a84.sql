
-- 1) user_roles: prevent privilege escalation to master_admin
DROP POLICY IF EXISTS "Owners can manage tenant roles" ON public.user_roles;
CREATE POLICY "Owners manage tenant roles (no master_admin)"
ON public.user_roles FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'owner'))
WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'owner') AND role <> 'master_admin');

-- 2) financial_audit_log: require actor_id = auth.uid()
DROP POLICY IF EXISTS "tenant insert audit" ON public.financial_audit_log;
CREATE POLICY "tenant insert audit" ON public.financial_audit_log
FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND actor_id = auth.uid());

-- 3) Prevent owner/admin from updating tenants.plan
CREATE OR REPLACE FUNCTION public.prevent_plan_self_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Alteração de plano só pode ser feita pelo backend (service_role).';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_plan_self_update ON public.tenants;
CREATE TRIGGER trg_prevent_plan_self_update BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.prevent_plan_self_update();

-- 4) Isolate Z-API credentials per tenant
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS zapi_instance_id text,
  ADD COLUMN IF NOT EXISTS zapi_token text,
  ADD COLUMN IF NOT EXISTS zapi_client_token text;

REVOKE SELECT ON public.whatsapp_instances FROM authenticated;
GRANT SELECT (id, tenant_id, user_id, instance_name, external_instance_id, phone_number, status, qr_code, last_connected_at, metadata, created_at, updated_at)
  ON public.whatsapp_instances TO authenticated;
GRANT ALL ON public.whatsapp_instances TO service_role;
