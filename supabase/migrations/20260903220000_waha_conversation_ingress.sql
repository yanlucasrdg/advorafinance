-- Serialize WAHA direct-contact conversation creation so concurrent webhook
-- retries cannot create duplicate inbox rows for the same phone number.

CREATE OR REPLACE FUNCTION public.get_or_create_waha_conversation(
  p_tenant_id uuid,
  p_instance_id uuid,
  p_contact_phone text,
  p_contact_name text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  tags text[],
  assignment_status text,
  category text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone text := regexp_replace(COALESCE(p_contact_phone, ''), '\D', '', 'g');
  v_conversation public.whatsapp_conversations%ROWTYPE;
BEGIN
  IF v_phone !~ '^\d{10,15}$' THEN
    RAISE EXCEPTION 'WAHA_CONTACT_PHONE_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.whatsapp_instances instance
    WHERE instance.id = p_instance_id
      AND instance.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'WAHA_INSTANCE_TENANT_MISMATCH';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_instance_id::text || ':' || v_phone, 0));

  SELECT conversation.*
  INTO v_conversation
  FROM public.whatsapp_conversations conversation
  WHERE conversation.tenant_id = p_tenant_id
    AND conversation.instance_id = p_instance_id
    AND regexp_replace(conversation.contact_phone, '\D', '', 'g') = v_phone
  ORDER BY conversation.last_message_at DESC NULLS LAST, conversation.created_at ASC
  LIMIT 1;

  IF v_conversation.id IS NULL THEN
    INSERT INTO public.whatsapp_conversations (
      tenant_id, instance_id, contact_phone, contact_name, channel,
      assignment_status, category
    ) VALUES (
      p_tenant_id, p_instance_id, v_phone, NULLIF(btrim(p_contact_name), ''),
      'whatsapp', 'new', 'triagem'
    )
    RETURNING * INTO v_conversation;
  ELSIF v_conversation.contact_name IS NULL AND NULLIF(btrim(p_contact_name), '') IS NOT NULL THEN
    UPDATE public.whatsapp_conversations
    SET contact_name = NULLIF(btrim(p_contact_name), '')
    WHERE whatsapp_conversations.id = v_conversation.id
    RETURNING * INTO v_conversation;
  END IF;

  RETURN QUERY SELECT
    v_conversation.id,
    v_conversation.tags,
    v_conversation.assignment_status,
    v_conversation.category;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_waha_conversation(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_waha_conversation(uuid, uuid, text, text)
  TO service_role;
