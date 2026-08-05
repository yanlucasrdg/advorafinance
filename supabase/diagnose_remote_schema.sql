-- READ ONLY: inventories schema metadata without reading business records.
WITH required_relations(name) AS (
  VALUES
    ('tenants'), ('profiles'), ('user_roles'), ('clients'), ('cases'),
    ('case_movements'), ('deadlines'), ('deadline_audit_log'),
    ('financial_entries'), ('financial_payments'), ('financial_audit_log'),
    ('dre_settings'), ('documents'), ('client_activities'),
    ('whatsapp_instances'), ('whatsapp_conversations'), ('whatsapp_messages'),
    ('notifications'), ('ai_messages'), ('tenant_subscriptions'),
    ('billing_webhook_events')
),
relation_status AS (
  SELECT name, to_regclass(format('public.%I', name)) IS NOT NULL AS present
  FROM required_relations
),
column_inventory AS (
  SELECT
    c.table_name,
    jsonb_agg(
      jsonb_build_object(
        'name', c.column_name,
        'type', c.udt_name,
        'nullable', c.is_nullable = 'YES'
      ) ORDER BY c.ordinal_position
    ) AS columns
  FROM information_schema.columns c
  JOIN required_relations r ON r.name = c.table_name
  WHERE c.table_schema = 'public'
  GROUP BY c.table_name
),
function_inventory AS (
  SELECT jsonb_agg(
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
  ) AS functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'current_tenant_id', 'has_role', 'is_master_admin',
      'tenant_has_subscription_access', 'create_tenant_with_owner',
      'soft_delete_client', 'soft_delete_case', 'soft_delete_deadline',
      'move_client_stage', 'move_case_status', 'create_deadline',
      'update_deadline', 'toggle_deadline_completion',
      'apply_financial_payment', 'fn_deadline_audit'
    )
),
enum_inventory AS (
  SELECT
    t.typname,
    jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'
  GROUP BY t.typname
)
SELECT jsonb_pretty(
  jsonb_build_object(
    'relations', (
      SELECT jsonb_object_agg(name, present ORDER BY name)
      FROM relation_status
    ),
    'columns', COALESCE((
      SELECT jsonb_object_agg(table_name, columns ORDER BY table_name)
      FROM column_inventory
    ), '{}'::jsonb),
    'functions', COALESCE((SELECT functions FROM function_inventory), '[]'::jsonb),
    'enums', COALESCE((
      SELECT jsonb_object_agg(typname, values ORDER BY typname)
      FROM enum_inventory
    ), '{}'::jsonb)
  )
) AS schema_inventory;
