-- Meta Cloud API may replay a webhook. Deduplicate on the provider message id.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_external_instance_id_unique
  ON public.whatsapp_instances (external_instance_id)
  WHERE external_instance_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_external_message_id_unique
  ON public.whatsapp_messages (tenant_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
