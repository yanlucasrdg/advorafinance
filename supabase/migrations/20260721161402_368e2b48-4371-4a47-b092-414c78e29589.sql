
CREATE OR REPLACE FUNCTION public.metrics_financeiro(
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _client_id uuid DEFAULT NULL,
  _area text DEFAULT NULL,
  _responsible text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  today date := tz_today();
  month_start date := date_trunc('month', today)::date;
  prev_month_start date := (date_trunc('month', today) - interval '1 month')::date;
  year_start date := date_trunc('year', today)::date;
  twelve_ago date := (date_trunc('month', today) - interval '11 months')::date;
  rev_month bigint := 0; rev_prev bigint := 0; rev_year bigint := 0; rev_12 bigint := 0;
  exp_month bigint := 0; exp_year bigint := 0;
  open_recv bigint := 0; over_recv bigint := 0;
  open_pay  bigint := 0; over_pay  bigint := 0;
  paid_count bigint := 0;
  series jsonb;
BEGIN
  WITH fe AS (
    SELECT f.*
    FROM public.financial_entries f
    LEFT JOIN public.cases c ON c.id = f.case_id
    WHERE f.deleted_at IS NULL
      AND (_client_id  IS NULL OR f.client_id = _client_id)
      AND (_area        IS NULL OR c.area = _area)
      AND (_responsible IS NULL OR c.responsible::text = _responsible)
      AND (_from IS NULL OR (f.paid_at IS NULL OR (f.paid_at AT TIME ZONE 'America/Fortaleza')::date >= _from))
      AND (_to   IS NULL OR (f.paid_at IS NULL OR (f.paid_at AT TIME ZONE 'America/Fortaleza')::date <= _to))
  )
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
  FROM fe;

  WITH fe AS (
    SELECT f.*
    FROM public.financial_entries f
    LEFT JOIN public.cases c ON c.id = f.case_id
    WHERE f.deleted_at IS NULL
      AND (_client_id  IS NULL OR f.client_id = _client_id)
      AND (_area        IS NULL OR c.area = _area)
      AND (_responsible IS NULL OR c.responsible::text = _responsible)
  )
  SELECT jsonb_agg(row_to_json(s) ORDER BY s.bucket)
  INTO series
  FROM (
    SELECT
      to_char(gs, 'YYYY-MM') AS bucket,
      COALESCE(SUM(fe.amount_cents) FILTER (WHERE fe.kind='receita'),0)::bigint AS receita,
      COALESCE(SUM(fe.amount_cents) FILTER (WHERE fe.kind='despesa'),0)::bigint AS despesa
    FROM generate_series(twelve_ago, month_start, interval '1 month') gs
    LEFT JOIN fe
      ON fe.status='pago' AND fe.paid_at IS NOT NULL
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
END $function$;
