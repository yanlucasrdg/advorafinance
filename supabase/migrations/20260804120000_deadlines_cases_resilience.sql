-- Phase 2 / P0: resilient legal deadlines and process lifecycle.
-- Browser clients use RPCs for critical writes so tenant ownership, optimistic
-- concurrency and the audit trail remain in one database transaction.

ALTER TABLE public.deadlines
  ADD COLUMN IF NOT EXISTS status_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.deadlines
SET kind = CASE
  WHEN kind = 'prazo' THEN 'prazo_processual'
  WHEN kind IN (
    'audiencia', 'prazo_processual', 'reuniao', 'tarefa',
    'primeiro_atendimento', 'followup', 'vencimento', 'protocolo',
    'compromisso', 'outro'
  ) THEN kind
  ELSE 'outro'
END,
priority = CASE priority
  WHEN 'baixa' THEN 'low'
  WHEN 'media' THEN 'medium'
  WHEN 'alta' THEN 'high'
  WHEN 'critica' THEN 'critical'
  WHEN 'low' THEN 'low'
  WHEN 'medium' THEN 'medium'
  WHEN 'high' THEN 'high'
  WHEN 'critical' THEN 'critical'
  ELSE 'medium'
END;

ALTER TABLE public.deadlines ALTER COLUMN kind SET DEFAULT 'prazo_processual';
ALTER TABLE public.deadlines ALTER COLUMN priority SET DEFAULT 'medium';

ALTER TABLE public.deadlines DROP CONSTRAINT IF EXISTS chk_deadlines_kind;
ALTER TABLE public.deadlines
  ADD CONSTRAINT chk_deadlines_kind CHECK (kind IN (
    'audiencia', 'prazo_processual', 'reuniao', 'tarefa',
    'primeiro_atendimento', 'followup', 'vencimento', 'protocolo',
    'compromisso', 'outro'
  ));

ALTER TABLE public.deadlines DROP CONSTRAINT IF EXISTS chk_deadlines_priority;
ALTER TABLE public.deadlines
  ADD CONSTRAINT chk_deadlines_priority
  CHECK (priority IN ('low', 'medium', 'high', 'critical'));

CREATE OR REPLACE FUNCTION public.bump_deadline_status_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.status_version := OLD.status_version + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deadlines_status_version ON public.deadlines;
CREATE TRIGGER trg_deadlines_status_version
  BEFORE UPDATE ON public.deadlines
  FOR EACH ROW EXECUTE FUNCTION public.bump_deadline_status_version();

-- Audit only operational metadata. Titles, notes, party names, contacts and
-- process numbers are deliberately excluded to avoid duplicating legal/PII
-- content in immutable logs.
CREATE OR REPLACE FUNCTION public.fn_deadline_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text;
  v_before jsonb := NULL;
  v_after jsonb := NULL;
  v_deadline_id uuid;
  v_tenant_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_deadline_id := NEW.id;
    v_tenant_id := NEW.tenant_id;
    v_after := jsonb_build_object(
      'id', NEW.id, 'kind', NEW.kind, 'due_at', NEW.due_at,
      'done', NEW.done, 'priority', NEW.priority,
      'case_id', NEW.case_id, 'client_id', NEW.client_id,
      'completed_at', NEW.completed_at, 'completed_by', NEW.completed_by,
      'deleted_at', NEW.deleted_at, 'status_version', NEW.status_version
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
    v_deadline_id := OLD.id;
    v_tenant_id := OLD.tenant_id;
    v_before := jsonb_build_object(
      'id', OLD.id, 'kind', OLD.kind, 'due_at', OLD.due_at,
      'done', OLD.done, 'priority', OLD.priority,
      'case_id', OLD.case_id, 'client_id', OLD.client_id,
      'completed_at', OLD.completed_at, 'completed_by', OLD.completed_by,
      'deleted_at', OLD.deleted_at, 'status_version', OLD.status_version
    );
  ELSE
    v_deadline_id := NEW.id;
    v_tenant_id := NEW.tenant_id;
    IF OLD.done = false AND NEW.done = true THEN
      v_action := 'completed';
    ELSIF OLD.done = true AND NEW.done = false THEN
      v_action := 'reopened';
    ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action := 'removed';
    ELSE
      v_action := 'updated';
    END IF;
    v_before := jsonb_build_object(
      'id', OLD.id, 'kind', OLD.kind, 'due_at', OLD.due_at,
      'done', OLD.done, 'priority', OLD.priority,
      'case_id', OLD.case_id, 'client_id', OLD.client_id,
      'completed_at', OLD.completed_at, 'completed_by', OLD.completed_by,
      'deleted_at', OLD.deleted_at, 'status_version', OLD.status_version
    );
    v_after := jsonb_build_object(
      'id', NEW.id, 'kind', NEW.kind, 'due_at', NEW.due_at,
      'done', NEW.done, 'priority', NEW.priority,
      'case_id', NEW.case_id, 'client_id', NEW.client_id,
      'completed_at', NEW.completed_at, 'completed_by', NEW.completed_by,
      'deleted_at', NEW.deleted_at, 'status_version', NEW.status_version
    );
    IF v_before = v_after THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.deadline_audit_log (
    deadline_id, tenant_id, actor_id, action, before, after
  ) VALUES (
    v_deadline_id, v_tenant_id, auth.uid(), v_action, v_before, v_after
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Sanitize historical audit rows created by the previous full-row trigger.
UPDATE public.deadline_audit_log
SET before = before - ARRAY['title', 'notes', 'tenant_id', 'created_by', 'updated_at']::text[],
    after = after - ARRAY['title', 'notes', 'tenant_id', 'created_by', 'updated_at']::text[];

CREATE OR REPLACE FUNCTION public.tf_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_old_data jsonb := NULL;
  v_new_data jsonb := NULL;
  v_redacted_keys text[] := ARRAY[
    'tenant_id', 'name', 'email', 'phone', 'doc', 'notes', 'address',
    'city', 'state', 'title', 'description', 'parties', 'subjects',
    'number', 'court', 'payment_method', 'metadata', 'file_path'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tenant_id := NEW.tenant_id;
    v_new_data := to_jsonb(NEW) - v_redacted_keys;
  ELSIF TG_OP = 'UPDATE' THEN
    v_tenant_id := NEW.tenant_id;
    v_old_data := to_jsonb(OLD) - v_redacted_keys;
    v_new_data := to_jsonb(NEW) - v_redacted_keys;
  ELSE
    v_tenant_id := OLD.tenant_id;
    v_old_data := to_jsonb(OLD) - v_redacted_keys;
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      tenant_id, user_id, table_name, record_id, action, old_data, new_data
    ) VALUES (
      v_tenant_id, v_user_id, TG_TABLE_NAME::text,
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
      TG_OP, v_old_data, v_new_data
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.audit_logs
SET old_data = old_data - ARRAY[
      'tenant_id', 'name', 'email', 'phone', 'doc', 'notes', 'address',
      'city', 'state', 'title', 'description', 'parties', 'subjects',
      'number', 'court', 'payment_method', 'metadata', 'file_path'
    ]::text[],
    new_data = new_data - ARRAY[
      'tenant_id', 'name', 'email', 'phone', 'doc', 'notes', 'address',
      'city', 'state', 'title', 'description', 'parties', 'subjects',
      'number', 'court', 'payment_method', 'metadata', 'file_path'
    ]::text[];

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

CREATE OR REPLACE FUNCTION public.update_deadline(
  p_deadline_id uuid,
  p_expected_version integer,
  p_patch jsonb
)
RETURNS public.deadlines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_deadline public.deadlines%ROWTYPE;
  v_title text;
  v_kind text;
  v_due_at timestamptz;
  v_priority text;
  v_case_id uuid;
  v_client_id uuid;
  v_notes text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'DEADLINE_AUTH_REQUIRED';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'DEADLINE_PATCH_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_patch) AS key
    WHERE key NOT IN ('title', 'kind', 'due_at', 'priority', 'case_id', 'client_id', 'notes')
  ) THEN
    RAISE EXCEPTION 'DEADLINE_PATCH_INVALID';
  END IF;

  SELECT * INTO v_deadline
  FROM public.deadlines
  WHERE id = p_deadline_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEADLINE_NOT_FOUND'; END IF;
  IF v_deadline.status_version <> p_expected_version THEN
    RAISE EXCEPTION 'DEADLINE_VERSION_CONFLICT';
  END IF;

  v_title := CASE WHEN p_patch ? 'title' THEN trim(p_patch->>'title') ELSE v_deadline.title END;
  v_kind := CASE WHEN p_patch ? 'kind' THEN p_patch->>'kind' ELSE v_deadline.kind END;
  v_due_at := CASE WHEN p_patch ? 'due_at' THEN (p_patch->>'due_at')::timestamptz ELSE v_deadline.due_at END;
  v_priority := CASE WHEN p_patch ? 'priority' THEN p_patch->>'priority' ELSE v_deadline.priority END;
  v_case_id := CASE WHEN p_patch ? 'case_id' THEN NULLIF(p_patch->>'case_id', '')::uuid ELSE v_deadline.case_id END;
  v_client_id := CASE WHEN p_patch ? 'client_id' THEN NULLIF(p_patch->>'client_id', '')::uuid ELSE v_deadline.client_id END;
  v_notes := CASE WHEN p_patch ? 'notes' THEN NULLIF(trim(COALESCE(p_patch->>'notes', '')), '') ELSE v_deadline.notes END;

  IF length(COALESCE(v_title, '')) NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION 'DEADLINE_TITLE_INVALID'; END IF;
  IF v_kind NOT IN (
    'audiencia', 'prazo_processual', 'reuniao', 'tarefa',
    'primeiro_atendimento', 'followup', 'vencimento', 'protocolo',
    'compromisso', 'outro'
  ) THEN RAISE EXCEPTION 'DEADLINE_KIND_INVALID'; END IF;
  IF v_priority NOT IN ('low', 'medium', 'high', 'critical') THEN RAISE EXCEPTION 'DEADLINE_PRIORITY_INVALID'; END IF;
  IF v_due_at <= '1990-01-01'::timestamptz THEN RAISE EXCEPTION 'DEADLINE_DATE_INVALID'; END IF;
  IF v_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cases WHERE id = v_case_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'DEADLINE_CASE_INVALID'; END IF;
  IF v_client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = v_client_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'DEADLINE_CLIENT_INVALID'; END IF;

  UPDATE public.deadlines
  SET title = v_title, kind = v_kind, due_at = v_due_at,
      priority = v_priority, case_id = v_case_id,
      client_id = v_client_id, notes = v_notes
  WHERE id = p_deadline_id
  RETURNING * INTO v_deadline;
  RETURN v_deadline;
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_deadline_completion(
  p_deadline_id uuid,
  p_expected_version integer
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
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'DEADLINE_AUTH_REQUIRED'; END IF;
  SELECT * INTO v_deadline
  FROM public.deadlines
  WHERE id = p_deadline_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEADLINE_NOT_FOUND'; END IF;
  IF v_deadline.status_version <> p_expected_version THEN RAISE EXCEPTION 'DEADLINE_VERSION_CONFLICT'; END IF;

  UPDATE public.deadlines
  SET done = NOT v_deadline.done,
      completed_at = CASE WHEN NOT v_deadline.done THEN now() ELSE NULL END,
      completed_by = CASE WHEN NOT v_deadline.done THEN auth.uid() ELSE NULL END
  WHERE id = p_deadline_id
  RETURNING * INTO v_deadline;
  RETURN v_deadline;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_deadline(
  p_deadline_id uuid,
  p_expected_version integer
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
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'DEADLINE_AUTH_REQUIRED'; END IF;
  SELECT * INTO v_deadline
  FROM public.deadlines
  WHERE id = p_deadline_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEADLINE_NOT_FOUND'; END IF;
  IF v_deadline.status_version <> p_expected_version THEN RAISE EXCEPTION 'DEADLINE_VERSION_CONFLICT'; END IF;

  UPDATE public.deadlines SET deleted_at = now()
  WHERE id = p_deadline_id
  RETURNING * INTO v_deadline;
  RETURN v_deadline;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_case_status(
  p_case_id uuid,
  p_next_status text,
  p_expected_version integer
)
RETURNS public.cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_case public.cases%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'CASE_AUTH_REQUIRED'; END IF;
  IF p_next_status NOT IN ('ativo', 'suspenso', 'recurso', 'arquivado', 'ganho', 'perdido') THEN
    RAISE EXCEPTION 'CASE_STATUS_INVALID';
  END IF;
  SELECT * INTO v_case
  FROM public.cases
  WHERE id = p_case_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND'; END IF;
  IF v_case.status_version <> p_expected_version THEN RAISE EXCEPTION 'CASE_STATUS_CONFLICT'; END IF;
  IF v_case.status = p_next_status THEN RETURN v_case; END IF;

  UPDATE public.cases SET status = p_next_status
  WHERE id = p_case_id
  RETURNING * INTO v_case;
  RETURN v_case;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_case(
  p_case_id uuid,
  p_expected_version integer
)
RETURNS public.cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_case public.cases%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'CASE_AUTH_REQUIRED'; END IF;
  SELECT * INTO v_case
  FROM public.cases
  WHERE id = p_case_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND'; END IF;
  IF v_case.status_version <> p_expected_version THEN RAISE EXCEPTION 'CASE_STATUS_CONFLICT'; END IF;

  UPDATE public.cases SET deleted_at = now()
  WHERE id = p_case_id
  RETURNING * INTO v_case;
  RETURN v_case;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON public.deadlines FROM authenticated;
REVOKE DELETE ON public.cases FROM authenticated;
REVOKE UPDATE ON public.cases FROM authenticated;
GRANT UPDATE (
  title, number, tribunal, court, area, value_cents, description,
  client_id, responsible, parties, class_name, distribution_date,
  instance, subjects, conversation_id, lead_source, lead_temperature,
  pipeline_stage, pipeline_value_cents
) ON public.cases TO authenticated;

REVOKE ALL ON FUNCTION public.create_deadline(text, text, timestamptz, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_deadline(uuid, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_deadline_completion(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_deadline(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_case_status(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_case(uuid, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_deadline(text, text, timestamptz, text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_deadline(uuid, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_deadline_completion(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_deadline(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_case_status(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_case(uuid, integer) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_deadlines_tenant_active_due
  ON public.deadlines (tenant_id, done, due_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cases_tenant_active_status
  ON public.cases (tenant_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;
