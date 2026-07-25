-- Atendimento: a fila é um atributo operacional próprio. Tags continuam
-- livres para classificação e não devem alterar o destino da conversa.

UPDATE public.whatsapp_conversations
SET category = CASE
  WHEN tags @> ARRAY['Financeiro']::text[] OR tags @> ARRAY['Cobrança']::text[] THEN 'financeiro'
  WHEN tags @> ARRAY['Secretaria']::text[] OR tags @> ARRAY['Prazos']::text[] THEN 'secretaria'
  WHEN tags @> ARRAY['Jurídico']::text[] OR tags @> ARRAY['Juridico']::text[] THEN 'juridico'
  ELSE 'triagem'
END
WHERE category IS NULL OR category NOT IN ('triagem', 'juridico', 'financeiro', 'secretaria');

ALTER TABLE public.whatsapp_conversations
  ALTER COLUMN category SET DEFAULT 'triagem',
  ALTER COLUMN category SET NOT NULL;

ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_category_chk;
ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_category_chk
  CHECK (category IN ('triagem', 'juridico', 'financeiro', 'secretaria'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_tenant_queue
  ON public.whatsapp_conversations(tenant_id, category, assignment_status, last_message_at DESC);
