-- Repair metrics_processos after responsible became a UUID profile reference.
-- The previous implementation called trim(uuid), which only failed when the
-- RPC was executed and consequently made metrics_dashboard fail as well.

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
    SELECT status, COUNT(*) AS cnt
    FROM public.cases
    WHERE deleted_at IS NULL
    GROUP BY status
  ) grouped_status;

  SELECT jsonb_object_agg(area_name, cnt) INTO by_area FROM (
    SELECT COALESCE(NULLIF(btrim(area), ''), 'Sem area') AS area_name, COUNT(*) AS cnt
    FROM public.cases
    WHERE deleted_at IS NULL
    GROUP BY 1
  ) grouped_area;

  SELECT jsonb_object_agg(responsible_name, cnt) INTO by_resp FROM (
    SELECT
      COALESCE(NULLIF(btrim(profile.full_name), ''), 'Sem responsavel') AS responsible_name,
      COUNT(*) AS cnt
    FROM public.cases legal_case
    LEFT JOIN public.profiles profile
      ON profile.id = legal_case.responsible
      AND profile.tenant_id = legal_case.tenant_id
    WHERE legal_case.deleted_at IS NULL
    GROUP BY 1
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

REVOKE ALL ON FUNCTION public.metrics_processos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.metrics_processos() TO authenticated;
