-- ==============================================================
-- PHASE 1: ENTERPRISE FOUNDATIONS
-- Audit Logs & Documents (Storage)
-- ==============================================================

-- 1. AUDIT LOGS
-- Core table for LGPD compliance and tracking sensitive actions
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS for Audit Logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

-- Only master_admin or owner can read audit logs. Nobody can insert manually (done via triggers), update, or delete.
CREATE POLICY "owners read audit logs" ON public.audit_logs FOR SELECT TO authenticated 
  USING (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'owner'));

-- Generic Trigger Function for Auditing
CREATE OR REPLACE FUNCTION public.tf_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_old_data JSONB := NULL;
    v_new_data JSONB := NULL;
BEGIN
    -- Only capture authenticated actions (skip system internal actions if auth.uid() is null, unless needed)
    v_user_id := auth.uid();
    
    IF TG_OP = 'INSERT' THEN
        v_tenant_id := NEW.tenant_id;
        v_new_data := row_to_json(NEW)::jsonb;
    ELSIF TG_OP = 'UPDATE' THEN
        v_tenant_id := NEW.tenant_id;
        v_old_data := row_to_json(OLD)::jsonb;
        v_new_data := row_to_json(NEW)::jsonb;
    ELSIF TG_OP = 'DELETE' THEN
        v_tenant_id := OLD.tenant_id;
        v_old_data := row_to_json(OLD)::jsonb;
    END IF;

    -- Avoid logging if no tenant could be inferred
    IF v_tenant_id IS NOT NULL THEN
        INSERT INTO public.audit_logs (tenant_id, user_id, table_name, record_id, action, old_data, new_data)
        VALUES (
            v_tenant_id, 
            v_user_id, 
            TG_TABLE_NAME::text, 
            COALESCE(NEW.id, OLD.id), 
            TG_OP, 
            v_old_data, 
            v_new_data
        );
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Apply Audit Trigger to core tables
DROP TRIGGER IF EXISTS trg_audit_clients ON public.clients;
CREATE TRIGGER trg_audit_clients
    AFTER INSERT OR UPDATE OR DELETE ON public.clients
    FOR EACH ROW EXECUTE FUNCTION public.tf_audit_log();

DROP TRIGGER IF EXISTS trg_audit_cases ON public.cases;
CREATE TRIGGER trg_audit_cases
    AFTER INSERT OR UPDATE OR DELETE ON public.cases
    FOR EACH ROW EXECUTE FUNCTION public.tf_audit_log();

DROP TRIGGER IF EXISTS trg_audit_financial ON public.financial_entries;
CREATE TRIGGER trg_audit_financial
    AFTER INSERT OR UPDATE OR DELETE ON public.financial_entries
    FOR EACH ROW EXECUTE FUNCTION public.tf_audit_log();


-- 2. DOCUMENTS
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    file_type TEXT NOT NULL, -- e.g. 'application/pdf'
    document_type TEXT NOT NULL DEFAULT 'other', -- e.g. 'procuracao', 'contrato', 'sentenca'
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS for Documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;

CREATE POLICY "tenant read documents" ON public.documents FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "tenant insert documents" ON public.documents FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant update documents" ON public.documents FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "tenant delete documents" ON public.documents FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

CREATE TRIGGER trg_documents_updated BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Note: Storage Bucket creation
-- In Supabase, creating buckets programmatically requires inserting into storage.buckets
INSERT INTO storage.buckets (id, name, public) 
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for storage.objects (documents bucket)
CREATE POLICY "tenant access documents" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = current_tenant_id()::text);
CREATE POLICY "tenant insert documents" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = current_tenant_id()::text);
CREATE POLICY "tenant update documents" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = current_tenant_id()::text);
CREATE POLICY "tenant delete documents" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = current_tenant_id()::text);

