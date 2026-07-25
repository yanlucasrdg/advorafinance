-- =============================================================================
-- Migration: Auditoria Técnica 2026-07-25
-- Fase 3: Índices ausentes + Trigger LGPD em deadlines + Constraints críticas
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Índices ausentes identificados na auditoria
-- ─────────────────────────────────────────────────────────────────────────────

-- clients(phone): buscado na deduplicação de conversas WhatsApp
CREATE INDEX IF NOT EXISTS idx_clients_phone
  ON public.clients (tenant_id, phone)
  WHERE deleted_at IS NULL AND phone IS NOT NULL;

-- clients(doc): CPF/CNPJ usado em buscas de cadastro
CREATE INDEX IF NOT EXISTS idx_clients_doc
  ON public.clients (tenant_id, doc)
  WHERE deleted_at IS NULL AND doc IS NOT NULL;

-- clients(status): Kanban CRM filtra por status
CREATE INDEX IF NOT EXISTS idx_clients_status
  ON public.clients (tenant_id, status)
  WHERE deleted_at IS NULL;

-- deadlines(client_id): join da agenda de clientes
CREATE INDEX IF NOT EXISTS idx_deadlines_client
  ON public.deadlines (tenant_id, client_id, due_at)
  WHERE deleted_at IS NULL AND client_id IS NOT NULL;

-- deadlines(done, due_at): filtro de prazos abertos e vencidos
CREATE INDEX IF NOT EXISTS idx_deadlines_open
  ON public.deadlines (tenant_id, due_at)
  WHERE deleted_at IS NULL AND done = false;

-- financial_entries(client_id, due_date): relatórios financeiros por cliente
CREATE INDEX IF NOT EXISTS idx_fin_entries_client_due
  ON public.financial_entries (tenant_id, client_id, due_date)
  WHERE deleted_at IS NULL AND client_id IS NOT NULL;

-- financial_entries(status): filtros de status financeiro
CREATE INDEX IF NOT EXISTS idx_fin_entries_status
  ON public.financial_entries (tenant_id, status)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Colunas de audit trail LGPD em deadlines (quem/quando concluiu o prazo)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.deadlines
  ADD COLUMN IF NOT EXISTS completed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes         text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger de audit log para alterações de prazos processuais (LGPD)
-- Registra quem alterou, o quê foi alterado e quando, em tabela separada.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deadline_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deadline_id uuid NOT NULL REFERENCES public.deadlines(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text NOT NULL, -- 'created' | 'updated' | 'deleted' | 'completed' | 'reopened'
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS para deadline_audit_log
ALTER TABLE public.deadline_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deadline_audit_log_tenant_read" ON public.deadline_audit_log
  FOR SELECT USING (
    tenant_id = (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Índice para consulta eficiente do log de auditoria
CREATE INDEX IF NOT EXISTS idx_deadline_audit_deadline
  ON public.deadline_audit_log (deadline_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deadline_audit_tenant
  ON public.deadline_audit_log (tenant_id, created_at DESC);

-- Função do trigger
CREATE OR REPLACE FUNCTION public.fn_deadline_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_before jsonb := NULL;
  v_after  jsonb := NULL;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_action := 'created';
    v_after  := to_jsonb(NEW) - 'tenant_id'; -- não gravar tenant_id no log de diff
  ELSIF (TG_OP = 'DELETE') THEN
    v_action := 'deleted';
    v_before := to_jsonb(OLD) - 'tenant_id';
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Detectar conclusão/reabertura de prazo
    IF OLD.done = false AND NEW.done = true THEN
      v_action := 'completed';
    ELSIF OLD.done = true AND NEW.done = false THEN
      v_action := 'reopened';
    ELSE
      v_action := 'updated';
    END IF;
    -- Gravar apenas as diferenças (campos que mudaram)
    v_before := to_jsonb(OLD) - 'tenant_id' - 'updated_at';
    v_after  := to_jsonb(NEW) - 'tenant_id' - 'updated_at';
    -- Se nada mudou de relevante, não gravar
    IF v_before = v_after THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.deadline_audit_log (
    deadline_id, tenant_id, actor_id, action, before, after
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    auth.uid(), -- usuário autenticado via JWT
    v_action,
    v_before,
    v_after
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Aplica o trigger na tabela deadlines
DROP TRIGGER IF EXISTS trg_deadline_audit ON public.deadlines;
CREATE TRIGGER trg_deadline_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.deadlines
  FOR EACH ROW EXECUTE FUNCTION public.fn_deadline_audit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Constraint de integridade: financial_entries.amount_cents deve ser positivo
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.financial_entries
  DROP CONSTRAINT IF EXISTS chk_fin_entries_amount_positive;
ALTER TABLE public.financial_entries
  ADD CONSTRAINT chk_fin_entries_amount_positive
  CHECK (amount_cents > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Constraint de integridade: deadlines.due_at deve ser data válida
-- (não pode ser prazo no passado distante — protege contra erros de digitação)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.deadlines
  DROP CONSTRAINT IF EXISTS chk_deadlines_due_at_not_ancient;
ALTER TABLE public.deadlines
  ADD CONSTRAINT chk_deadlines_due_at_not_ancient
  CHECK (due_at > '1990-01-01'::timestamptz);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Grant de leitura para authenticated na nova tabela de audit
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON public.deadline_audit_log TO authenticated;
