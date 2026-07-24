
-- Central de Atendimento: estender whatsapp_conversations para omnichannel + fila
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS assignment_status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_channel_chk;
ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_channel_chk
  CHECK (channel IN ('whatsapp','instagram','messenger'));

ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_assignment_chk;
ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_assignment_chk
  CHECK (assignment_status IN ('new','assigned','archived'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_tenant_status
  ON public.whatsapp_conversations(tenant_id, assignment_status, last_message_at DESC);

-- CRM Conversacional: estender cases com pipeline visual
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS pipeline_stage text NOT NULL DEFAULT 'novo_contato',
  ADD COLUMN IF NOT EXISTS pipeline_value_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS lead_temperature text NOT NULL DEFAULT 'morno',
  ADD COLUMN IF NOT EXISTS lead_source text,
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL;

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_pipeline_stage_chk;
ALTER TABLE public.cases
  ADD CONSTRAINT cases_pipeline_stage_chk
  CHECK (pipeline_stage IN ('novo_contato','triagem','consulta_agendada','proposta','contrato','em_andamento','encerrado'));

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_lead_temp_chk;
ALTER TABLE public.cases
  ADD CONSTRAINT cases_lead_temp_chk
  CHECK (lead_temperature IN ('quente','morno','frio'));

CREATE INDEX IF NOT EXISTS idx_cases_tenant_stage
  ON public.cases(tenant_id, pipeline_stage);

-- Realtime para as novas colunas / tabelas
ALTER PUBLICATION supabase_realtime ADD TABLE public.cases;
