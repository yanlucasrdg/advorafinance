
-- 1) Soft-delete columns
ALTER TABLE public.cases              ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.clients            ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.deadlines          ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.financial_entries  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS cases_tenant_notdel_idx             ON public.cases             (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clients_tenant_notdel_idx           ON public.clients           (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS deadlines_tenant_notdel_idx         ON public.deadlines         (tenant_id, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS financial_entries_tenant_notdel_idx ON public.financial_entries (tenant_id, paid_at) WHERE deleted_at IS NULL;

-- Common timezone helper
CREATE OR REPLACE FUNCTION public.tz_today()
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'America/Fortaleza')::date
$$;

-- ============================================================
-- metrics_financeiro(from,to)
-- ============================================================
CREATE OR REPLACE FUNCTION public.metrics_financeiro(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  today date := tz_today();
  month_start date := date_trunc('month', today)::date;
  prev_month_start date := (date_trunc('month', today) - interval '1 month')::date;
  year_start date := date_trunc('year', today)::date;
  twelve_ago date := (date_trunc('month', today) - interval '11 months')::date;
  now_ts timestamptz := now();
  rev_month bigint := 0; rev_prev bigint := 0; rev_year bigint := 0; rev_12 bigint := 0;
  exp_month bigint := 0; exp_year bigint := 0;
  open_recv bigint := 0; over_recv bigint := 0;
  open_pay  bigint := 0; over_pay  bigint := 0;
  paid_count bigint := 0;
  series jsonb;
BEGIN
  SELECT
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='receita' AND status='pago' AND paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'America/Fortaleza')::date >= month_start),0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='receita' AND status='pago' AND paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'America/Fortaleza')::date >= prev_month_start AND (paid_at AT TIME ZONE 'America/Fortaleza')::date < month_start),0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='receita' AND status='pago' AND paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'America/Fortaleza')::date >= year_start),0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='receita' AND status='pago' AND paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'America/Fortaleza')::date >= twelve_ago),0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='despesa' AND status='pago' AND paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'America/Fortaleza')::date >= month_start),0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='despesa' AND status='pago' AND paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'America/Fortaleza')::date >= year_start),0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='receita' AND status <> 'pago'),0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='receita' AND status <> 'pago' AND due_date IS NOT NULL AND due_date < today),0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='despesa' AND status <> 'pago'),0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='despesa' AND status <> 'pago' AND due_date IS NOT NULL AND due_date < today),0),
    COUNT(*) FILTER (WHERE kind='receita' AND status='pago' AND paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'America/Fortaleza')::date >= year_start)
  INTO rev_month, rev_prev, rev_year, rev_12, exp_month, exp_year,
       open_recv, over_recv, open_pay, over_pay, paid_count
  FROM public.financial_entries
  WHERE deleted_at IS NULL
    AND (_from IS NULL OR (paid_at IS NULL OR (paid_at AT TIME ZONE 'America/Fortaleza')::date >= _from))
    AND (_to   IS NULL OR (paid_at IS NULL OR (paid_at AT TIME ZONE 'America/Fortaleza')::date <= _to));

  SELECT jsonb_agg(row_to_json(s) ORDER BY s.bucket)
  INTO series
  FROM (
    SELECT
      to_char(gs, 'YYYY-MM') AS bucket,
      COALESCE(SUM(fe.amount_cents) FILTER (WHERE fe.kind='receita'),0)::bigint AS receita,
      COALESCE(SUM(fe.amount_cents) FILTER (WHERE fe.kind='despesa'),0)::bigint AS despesa
    FROM generate_series(twelve_ago, month_start, interval '1 month') gs
    LEFT JOIN public.financial_entries fe
      ON fe.deleted_at IS NULL
     AND fe.status='pago' AND fe.paid_at IS NOT NULL
     AND date_trunc('month', (fe.paid_at AT TIME ZONE 'America/Fortaleza')) = gs
    GROUP BY gs
  ) s;

  RETURN jsonb_build_object(
    'rev_month', rev_month, 'rev_prev', rev_prev, 'rev_year', rev_year, 'rev_12', rev_12,
    'exp_month', exp_month, 'exp_year', exp_year,
    'open_receivable', open_recv, 'overdue_receivable', over_recv,
    'open_payable', open_pay, 'overdue_payable', over_pay,
    'delinquency_pct', CASE WHEN open_recv>0 THEN (over_recv::numeric/open_recv)*100 ELSE 0 END,
    'ticket_avg', CASE WHEN paid_count>0 THEN rev_year/paid_count ELSE 0 END,
    'profit_month', rev_month - exp_month,
    'profit_year',  rev_year - exp_year,
    'series', COALESCE(series, '[]'::jsonb)
  );
END $$;

-- ============================================================
-- metrics_processos()
-- ============================================================
CREATE OR REPLACE FUNCTION public.metrics_processos()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  today date := tz_today();
  month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Fortaleza') AT TIME ZONE 'America/Fortaleza';
  prev_month_start timestamptz := (date_trunc('month', now() AT TIME ZONE 'America/Fortaleza') - interval '1 month') AT TIME ZONE 'America/Fortaleza';
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
    COUNT(*) FILTER (WHERE status IN ('ativo','recurso','suspenso')),
    COUNT(*) FILTER (WHERE status IN ('ativo','recurso','suspenso') AND created_at < month_start),
    COALESCE(SUM(value_cents),0),
    COALESCE(SUM(value_cents) FILTER (WHERE created_at < month_start),0),
    COUNT(*) FILTER (WHERE status='ganho'),
    COUNT(*) FILTER (WHERE status='perdido')
  INTO active_now, active_prev, value_now, value_prev, won, lost
  FROM public.cases WHERE deleted_at IS NULL;

  SELECT COUNT(*) FILTER (WHERE done=false AND due_at BETWEEN now_ts AND in48),
         COUNT(*) FILTER (WHERE done=false AND due_at BETWEEN (now_ts - interval '1 month') AND (in48 - interval '1 month'))
  INTO critical_now, critical_prev
  FROM public.deadlines WHERE deleted_at IS NULL;

  SELECT
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='receita' AND case_id IS NOT NULL AND status='pago' AND paid_at >= month_start),0),
    COALESCE(SUM(amount_cents) FILTER (WHERE kind='receita' AND case_id IS NOT NULL AND status='pago' AND paid_at >= prev_month_start AND paid_at < month_start),0)
  INTO fees_now, fees_prev
  FROM public.financial_entries WHERE deleted_at IS NULL;

  SELECT
    COUNT(*) FILTER (WHERE (updated_at AT TIME ZONE 'America/Fortaleza')::date = today),
    COUNT(*) FILTER (WHERE (updated_at AT TIME ZONE 'America/Fortaleza')::date = today - 1)
  INTO moves_today, moves_yday
  FROM public.cases WHERE deleted_at IS NULL;

  SELECT COUNT(*)
  INTO stale_count
  FROM public.cases
  WHERE deleted_at IS NULL
    AND status IN ('ativo','recurso')
    AND COALESCE(last_movement_at, updated_at) < d30;

  SELECT jsonb_object_agg(status, cnt) INTO by_stage FROM (
    SELECT status, COUNT(*) AS cnt FROM public.cases WHERE deleted_at IS NULL GROUP BY status
  ) x;

  SELECT jsonb_object_agg(area, cnt) INTO by_area FROM (
    SELECT COALESCE(NULLIF(TRIM(area),''),'Sem área') AS area, COUNT(*) AS cnt
    FROM public.cases WHERE deleted_at IS NULL GROUP BY 1
  ) x;

  SELECT jsonb_object_agg(resp, cnt) INTO by_resp FROM (
    SELECT COALESCE(responsible::text,'sem-responsavel') AS resp, COUNT(*) AS cnt
    FROM public.cases WHERE deleted_at IS NULL GROUP BY 1
  ) x;

  RETURN jsonb_build_object(
    'active',      jsonb_build_object('value', active_now,   'prev', active_prev),
    'value_cause', jsonb_build_object('value', value_now,    'prev', value_prev),
    'critical',    jsonb_build_object('value', critical_now, 'prev', critical_prev),
    'success_pct', CASE WHEN (won+lost)>0 THEN ROUND((won::numeric/(won+lost))*100) ELSE NULL END,
    'won', won, 'lost', lost,
    'fees',        jsonb_build_object('value', fees_now,     'prev', fees_prev),
    'moves_today', jsonb_build_object('value', moves_today,  'prev', moves_yday),
    'stale_30d',   stale_count,
    'by_status', COALESCE(by_stage,'{}'::jsonb),
    'by_area',   COALESCE(by_area,'{}'::jsonb),
    'by_resp',   COALESCE(by_resp,'{}'::jsonb)
  );
END $$;

-- ============================================================
-- metrics_agenda()
-- ============================================================
CREATE OR REPLACE FUNCTION public.metrics_agenda()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  today date := tz_today();
  tomorrow date := today + 1;
  yday date := today - 1;
  now_ts timestamptz := now();
  in48 timestamptz := now() + interval '48 hours';
  in7 date := today + 7;
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'audiencias_hoje', COUNT(*) FILTER (WHERE kind='audiencia' AND (due_at AT TIME ZONE 'America/Fortaleza')::date = today AND done=false),
      'audiencias_yday', COUNT(*) FILTER (WHERE kind='audiencia' AND (due_at AT TIME ZONE 'America/Fortaleza')::date = yday AND done=false),
      'prazos_hoje',     COUNT(*) FILTER (WHERE kind='prazo'     AND (due_at AT TIME ZONE 'America/Fortaleza')::date = today AND done=false),
      'prazos_yday',     COUNT(*) FILTER (WHERE kind='prazo'     AND (due_at AT TIME ZONE 'America/Fortaleza')::date = yday AND done=false),
      'compromissos_hoje', COUNT(*) FILTER (WHERE kind NOT IN ('audiencia','prazo') AND (due_at AT TIME ZONE 'America/Fortaleza')::date = today AND done=false),
      'compromissos_yday', COUNT(*) FILTER (WHERE kind NOT IN ('audiencia','prazo') AND (due_at AT TIME ZONE 'America/Fortaleza')::date = yday AND done=false),
      'risco_48h', COUNT(*) FILTER (WHERE done=false AND due_at BETWEEN now_ts AND in48),
      'vencendo_hoje', COUNT(*) FILTER (WHERE done=false AND (due_at AT TIME ZONE 'America/Fortaleza')::date = today),
      'vencendo_amanha', COUNT(*) FILTER (WHERE done=false AND (due_at AT TIME ZONE 'America/Fortaleza')::date = tomorrow),
      'atraso', COUNT(*) FILTER (WHERE done=false AND due_at < now_ts),
      'concluidos_hoje', COUNT(*) FILTER (WHERE done=true AND (completed_at AT TIME ZONE 'America/Fortaleza')::date = today),
      'proximos_7d', COUNT(*) FILTER (WHERE done=false AND (due_at AT TIME ZONE 'America/Fortaleza')::date BETWEEN today AND in7)
    )
    FROM public.deadlines
    WHERE deleted_at IS NULL
  );
END $$;

-- ============================================================
-- metrics_crm()
-- ============================================================
CREATE OR REPLACE FUNCTION public.metrics_crm()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  today date := tz_today();
  month_start date := date_trunc('month', today)::date;
  by_stage jsonb;
  total bigint; ativos bigint; leads bigint; encerrados bigint; pipeline_val bigint; fechados_mes bigint;
BEGIN
  SELECT jsonb_object_agg(pipeline_stage, jsonb_build_object('count', cnt, 'value', val))
  INTO by_stage
  FROM (
    SELECT pipeline_stage, COUNT(*) AS cnt, COALESCE(SUM(pipeline_value_cents),0) AS val
    FROM public.cases WHERE deleted_at IS NULL
    GROUP BY pipeline_stage
  ) x;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pipeline_stage IN ('contrato','em_andamento')),
    COUNT(*) FILTER (WHERE pipeline_stage IN ('novo_contato','triagem')),
    COUNT(*) FILTER (WHERE pipeline_stage = 'encerrado'),
    COALESCE(SUM(pipeline_value_cents) FILTER (WHERE pipeline_stage <> 'encerrado'),0),
    COUNT(*) FILTER (WHERE pipeline_stage IN ('contrato','em_andamento') AND (updated_at AT TIME ZONE 'America/Fortaleza')::date >= month_start)
  INTO total, ativos, leads, encerrados, pipeline_val, fechados_mes
  FROM public.cases WHERE deleted_at IS NULL;

  RETURN jsonb_build_object(
    'by_stage', COALESCE(by_stage,'{}'::jsonb),
    'total', total,
    'leads', leads,
    'ativos', ativos,
    'encerrados', encerrados,
    'pipeline_value', pipeline_val,
    'conv_pct', CASE WHEN (total - encerrados) > 0 THEN ROUND((ativos::numeric/(total - encerrados))*100) ELSE NULL END,
    'fechados_mes', fechados_mes
  );
END $$;

-- ============================================================
-- metrics_comunicacoes()
-- ============================================================
CREATE OR REPLACE FUNCTION public.metrics_comunicacoes()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'total', COUNT(*),
      'novas', COUNT(*) FILTER (WHERE COALESCE(assignment_status,'new') = 'new'),
      'minhas', COUNT(*) FILTER (WHERE assigned_to = auth.uid()),
      'nao_lidas', COALESCE(SUM(unread_count),0),
      'outros', COUNT(*) FILTER (WHERE assigned_to IS NOT NULL AND assigned_to <> auth.uid())
    )
    FROM public.whatsapp_conversations
    WHERE archived_at IS NULL
  );
END $$;

-- ============================================================
-- metrics_dashboard() — junta o essencial das outras
-- ============================================================
CREATE OR REPLACE FUNCTION public.metrics_dashboard()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  fin jsonb; proc jsonb; ag jsonb;
  today date := tz_today();
  month_start date := date_trunc('month', today)::date;
  clients_stats jsonb; top_clients jsonb;
BEGIN
  fin := metrics_financeiro();
  proc := metrics_processos();
  ag   := metrics_agenda();

  SELECT jsonb_build_object(
    'total',   COUNT(*),
    'active',  COUNT(*) FILTER (WHERE status='ativo'),
    'inactive',COUNT(*) FILTER (WHERE status<>'ativo'),
    'pf',      COUNT(*) FILTER (WHERE UPPER(COALESCE(type,''))<>'PJ'),
    'pj',      COUNT(*) FILTER (WHERE UPPER(COALESCE(type,''))='PJ'),
    'new_month', COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'America/Fortaleza')::date >= month_start)
  ) INTO clients_stats
  FROM public.clients WHERE deleted_at IS NULL;

  SELECT jsonb_agg(row_to_json(t) ORDER BY t.total DESC)
  INTO top_clients
  FROM (
    SELECT c.id, c.name, COALESCE(SUM(fe.amount_cents),0)::bigint AS total
    FROM public.clients c
    JOIN public.financial_entries fe ON fe.client_id = c.id
    WHERE c.deleted_at IS NULL AND fe.deleted_at IS NULL
      AND fe.kind='receita' AND fe.status='pago'
      AND (fe.paid_at AT TIME ZONE 'America/Fortaleza')::date >= (today - interval '365 days')::date
    GROUP BY c.id, c.name
    ORDER BY total DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'financeiro', fin,
    'processos',  proc,
    'agenda',     ag,
    'clientes',   clients_stats,
    'top_clientes', COALESCE(top_clients, '[]'::jsonb)
  );
END $$;

-- ============================================================
-- notifications_summary()
-- ============================================================
CREATE OR REPLACE FUNCTION public.notifications_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'total', COUNT(*),
      'unread', COUNT(*) FILTER (WHERE read_at IS NULL)
    )
    FROM public.notifications
  );
END $$;

-- Grants
GRANT EXECUTE ON FUNCTION public.tz_today() TO authenticated;
GRANT EXECUTE ON FUNCTION public.metrics_financeiro(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.metrics_processos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.metrics_agenda() TO authenticated;
GRANT EXECUTE ON FUNCTION public.metrics_crm() TO authenticated;
GRANT EXECUTE ON FUNCTION public.metrics_comunicacoes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.metrics_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notifications_summary() TO authenticated;
