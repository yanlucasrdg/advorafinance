-- Complete financial reporting from server-side aggregates.
-- Operational lists may remain paginated; reports never depend on their page size.

DO $$
BEGIN
  IF to_regclass('public.financial_entries') IS NULL
    OR to_regclass('public.financial_payments') IS NULL
    OR to_regclass('public.financial_payment_reversals') IS NULL
    OR to_regclass('public.clients') IS NULL
    OR to_regclass('public.cases') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.dre_settings') IS NULL
    OR to_regprocedure('public.current_tenant_id()') IS NULL
    OR to_regprocedure('public.tenant_timezone()') IS NULL
    OR to_regprocedure('public.tz_today()') IS NULL
    OR to_regprocedure('public.financial_has_any_tenant_role(public.app_role[])') IS NULL
    OR to_regprocedure('public.financial_tenant_has_subscription_access(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'FINANCIAL_LEDGER_MIGRATION_REQUIRED';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS financial_entries_reporting_due_idx
  ON public.financial_entries (tenant_id, kind, due_date)
  INCLUDE (amount_cents, paid_amount_cents, client_id, case_id, category)
  WHERE deleted_at IS NULL AND status <> 'cancelado';

CREATE INDEX IF NOT EXISTS financial_entries_reporting_scope_idx
  ON public.financial_entries (tenant_id, client_id, case_id)
  INCLUDE (kind, amount_cents, paid_amount_cents, due_date, category)
  WHERE deleted_at IS NULL AND status <> 'cancelado';

CREATE INDEX IF NOT EXISTS financial_entries_reporting_case_idx
  ON public.financial_entries (tenant_id, case_id)
  INCLUDE (client_id, kind, amount_cents, paid_amount_cents, due_date, category)
  WHERE deleted_at IS NULL AND status <> 'cancelado';

CREATE INDEX IF NOT EXISTS financial_payments_reporting_date_idx
  ON public.financial_payments (tenant_id, paid_at, entry_id)
  INCLUDE (amount_cents, method);

CREATE INDEX IF NOT EXISTS financial_reversals_reporting_date_idx
  ON public.financial_payment_reversals (tenant_id, reversed_at, payment_id)
  INCLUDE (amount_cents);

CREATE INDEX IF NOT EXISTS cases_financial_reporting_area_idx
  ON public.cases (tenant_id, area, id)
  INCLUDE (responsible, client_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cases_financial_reporting_responsible_idx
  ON public.cases (tenant_id, responsible, id)
  INCLUDE (area, client_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.financial_reports(
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _client_id uuid DEFAULT NULL,
  _area text DEFAULT NULL,
  _responsible text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_timezone text := public.tenant_timezone();
  v_today date := public.tz_today();
  v_from date := COALESCE(_from, date_trunc('month', public.tz_today())::date);
  v_to date := COALESCE(_to, public.tz_today());
  v_from_at timestamptz;
  v_to_exclusive_at timestamptz;
  v_responsible uuid;
  v_result jsonb;
BEGIN
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'FINANCIAL_AUTH_REQUIRED'; END IF;
  IF NOT public.financial_has_any_tenant_role(ARRAY['owner', 'admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'ROLE_ACCESS_DENIED';
  END IF;
  IF NOT public.financial_tenant_has_subscription_access(v_tenant_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ACCESS_DENIED';
  END IF;
  IF v_to < v_from THEN RAISE EXCEPTION 'FINANCIAL_PERIOD_INVALID'; END IF;
  IF v_to - v_from > 400 THEN RAISE EXCEPTION 'FINANCIAL_REPORT_PERIOD_TOO_LARGE'; END IF;

  v_from_at := v_from::timestamp AT TIME ZONE v_timezone;
  v_to_exclusive_at := (v_to + 1)::timestamp AT TIME ZONE v_timezone;
  IF NULLIF(btrim(_responsible), '') IS NOT NULL THEN
    BEGIN
      v_responsible := btrim(_responsible)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'FINANCIAL_RESPONSIBLE_INVALID';
    END;
  END IF;

  WITH settings AS MATERIALIZED (
    SELECT
      COALESCE(setting.apply_cogs, true) AS apply_cogs,
      COALESCE(
        setting.enabled_categories,
        ARRAY[
          'receita_servico', 'receita_outra', 'imposto', 'cogs',
          'despesa_operacional', 'despesa_administrativa', 'despesa_financeira'
        ]::text[]
      ) AS enabled_categories,
      COALESCE(setting.category_map, '{}'::jsonb) AS category_map
    FROM (SELECT 1) anchor
    LEFT JOIN public.dre_settings setting ON setting.tenant_id = v_tenant_id
  ), scoped_entries AS MATERIALIZED (
    SELECT
      entry.id,
      entry.tenant_id,
      entry.client_id,
      entry.case_id,
      entry.kind,
      entry.category,
      entry.amount_cents,
      entry.paid_amount_cents,
      entry.due_date,
      client.name AS client_name,
      legal_case.title AS case_title,
      legal_case.number AS case_number,
      legal_case.area,
      legal_case.responsible::text AS responsible_id,
      COALESCE(
        NULLIF(btrim(responsible_profile.full_name), ''),
        NULLIF(btrim(responsible_profile.email), ''),
        legal_case.responsible::text
      ) AS responsible_name
    FROM public.financial_entries entry
    LEFT JOIN public.clients client
      ON client.id = entry.client_id
      AND client.tenant_id = entry.tenant_id
      AND client.deleted_at IS NULL
    LEFT JOIN public.cases legal_case
      ON legal_case.id = entry.case_id
      AND legal_case.tenant_id = entry.tenant_id
      AND legal_case.deleted_at IS NULL
    LEFT JOIN public.profiles responsible_profile
      ON responsible_profile.id = legal_case.responsible
      AND responsible_profile.tenant_id = entry.tenant_id
    WHERE entry.tenant_id = v_tenant_id
      AND entry.deleted_at IS NULL
      AND entry.status <> 'cancelado'
      AND (_client_id IS NULL OR entry.client_id = _client_id)
      AND (_area IS NULL OR legal_case.area = _area)
      AND (v_responsible IS NULL OR legal_case.responsible = v_responsible)
  ), movements AS MATERIALIZED (
    SELECT
      entry.*,
      COALESCE(NULLIF(btrim(payment.method), ''), 'não informado') AS method,
      payment.paid_at AS occurred_at,
      (payment.paid_at AT TIME ZONE v_timezone)::date AS occurred_on,
      payment.amount_cents::bigint AS signed_amount
    FROM public.financial_payments payment
    JOIN scoped_entries entry
      ON entry.id = payment.entry_id AND entry.tenant_id = payment.tenant_id
    WHERE payment.tenant_id = v_tenant_id
      AND payment.paid_at >= v_from_at
      AND payment.paid_at < v_to_exclusive_at

    UNION ALL

    SELECT
      entry.*,
      COALESCE(NULLIF(btrim(payment.method), ''), 'não informado') AS method,
      reversal.reversed_at AS occurred_at,
      (reversal.reversed_at AT TIME ZONE v_timezone)::date AS occurred_on,
      -reversal.amount_cents::bigint AS signed_amount
    FROM public.financial_payment_reversals reversal
    JOIN public.financial_payments payment
      ON payment.id = reversal.payment_id AND payment.tenant_id = reversal.tenant_id
    JOIN scoped_entries entry
      ON entry.id = payment.entry_id AND entry.tenant_id = payment.tenant_id
    WHERE reversal.tenant_id = v_tenant_id
      AND reversal.reversed_at >= v_from_at
      AND reversal.reversed_at < v_to_exclusive_at
  ), period_movements AS MATERIALIZED (
    SELECT
      movement.*,
      CASE
        WHEN jsonb_extract_path_text(
          settings.category_map,
          lower(COALESCE(movement.category, ''))
        ) = ANY(ARRAY[
          'receita_servico', 'receita_outra', 'imposto', 'cogs',
          'despesa_operacional', 'despesa_administrativa', 'despesa_financeira'
        ]::text[])
          THEN jsonb_extract_path_text(
            settings.category_map,
            lower(COALESCE(movement.category, ''))
          )
        WHEN lower(COALESCE(movement.category, '')) = ANY(ARRAY[
          'receita_servico', 'receita_outra', 'imposto', 'cogs',
          'despesa_operacional', 'despesa_administrativa', 'despesa_financeira'
        ]::text[])
          THEN lower(movement.category)
        WHEN movement.kind = 'receita' THEN 'receita_servico'
        ELSE 'despesa_operacional'
      END AS dre_category
    FROM movements movement
    CROSS JOIN settings
    WHERE movement.occurred_on BETWEEN v_from AND v_to
  ), dre_bucket_rows AS MATERIALIZED (
    SELECT
      movement.dre_category,
      COALESCE(SUM(movement.signed_amount), 0)::bigint AS value
    FROM period_movements movement
    CROSS JOIN settings
    WHERE movement.dre_category = ANY(settings.enabled_categories)
    GROUP BY movement.dre_category
  ), dre_base AS MATERIALIZED (
    SELECT
      COALESCE(SUM(value) FILTER (WHERE dre_category IN ('receita_servico', 'receita_outra')), 0)::bigint AS receita_bruta,
      COALESCE(SUM(value) FILTER (WHERE dre_category = 'imposto'), 0)::bigint AS deducoes,
      CASE WHEN settings.apply_cogs
        THEN COALESCE(SUM(value) FILTER (WHERE dre_category = 'cogs'), 0)::bigint
        ELSE 0::bigint
      END AS custos,
      COALESCE(SUM(value) FILTER (WHERE dre_category IN ('despesa_operacional', 'despesa_administrativa')), 0)::bigint AS despesas_operacionais,
      COALESCE(SUM(value) FILTER (WHERE dre_category = 'despesa_financeira'), 0)::bigint AS despesas_financeiras,
      settings.apply_cogs,
      settings.enabled_categories,
      COALESCE(
        jsonb_object_agg(dre_category, value) FILTER (WHERE dre_category IS NOT NULL),
        '{}'::jsonb
      ) AS buckets
    FROM settings
    LEFT JOIN dre_bucket_rows ON true
    GROUP BY settings.apply_cogs, settings.enabled_categories
  ), dre_values AS MATERIALIZED (
    SELECT
      dre_base.*,
      receita_bruta - deducoes AS receita_liquida,
      receita_bruta - deducoes - custos AS lucro_bruto,
      receita_bruta - deducoes - custos - despesas_operacionais AS resultado_operacional,
      receita_bruta - deducoes - custos - despesas_operacionais - despesas_financeiras AS resultado
    FROM dre_base
  ), cash_directions AS MATERIALIZED (
    SELECT
      movement.occurred_on,
      movement.method,
      CASE
        WHEN (movement.kind = 'receita' AND movement.signed_amount > 0)
          OR (movement.kind = 'despesa' AND movement.signed_amount < 0)
          THEN abs(movement.signed_amount)
        ELSE 0
      END::bigint AS entradas,
      CASE
        WHEN (movement.kind = 'despesa' AND movement.signed_amount > 0)
          OR (movement.kind = 'receita' AND movement.signed_amount < 0)
          THEN abs(movement.signed_amount)
        ELSE 0
      END::bigint AS saidas
    FROM period_movements movement
  ), daily_raw AS MATERIALIZED (
    SELECT occurred_on, SUM(entradas)::bigint AS entradas, SUM(saidas)::bigint AS saidas
    FROM cash_directions
    GROUP BY occurred_on
  ), calendar AS MATERIALIZED (
    SELECT v_from + day_offset AS bucket
    FROM generate_series(0, v_to - v_from) AS day_offset
  ), daily_flow AS MATERIALIZED (
    SELECT
      calendar.bucket,
      COALESCE(daily_raw.entradas, 0)::bigint AS entradas,
      COALESCE(daily_raw.saidas, 0)::bigint AS saidas,
      SUM(COALESCE(daily_raw.entradas, 0) - COALESCE(daily_raw.saidas, 0))
        OVER (ORDER BY calendar.bucket)::bigint AS saldo
    FROM calendar
    LEFT JOIN daily_raw ON daily_raw.occurred_on = calendar.bucket
  ), method_flow AS MATERIALIZED (
    SELECT method, SUM(entradas)::bigint AS entradas, SUM(saidas)::bigint AS saidas
    FROM cash_directions
    GROUP BY method
  ), direct_flow AS MATERIALIZED (
    SELECT
      COALESCE(SUM(entradas), 0)::bigint AS entradas,
      COALESCE(SUM(saidas), 0)::bigint AS saidas
    FROM cash_directions
  ), aging_keys AS MATERIALIZED (
    SELECT * FROM (VALUES
      ('not_due'::text, 1),
      ('days_1_30'::text, 2),
      ('days_31_60'::text, 3),
      ('days_61_90'::text, 4),
      ('days_90_plus'::text, 5),
      ('no_due_date'::text, 6)
    ) AS aging_key(key, sort_order)
  ), aging_values AS MATERIALIZED (
    SELECT
      CASE
        WHEN due_date IS NULL THEN 'no_due_date'
        WHEN due_date >= v_today THEN 'not_due'
        WHEN v_today - due_date BETWEEN 1 AND 30 THEN 'days_1_30'
        WHEN v_today - due_date BETWEEN 31 AND 60 THEN 'days_31_60'
        WHEN v_today - due_date BETWEEN 61 AND 90 THEN 'days_61_90'
        ELSE 'days_90_plus'
      END AS key,
      SUM(GREATEST(amount_cents - paid_amount_cents, 0))::bigint AS value,
      COUNT(*)::bigint AS count
    FROM scoped_entries
    WHERE kind = 'receita' AND paid_amount_cents < amount_cents
    GROUP BY 1
  ), client_groups AS MATERIALIZED (
    SELECT
      movement.client_id,
      COALESCE(NULLIF(btrim(movement.client_name), ''), 'Sem cliente') AS name,
      COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'receita'), 0)::bigint AS revenue,
      COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'despesa'), 0)::bigint AS expense,
      (
        COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'receita'), 0)
        - COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'despesa'), 0)
      )::bigint AS net,
      COUNT(DISTINCT movement.id)::bigint AS count
    FROM period_movements movement
    GROUP BY movement.client_id, COALESCE(NULLIF(btrim(movement.client_name), ''), 'Sem cliente')
  ), case_groups AS MATERIALIZED (
    SELECT
      movement.case_id,
      COALESCE(
        NULLIF(btrim(movement.case_title), ''),
        NULLIF(btrim(movement.case_number), ''),
        'Sem processo'
      ) AS name,
      COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'receita'), 0)::bigint AS revenue,
      COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'despesa'), 0)::bigint AS expense,
      (
        COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'receita'), 0)
        - COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'despesa'), 0)
      )::bigint AS net,
      COUNT(DISTINCT movement.id)::bigint AS count
    FROM period_movements movement
    GROUP BY movement.case_id, COALESCE(
      NULLIF(btrim(movement.case_title), ''),
      NULLIF(btrim(movement.case_number), ''),
      'Sem processo'
    )
  ), area_groups AS MATERIALIZED (
    SELECT
      COALESCE(NULLIF(btrim(movement.area), ''), 'Sem área') AS name,
      COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'receita'), 0)::bigint AS revenue,
      COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'despesa'), 0)::bigint AS expense,
      (
        COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'receita'), 0)
        - COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'despesa'), 0)
      )::bigint AS net,
      COUNT(DISTINCT movement.id)::bigint AS count
    FROM period_movements movement
    GROUP BY COALESCE(NULLIF(btrim(movement.area), ''), 'Sem área')
  ), responsible_groups AS MATERIALIZED (
    SELECT
      movement.responsible_id,
      COALESCE(NULLIF(btrim(movement.responsible_name), ''), 'Sem responsável') AS name,
      COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'receita'), 0)::bigint AS revenue,
      COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'despesa'), 0)::bigint AS expense,
      (
        COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'receita'), 0)
        - COALESCE(SUM(movement.signed_amount) FILTER (WHERE movement.kind = 'despesa'), 0)
      )::bigint AS net,
      COUNT(DISTINCT movement.id)::bigint AS count
    FROM period_movements movement
    GROUP BY movement.responsible_id, COALESCE(NULLIF(btrim(movement.responsible_name), ''), 'Sem responsável')
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'schemaVersion', 1,
      'generatedAt', now(),
      'timezone', v_timezone,
      'currency', 'BRL',
      'basis', 'cash',
      'agingAsOf', v_today
    ),
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'timezone', v_timezone),
    'dre', jsonb_build_object(
      'receitaBruta', dre.receita_bruta,
      'deducoes', dre.deducoes,
      'receitaLiquida', dre.receita_liquida,
      'custos', dre.custos,
      'lucroBruto', dre.lucro_bruto,
      'desOp', dre.despesas_operacionais,
      'resultadoOperacional', dre.resultado_operacional,
      'desFin', dre.despesas_financeiras,
      'resultado', dre.resultado,
      'margem', CASE WHEN dre.receita_bruta <> 0
        THEN (dre.resultado::numeric / dre.receita_bruta) * 100 ELSE 0 END,
      'buckets', dre.buckets,
      'config', jsonb_build_object(
        'applyCogs', dre.apply_cogs,
        'enabledCategories', dre.enabled_categories
      )
    ),
    'cashFlow', jsonb_build_object(
      'daily', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'bucket', daily.bucket,
          'entradas', daily.entradas,
          'saidas', daily.saidas,
          'saldo', daily.saldo
        ) ORDER BY daily.bucket), '[]'::jsonb)
        FROM daily_flow daily
      ),
      'direct', jsonb_build_object(
        'entradasOp', direct.entradas,
        'saidasOp', direct.saidas,
        'caixaGerado', direct.entradas - direct.saidas,
        'byMethod', (
          SELECT COALESCE(jsonb_object_agg(method.method, jsonb_build_object(
            'entradas', method.entradas,
            'saidas', method.saidas
          ) ORDER BY method.method), '{}'::jsonb)
          FROM method_flow method
        )
      ),
      'indirect', jsonb_build_object(
        'available', false,
        'reason', 'requires_competence_ledger'
      )
    ),
    'aging', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', aging_key.key,
        'value', COALESCE(aging_value.value, 0),
        'count', COALESCE(aging_value.count, 0)
      ) ORDER BY aging_key.sort_order), '[]'::jsonb)
      FROM aging_keys aging_key
      LEFT JOIN aging_values aging_value ON aging_value.key = aging_key.key
    ),
    'groups', jsonb_build_object(
      'clients', (
        SELECT COALESCE(jsonb_agg(to_jsonb(client_group) ORDER BY client_group.value DESC), '[]'::jsonb)
        FROM (
          SELECT client_id AS id, name, revenue AS value, revenue, expense, net, count
          FROM client_groups WHERE revenue <> 0 ORDER BY revenue DESC LIMIT 6
        ) client_group
      ),
      'cases', (
        SELECT COALESCE(jsonb_agg(to_jsonb(case_group) ORDER BY case_group.value DESC), '[]'::jsonb)
        FROM (
          SELECT case_id AS id, name, revenue AS value, revenue, expense, net, count
          FROM case_groups WHERE revenue <> 0 ORDER BY revenue DESC LIMIT 6
        ) case_group
      ),
      'areas', (
        SELECT COALESCE(jsonb_agg(to_jsonb(area_group) ORDER BY area_group.value DESC), '[]'::jsonb)
        FROM (
          SELECT name, revenue AS value, revenue, expense, net, count
          FROM area_groups WHERE revenue <> 0 ORDER BY revenue DESC LIMIT 8
        ) area_group
      ),
      'responsibles', (
        SELECT COALESCE(jsonb_agg(to_jsonb(responsible_group) ORDER BY responsible_group.value DESC), '[]'::jsonb)
        FROM (
          SELECT responsible_id AS id, name, revenue AS value, revenue, expense, net, count
          FROM responsible_groups WHERE revenue <> 0 ORDER BY revenue DESC LIMIT 8
        ) responsible_group
      )
    )
  )
  INTO v_result
  FROM dre_values dre
  CROSS JOIN direct_flow direct;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.financial_reports(date, date, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financial_reports(date, date, uuid, text, text) TO authenticated;
