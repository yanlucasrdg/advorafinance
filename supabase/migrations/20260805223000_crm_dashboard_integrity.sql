-- CRM/dashboard integrity follow-up.
-- Incremental and idempotent: safe after the enterprise P0 migration.

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
    (SELECT t.timezone FROM public.tenants t WHERE t.id = public.current_tenant_id()),
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

CREATE OR REPLACE FUNCTION public.metrics_agenda()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone text := public.tenant_timezone();
  today date := public.tz_today();
  tomorrow date := today + 1;
  yday date := today - 1;
  now_ts timestamptz := now();
  in48 timestamptz := now() + interval '48 hours';
  in7 date := today + 7;
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'audiencias_hoje', COUNT(*) FILTER (WHERE kind = 'audiencia' AND (due_at AT TIME ZONE v_timezone)::date = today AND done = false),
      'audiencias_yday', COUNT(*) FILTER (WHERE kind = 'audiencia' AND (due_at AT TIME ZONE v_timezone)::date = yday AND done = false),
      'prazos_hoje', COUNT(*) FILTER (WHERE kind = 'prazo_processual' AND (due_at AT TIME ZONE v_timezone)::date = today AND done = false),
      'prazos_yday', COUNT(*) FILTER (WHERE kind = 'prazo_processual' AND (due_at AT TIME ZONE v_timezone)::date = yday AND done = false),
      'compromissos_hoje', COUNT(*) FILTER (WHERE kind NOT IN ('audiencia', 'prazo_processual') AND (due_at AT TIME ZONE v_timezone)::date = today AND done = false),
      'compromissos_yday', COUNT(*) FILTER (WHERE kind NOT IN ('audiencia', 'prazo_processual') AND (due_at AT TIME ZONE v_timezone)::date = yday AND done = false),
      'risco_48h', COUNT(*) FILTER (WHERE done = false AND due_at BETWEEN now_ts AND in48),
      'vencendo_hoje', COUNT(*) FILTER (WHERE done = false AND (due_at AT TIME ZONE v_timezone)::date = today),
      'vencendo_amanha', COUNT(*) FILTER (WHERE done = false AND (due_at AT TIME ZONE v_timezone)::date = tomorrow),
      'atraso', COUNT(*) FILTER (WHERE done = false AND due_at < now_ts),
      'concluidos_hoje', COUNT(*) FILTER (WHERE done = true AND (completed_at AT TIME ZONE v_timezone)::date = today),
      'proximos_7d', COUNT(*) FILTER (WHERE done = false AND (due_at AT TIME ZONE v_timezone)::date BETWEEN today AND in7)
    )
    FROM public.deadlines
    WHERE deleted_at IS NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.metrics_crm()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone text := public.tenant_timezone();
  month_start date := date_trunc('month', public.tz_today())::date;
  by_stage jsonb;
  total bigint; ativos bigint; leads bigint; encerrados bigint;
  pipeline_val bigint; fechados_mes bigint;
BEGIN
  SELECT jsonb_object_agg(status, jsonb_build_object('count', cnt, 'value', val))
  INTO by_stage
  FROM (
    SELECT status, COUNT(*) AS cnt, COALESCE(SUM(value_cents), 0) AS val
    FROM public.clients
    WHERE deleted_at IS NULL
    GROUP BY status
  ) stages;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status IN ('contrato', 'em_andamento')),
    COUNT(*) FILTER (WHERE status IN ('novo_contato', 'triagem', 'consulta_agendada', 'proposta')),
    COUNT(*) FILTER (WHERE status = 'encerrado'),
    COALESCE(SUM(value_cents) FILTER (WHERE status NOT IN ('encerrado', 'contrato', 'em_andamento')), 0),
    COUNT(*) FILTER (
      WHERE status IN ('contrato', 'em_andamento')
        AND (stage_entered_at AT TIME ZONE v_timezone)::date >= month_start
    )
  INTO total, ativos, leads, encerrados, pipeline_val, fechados_mes
  FROM public.clients
  WHERE deleted_at IS NULL;

  RETURN jsonb_build_object(
    'by_stage', COALESCE(by_stage, '{}'::jsonb),
    'total', total,
    'leads', leads,
    'ativos', ativos,
    'encerrados', encerrados,
    'pipeline_value', pipeline_val,
    'conv_pct', CASE WHEN (total - encerrados) > 0
      THEN ROUND((ativos::numeric / (total - encerrados)) * 100) ELSE NULL END,
    'fechados_mes', fechados_mes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.metrics_dashboard()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  fin jsonb; proc jsonb; ag jsonb;
  v_timezone text := public.tenant_timezone();
  today date := public.tz_today();
  month_start date := date_trunc('month', today)::date;
  clients_stats jsonb; top_clients jsonb;
BEGIN
  fin := public.metrics_financeiro();
  proc := public.metrics_processos();
  ag := public.metrics_agenda();

  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE status IN ('contrato', 'em_andamento')),
    'inactive', COUNT(*) FILTER (WHERE status NOT IN ('contrato', 'em_andamento')),
    'pf', COUNT(*) FILTER (WHERE UPPER(COALESCE(type, '')) <> 'PJ'),
    'pj', COUNT(*) FILTER (WHERE UPPER(COALESCE(type, '')) = 'PJ'),
    'new_month', COUNT(*) FILTER (
      WHERE status IN ('contrato', 'em_andamento')
        AND (stage_entered_at AT TIME ZONE v_timezone)::date >= month_start
    )
  ) INTO clients_stats
  FROM public.clients
  WHERE deleted_at IS NULL;

  SELECT jsonb_agg(row_to_json(ranked) ORDER BY ranked.total DESC)
  INTO top_clients
  FROM (
    SELECT c.id, c.name, COALESCE(SUM(fe.amount_cents), 0)::bigint AS total
    FROM public.clients c
    JOIN public.financial_entries fe ON fe.client_id = c.id
    WHERE c.deleted_at IS NULL AND fe.deleted_at IS NULL
      AND fe.kind = 'receita' AND fe.status = 'pago'
      AND (fe.paid_at AT TIME ZONE v_timezone)::date >= (today - interval '365 days')::date
    GROUP BY c.id, c.name
    ORDER BY total DESC
    LIMIT 5
  ) ranked;

  RETURN jsonb_build_object(
    'financeiro', fin,
    'processos', proc,
    'agenda', ag,
    'clientes', clients_stats,
    'top_clientes', COALESCE(top_clients, '[]'::jsonb)
  );
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

  IF p_next_status = 'arquivado' THEN
    IF v_case.status NOT IN ('ganho', 'perdido') THEN
      RAISE EXCEPTION 'CASE_ARCHIVE_REQUIRES_OUTCOME';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.deadlines d
      WHERE d.case_id = p_case_id AND d.tenant_id = v_tenant_id
        AND d.deleted_at IS NULL AND d.done = false
    ) THEN RAISE EXCEPTION 'CASE_ARCHIVE_OPEN_DEADLINES'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.financial_entries f
      WHERE f.case_id = p_case_id AND f.tenant_id = v_tenant_id
        AND f.deleted_at IS NULL
        AND (f.status <> 'pago' OR COALESCE(f.paid_amount_cents, 0) < f.amount_cents)
    ) THEN RAISE EXCEPTION 'CASE_ARCHIVE_OPEN_FINANCIAL'; END IF;
  END IF;

  UPDATE public.cases SET status = p_next_status
  WHERE id = p_case_id
  RETURNING * INTO v_case;
  RETURN v_case;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_financial_entry(p_entry_id uuid)
RETURNS public.financial_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_entry public.financial_entries%ROWTYPE;
  v_before jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'FINANCIAL_AUTH_REQUIRED'; END IF;
  IF NOT public.has_any_tenant_role(ARRAY['owner', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'ROLE_ACCESS_DENIED';
  END IF;

  SELECT * INTO v_entry
  FROM public.financial_entries
  WHERE id = p_entry_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_NOT_FOUND'; END IF;
  IF v_entry.settlement_status = 'conciliado' THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_RECONCILED'; END IF;
  IF COALESCE(v_entry.paid_amount_cents, 0) > 0 OR EXISTS (
    SELECT 1 FROM public.financial_payments p
    WHERE p.entry_id = p_entry_id AND p.tenant_id = v_tenant_id
  ) THEN RAISE EXCEPTION 'FINANCIAL_ENTRY_HAS_PAYMENTS'; END IF;

  v_before := to_jsonb(v_entry);
  UPDATE public.financial_entries
  SET deleted_at = now()
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  INSERT INTO public.financial_audit_log (
    tenant_id, entry_id, action, actor_id, before, after
  ) VALUES (
    v_tenant_id, p_entry_id, 'soft_deleted', auth.uid(), v_before, to_jsonb(v_entry)
  );
  RETURN v_entry;
END;
$$;

-- Payments must never disappear with their parent entry. Audit history survives
-- even an administrative/service-role deletion by detaching its optional FK.
ALTER TABLE public.financial_payments
  DROP CONSTRAINT IF EXISTS financial_payments_entry_id_fkey;
ALTER TABLE public.financial_payments
  ADD CONSTRAINT financial_payments_entry_id_fkey
  FOREIGN KEY (entry_id) REFERENCES public.financial_entries(id) ON DELETE RESTRICT;

ALTER TABLE public.financial_audit_log
  DROP CONSTRAINT IF EXISTS financial_audit_log_entry_id_fkey;
ALTER TABLE public.financial_audit_log
  ADD CONSTRAINT financial_audit_log_entry_id_fkey
  FOREIGN KEY (entry_id) REFERENCES public.financial_entries(id) ON DELETE SET NULL;

REVOKE DELETE ON public.financial_entries FROM authenticated;
REVOKE ALL ON FUNCTION public.soft_delete_financial_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_financial_entry(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.tenant_timezone() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_timezone() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.move_case_status(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_case_status(uuid, text, integer) TO authenticated;
