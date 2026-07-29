-- =============================================================================
-- CRM P0 — contrato de dados de clientes
-- - Colunas dedicadas substituem metadados escondidos em notes.
-- - PF/PJ e etapas são normalizados.
-- - Exclusão do navegador passa a ser lógica.
-- - Mudança de etapa é atômica, auditada e protegida contra concorrência.
-- =============================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS value_cents bigint,
  ADD COLUMN IF NOT EXISTS owner text,
  ADD COLUMN IF NOT EXISTS is_hot boolean,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS status_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- A migration anterior criou value_cents/is_hot com DEFAULT antes do backfill.
-- Por isso registros legados ficaram com 0/false e o COALESCE não os migrou.
-- Este bloco reprocessa apenas JSONs que contêm as antigas chaves de metadados.
DO $migration$
DECLARE
  v_client record;
  v_meta jsonb;
  v_raw_value text;
  v_decimal_value numeric;
BEGIN
  FOR v_client IN
    SELECT id, notes, area, value_cents, owner, is_hot, address, city, state
    FROM public.clients
    WHERE notes IS NOT NULL
  LOOP
    BEGIN
      v_meta := v_client.notes::jsonb;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    IF jsonb_typeof(v_meta) <> 'object'
      OR NOT (v_meta ?| ARRAY['area', 'value', 'owner', 'hot', 'address', 'city', 'state'])
    THEN
      CONTINUE;
    END IF;

    v_decimal_value := NULL;
    v_raw_value := NULLIF(
      regexp_replace(COALESCE(v_meta->>'value', ''), '[^0-9,.\-]', '', 'g'),
      ''
    );

    IF v_raw_value IS NOT NULL THEN
      BEGIN
        -- Valores antigos eram digitados em reais. Aceita tanto 10000.50
        -- quanto a notação brasileira 10.000,50.
        IF position(',' IN v_raw_value) > 0 THEN
          v_decimal_value := replace(replace(v_raw_value, '.', ''), ',', '.')::numeric;
        ELSE
          v_decimal_value := v_raw_value::numeric;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_decimal_value := NULL;
      END;
    END IF;

    UPDATE public.clients
    SET
      area = COALESCE(NULLIF(btrim(v_client.area), ''), NULLIF(btrim(v_meta->>'area'), '')),
      value_cents = CASE
        WHEN COALESCE(v_client.value_cents, 0) = 0
          AND v_decimal_value IS NOT NULL
          AND v_decimal_value >= 0
        THEN round(v_decimal_value * 100)::bigint
        ELSE COALESCE(v_client.value_cents, 0)
      END,
      owner = COALESCE(NULLIF(btrim(v_client.owner), ''), NULLIF(btrim(v_meta->>'owner'), '')),
      is_hot = COALESCE(v_client.is_hot, false)
        OR CASE
          WHEN lower(COALESCE(v_meta->>'hot', 'false')) IN ('true', 't', '1', 'yes', 'sim')
          THEN true
          ELSE false
        END,
      address = COALESCE(NULLIF(btrim(v_client.address), ''), NULLIF(btrim(v_meta->>'address'), '')),
      city = COALESCE(NULLIF(btrim(v_client.city), ''), NULLIF(btrim(v_meta->>'city'), '')),
      state = COALESCE(NULLIF(btrim(v_client.state), ''), NULLIF(btrim(v_meta->>'state'), '')),
      -- Remove o antigo envelope de metadados; preserva uma nota textual,
      -- quando ela existia dentro do JSON.
      notes = COALESCE(NULLIF(v_meta->>'notes', ''), NULLIF(v_meta->>'body', ''))
    WHERE id = v_client.id;
  END LOOP;
END
$migration$;

UPDATE public.clients
SET
  type = CASE
    WHEN upper(btrim(COALESCE(type, ''))) = 'PJ' THEN 'PJ'
    WHEN upper(btrim(COALESCE(type, ''))) = 'PF' THEN 'PF'
    WHEN length(regexp_replace(COALESCE(doc, ''), '\D', '', 'g')) = 14 THEN 'PJ'
    ELSE 'PF'
  END,
  status = CASE status
    WHEN 'lead' THEN 'novo_contato'
    WHEN 'prospect' THEN 'novo_contato'
    WHEN 'qualificacao' THEN 'triagem'
    WHEN 'reuniao' THEN 'consulta_agendada'
    WHEN 'fechado' THEN 'contrato'
    WHEN 'ativo' THEN 'em_andamento'
    WHEN 'perdido' THEN 'encerrado'
    WHEN 'inativo' THEN 'encerrado'
    WHEN 'novo_contato' THEN 'novo_contato'
    WHEN 'triagem' THEN 'triagem'
    WHEN 'consulta_agendada' THEN 'consulta_agendada'
    WHEN 'proposta' THEN 'proposta'
    WHEN 'contrato' THEN 'contrato'
    WHEN 'em_andamento' THEN 'em_andamento'
    WHEN 'encerrado' THEN 'encerrado'
    ELSE 'novo_contato'
  END,
  value_cents = COALESCE(value_cents, 0),
  is_hot = COALESCE(is_hot, false),
  stage_entered_at = COALESCE(stage_entered_at, updated_at, created_at, now()),
  state = CASE
    WHEN length(btrim(COALESCE(state, ''))) = 2 THEN upper(btrim(state))
    ELSE NULL
  END;

ALTER TABLE public.clients
  ALTER COLUMN type SET DEFAULT 'PF',
  ALTER COLUMN status SET DEFAULT 'novo_contato',
  ALTER COLUMN value_cents SET DEFAULT 0,
  ALTER COLUMN value_cents SET NOT NULL,
  ALTER COLUMN is_hot SET DEFAULT false,
  ALTER COLUMN is_hot SET NOT NULL,
  ALTER COLUMN stage_entered_at SET DEFAULT now(),
  ALTER COLUMN stage_entered_at SET NOT NULL;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_type_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_type_check CHECK (type IN ('PF', 'PJ'));

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_value_cents_nonnegative;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_value_cents_nonnegative CHECK (value_cents >= 0);

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_state_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_state_check
  CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_status_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_status_check CHECK (
    status IN (
      'novo_contato',
      'triagem',
      'consulta_agendada',
      'proposta',
      'contrato',
      'em_andamento',
      'encerrado'
    )
  );

CREATE INDEX IF NOT EXISTS idx_clients_tenant_stage_active
  ON public.clients (tenant_id, status, stage_entered_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.normalize_client_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  -- No fluxo autenticado, o contexto da sessão sempre vence qualquer valor
  -- enviado pelo navegador. Service-role (auth.uid() nulo) preserva o payload
  -- para importações administrativas explícitas.
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.tenant_id := public.current_tenant_id();
    NEW.created_by := auth.uid();

    IF NEW.tenant_id IS NULL THEN
      RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED';
    END IF;
  END IF;

  NEW.type := upper(btrim(COALESCE(NEW.type, 'PF')));
  NEW.state := NULLIF(upper(btrim(COALESCE(NEW.state, ''))), '');
  NEW.status := CASE NEW.status
    WHEN 'lead' THEN 'novo_contato'
    WHEN 'prospect' THEN 'novo_contato'
    WHEN 'qualificacao' THEN 'triagem'
    WHEN 'reuniao' THEN 'consulta_agendada'
    WHEN 'fechado' THEN 'contrato'
    WHEN 'ativo' THEN 'em_andamento'
    WHEN 'perdido' THEN 'encerrado'
    WHEN 'inativo' THEN 'encerrado'
    ELSE NEW.status
  END;

  IF TG_OP = 'INSERT' THEN
    NEW.stage_entered_at := COALESCE(NEW.stage_entered_at, now());
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clients_contract_normalize ON public.clients;
CREATE TRIGGER trg_clients_contract_normalize
  BEFORE INSERT OR UPDATE OF type, state, status ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_client_contract();

CREATE OR REPLACE FUNCTION public.bump_client_status_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_version := OLD.status_version + 1;
    NEW.stage_entered_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clients_status_version ON public.clients;
CREATE TRIGGER trg_clients_status_version
  BEFORE UPDATE OF status ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_client_status_version();

CREATE OR REPLACE FUNCTION public.move_client_stage(
  p_client_id uuid,
  p_next_status text,
  p_expected_version integer
)
RETURNS public.clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_client public.clients%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_tenant_id uuid := public.current_tenant_id();
  v_previous_status text;
BEGIN
  IF v_actor_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'CLIENT_STATUS_VERSION_REQUIRED';
  END IF;

  IF p_next_status NOT IN (
    'novo_contato',
    'triagem',
    'consulta_agendada',
    'proposta',
    'contrato',
    'em_andamento',
    'encerrado'
  ) THEN
    RAISE EXCEPTION 'CLIENT_STATUS_INVALID';
  END IF;

  SELECT *
  INTO v_client
  FROM public.clients
  WHERE id = p_client_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  IF v_client.status_version <> p_expected_version THEN
    RAISE EXCEPTION 'CLIENT_STATUS_CONFLICT';
  END IF;

  IF v_client.status = p_next_status THEN
    RETURN v_client;
  END IF;

  v_previous_status := v_client.status;

  UPDATE public.clients
  SET status = p_next_status
  WHERE id = p_client_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
  RETURNING * INTO v_client;

  -- Auditoria faz parte da mesma transação. Qualquer falha aqui desfaz também
  -- a mudança de etapa, impedindo alterações sem rastro.
  INSERT INTO public.client_activities (
    tenant_id,
    client_id,
    user_id,
    kind,
    title,
    meta
  ) VALUES (
    v_tenant_id,
    p_client_id,
    v_actor_id,
    'stage_change',
    'Etapa do CRM alterada',
    jsonb_build_object(
      'old_stage', v_previous_status,
      'new_stage', p_next_status,
      'previous_version', p_expected_version,
      'new_version', p_expected_version + 1
    )
  );

  RETURN v_client;
END;
$function$;

REVOKE ALL ON FUNCTION public.move_client_stage(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_client_stage(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.soft_delete_client(p_client_id uuid)
RETURNS public.clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_client public.clients%ROWTYPE;
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  UPDATE public.clients
  SET deleted_at = now()
  WHERE id = p_client_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
  RETURNING * INTO v_client;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  INSERT INTO public.client_activities (
    tenant_id,
    client_id,
    user_id,
    kind,
    title,
    meta
  ) VALUES (
    v_tenant_id,
    p_client_id,
    v_actor_id,
    'deleted',
    'Cliente removido',
    jsonb_build_object('deleted_at', v_client.deleted_at)
  );

  RETURN v_client;
END;
$function$;

REVOKE ALL ON FUNCTION public.soft_delete_client(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_client(uuid) TO authenticated;

-- A etapa só pode mudar pelo RPC auditado. Exclusões físicas ficam restritas
-- a rotinas administrativas/service-role.
REVOKE UPDATE ON public.clients FROM authenticated;
GRANT UPDATE (
  name,
  email,
  phone,
  doc,
  type,
  notes,
  area,
  value_cents,
  owner,
  is_hot,
  address,
  city,
  state
) ON public.clients TO authenticated;
REVOKE DELETE ON public.clients FROM authenticated;
