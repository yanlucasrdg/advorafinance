-- Atomic status transitions for the process Kanban.
-- All callers use this RPC, so audit triggers and any future status webhook
-- remain server-side and are never duplicated in the browser.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS status_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_case_status_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_version := OLD.status_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cases_status_version ON public.cases;
CREATE TRIGGER trg_cases_status_version
  BEFORE UPDATE OF status ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.bump_case_status_version();

CREATE OR REPLACE FUNCTION public.move_case_status(
  p_case_id uuid,
  p_next_status text,
  p_expected_version integer
)
RETURNS public.cases
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_case public.cases%ROWTYPE;
BEGIN
  IF p_next_status NOT IN ('ativo', 'suspenso', 'recurso', 'arquivado', 'ganho', 'perdido') THEN
    RAISE EXCEPTION 'CASE_STATUS_INVALID';
  END IF;

  SELECT * INTO v_case
  FROM public.cases
  WHERE id = p_case_id
    AND tenant_id = public.current_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CASE_NOT_FOUND';
  END IF;

  IF v_case.status_version <> p_expected_version THEN
    RAISE EXCEPTION 'CASE_STATUS_CONFLICT';
  END IF;

  IF v_case.status = p_next_status THEN
    RETURN v_case;
  END IF;

  UPDATE public.cases
  SET status = p_next_status
  WHERE id = p_case_id
  RETURNING * INTO v_case;

  RETURN v_case;
END;
$$;

REVOKE ALL ON FUNCTION public.move_case_status(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_case_status(uuid, text, integer) TO authenticated;
