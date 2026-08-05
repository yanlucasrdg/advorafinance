-- Minimal production recovery for databases that have not yet applied the
-- complete deadline-resilience migration. Keeps the Agenda readable and
-- restores event creation without depending on the audit subsystem.

ALTER TABLE public.deadlines
  ADD COLUMN IF NOT EXISTS status_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.create_deadline(
  p_title text,
  p_kind text,
  p_due_at timestamptz,
  p_priority text DEFAULT 'medium',
  p_case_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.deadlines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_deadline public.deadlines%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'DEADLINE_AUTH_REQUIRED';
  END IF;
  IF length(trim(COALESCE(p_title, ''))) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION 'DEADLINE_TITLE_INVALID';
  END IF;
  IF p_kind NOT IN (
    'audiencia', 'prazo_processual', 'reuniao', 'tarefa',
    'primeiro_atendimento', 'followup', 'vencimento', 'protocolo',
    'compromisso', 'outro'
  ) THEN
    RAISE EXCEPTION 'DEADLINE_KIND_INVALID';
  END IF;
  IF p_priority NOT IN ('low', 'medium', 'high', 'critical') THEN
    RAISE EXCEPTION 'DEADLINE_PRIORITY_INVALID';
  END IF;
  IF p_due_at <= '1990-01-01'::timestamptz THEN
    RAISE EXCEPTION 'DEADLINE_DATE_INVALID';
  END IF;
  IF p_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = p_case_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'DEADLINE_CASE_INVALID';
  END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = p_client_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'DEADLINE_CLIENT_INVALID';
  END IF;

  INSERT INTO public.deadlines (
    tenant_id, created_by, title, kind, due_at, priority,
    case_id, client_id, notes
  ) VALUES (
    v_tenant_id, auth.uid(), trim(p_title), p_kind, p_due_at, p_priority,
    p_case_id, p_client_id, NULLIF(trim(COALESCE(p_notes, '')), '')
  ) RETURNING * INTO v_deadline;

  RETURN v_deadline;
END;
$$;

REVOKE ALL ON FUNCTION public.create_deadline(text, text, timestamptz, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_deadline(text, text, timestamptz, text, uuid, uuid, text) TO authenticated;
