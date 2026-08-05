-- Process operations integrity: canonical CNJ numbers and truthful metrics.

-- Keep this follow-up independently executable on projects that have not yet
-- applied the dashboard timezone migration.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

CREATE OR REPLACE FUNCTION public.tenant_timezone()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT tenant.timezone FROM public.tenants tenant WHERE tenant.id = public.current_tenant_id()),
    'America/Sao_Paulo'
  )
$$;

CREATE OR REPLACE FUNCTION public.tz_today()
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT (now() AT TIME ZONE public.tenant_timezone())::date
$$;

CREATE OR REPLACE FUNCTION public.normalize_case_cnj()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean text;
  v_base text;
  v_remainder integer := 0;
  v_expected_dv integer;
  v_position integer;
BEGIN
  IF NEW.number IS NULL OR btrim(NEW.number) = '' THEN
    NEW.number := NULL;
    RETURN NEW;
  END IF;

  v_clean := regexp_replace(NEW.number, '[^0-9]', '', 'g');
  IF length(v_clean) <> 20 THEN
    RAISE EXCEPTION 'CASE_CNJ_INVALID';
  END IF;

  v_base := substring(v_clean FROM 1 FOR 7) || substring(v_clean FROM 10 FOR 11);
  FOR v_position IN 1..length(v_base) LOOP
    v_remainder := (v_remainder * 10 + substring(v_base FROM v_position FOR 1)::integer) % 97;
  END LOOP;
  v_expected_dv := 98 - ((v_remainder * 100) % 97);
  IF v_expected_dv <> substring(v_clean FROM 8 FOR 2)::integer THEN
    RAISE EXCEPTION 'CASE_CNJ_INVALID';
  END IF;

  -- Serialize equal CNJ writes so concurrent requests cannot create duplicates.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || v_clean, 0));
  IF EXISTS (
    SELECT 1
    FROM public.cases existing
    WHERE existing.tenant_id = NEW.tenant_id
      AND existing.id <> NEW.id
      AND existing.deleted_at IS NULL
      AND regexp_replace(existing.number, '[^0-9]', '', 'g') = v_clean
  ) THEN
    RAISE EXCEPTION 'CASE_CNJ_DUPLICATE';
  END IF;

  NEW.number := v_clean;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_case_cnj ON public.cases;
CREATE TRIGGER trg_normalize_case_cnj
  BEFORE INSERT OR UPDATE OF number, tenant_id ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.normalize_case_cnj();

CREATE INDEX IF NOT EXISTS idx_cases_tenant_cnj_canonical
  ON public.cases (tenant_id, (regexp_replace(number, '[^0-9]', '', 'g')))
  WHERE deleted_at IS NULL AND number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.metrics_processos()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone text := public.tenant_timezone();
  today date := public.tz_today();
  month_start timestamptz := date_trunc('month', now() AT TIME ZONE v_timezone) AT TIME ZONE v_timezone;
  prev_month_start timestamptz := (date_trunc('month', now() AT TIME ZONE v_timezone) - interval '1 month') AT TIME ZONE v_timezone;
  in48 timestamptz := now() + interval '48 hours';
  now_ts timestamptz := now();
  d30 timestamptz := now() - interval '30 days';
  active_now bigint; active_prev bigint;
  value_now bigint; value_prev bigint;
  critical_now bigint; critical_prev bigint;
  won bigint; lost bigint;
  fees_now bigint; fees_prev bigint;
  moves_today bigint; moves_yday bigint;
  stale_count bigint;
  by_stage jsonb; by_area jsonb; by_resp jsonb;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status IN ('ativo', 'recurso', 'suspenso')),
    COUNT(*) FILTER (WHERE status IN ('ativo', 'recurso', 'suspenso') AND created_at < month_start),
    COALESCE(SUM(value_cents), 0),
    COALESCE(SUM(value_cents) FILTER (WHERE created_at < month_start), 0),
    COUNT(*) FILTER (WHERE status = 'ganho'),
    COUNT(*) FILTER (WHERE status = 'perdido')
  INTO active_now, active_prev, value_now, value_prev, won, lost
  FROM public.cases
  WHERE deleted_at IS NULL;

  SELECT
    COUNT(*) FILTER (WHERE done = false AND due_at BETWEEN now_ts AND in48),
    COUNT(*) FILTER (
      WHERE done = false
        AND due_at BETWEEN (now_ts - interval '1 month') AND (in48 - interval '1 month')
    )
  INTO critical_now, critical_prev
  FROM public.deadlines
  WHERE deleted_at IS NULL AND case_id IS NOT NULL;

  SELECT
    COALESCE(SUM(amount_cents) FILTER (
      WHERE kind = 'receita' AND case_id IS NOT NULL AND status = 'pago' AND paid_at >= month_start
    ), 0),
    COALESCE(SUM(amount_cents) FILTER (
      WHERE kind = 'receita' AND case_id IS NOT NULL AND status = 'pago'
        AND paid_at >= prev_month_start AND paid_at < month_start
    ), 0)
  INTO fees_now, fees_prev
  FROM public.financial_entries
  WHERE deleted_at IS NULL;

  SELECT
    COUNT(*) FILTER (WHERE (occurred_at AT TIME ZONE v_timezone)::date = today),
    COUNT(*) FILTER (WHERE (occurred_at AT TIME ZONE v_timezone)::date = today - 1)
  INTO moves_today, moves_yday
  FROM public.case_movements;

  SELECT COUNT(*)
  INTO stale_count
  FROM public.cases
  WHERE deleted_at IS NULL
    AND status IN ('ativo', 'recurso')
    AND COALESCE(last_movement_at, updated_at) < d30;

  SELECT jsonb_object_agg(status, cnt) INTO by_stage FROM (
    SELECT status, COUNT(*) AS cnt FROM public.cases WHERE deleted_at IS NULL GROUP BY status
  ) grouped_status;
  SELECT jsonb_object_agg(area_name, cnt) INTO by_area FROM (
    SELECT COALESCE(NULLIF(trim(area), ''), 'Sem área') AS area_name, COUNT(*) AS cnt
    FROM public.cases WHERE deleted_at IS NULL GROUP BY 1
  ) grouped_area;
  SELECT jsonb_object_agg(responsible_name, cnt) INTO by_resp FROM (
    SELECT COALESCE(NULLIF(trim(responsible), ''), 'sem-responsavel') AS responsible_name, COUNT(*) AS cnt
    FROM public.cases WHERE deleted_at IS NULL GROUP BY 1
  ) grouped_responsible;

  RETURN jsonb_build_object(
    'active', jsonb_build_object('value', active_now, 'prev', active_prev),
    'value_cause', jsonb_build_object('value', value_now, 'prev', value_prev),
    'critical', jsonb_build_object('value', critical_now, 'prev', critical_prev),
    'success_pct', CASE WHEN (won + lost) > 0 THEN ROUND((won::numeric / (won + lost)) * 100) ELSE NULL END,
    'won', won,
    'lost', lost,
    'fees', jsonb_build_object('value', fees_now, 'prev', fees_prev),
    'moves_today', jsonb_build_object('value', moves_today, 'prev', moves_yday),
    'stale_30d', stale_count,
    'by_status', COALESCE(by_stage, '{}'::jsonb),
    'by_area', COALESCE(by_area, '{}'::jsonb),
    'by_resp', COALESCE(by_resp, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_case_cnj() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_case_cnj() TO service_role;
GRANT EXECUTE ON FUNCTION public.metrics_processos() TO authenticated;
