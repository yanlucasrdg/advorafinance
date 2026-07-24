type WorkerBindings = Record<string, unknown>;

type MetaWebhookMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
};

type MetaWebhookPayload = {
  entry?: Array<{ changes?: Array<{ value?: {
    metadata?: { phone_number_id?: string };
    contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
    messages?: MetaWebhookMessage[];
    statuses?: Array<{ id?: string; status?: string }>;
  } }> }>;
};

const encoder = new TextEncoder();

function binding(env: WorkerBindings, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function validMetaSignature(body: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = `sha256=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return constantTimeEqual(expected, signature);
}

function messageBody(message: MetaWebhookMessage) {
  if (message.type === "text") return message.text?.body?.trim() || "Mensagem de texto";
  if (message.type === "button") return message.button?.text?.trim() || "Resposta de botão";
  if (message.type === "interactive") {
    return message.interactive?.button_reply?.title?.trim()
      || message.interactive?.list_reply?.title?.trim()
      || "Resposta interativa";
  }
  return `Mensagem ${message.type ?? "recebida"}`;
}

async function persistWebhookEvents(payload: MetaWebhookPayload, env: WorkerBindings) {
  const supabaseUrl = binding(env, "SUPABASE_URL");
  const serviceRole = binding(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: instance, error: instanceError } = await supabase
        .from("whatsapp_instances")
        .select("id, tenant_id")
        .eq("external_instance_id", phoneNumberId)
        .maybeSingle();
      if (instanceError || !instance) continue;

      for (const status of value?.statuses ?? []) {
        if (!status.id || !status.status) continue;
        await supabase.from("whatsapp_messages").update({ status: status.status })
          .eq("tenant_id", instance.tenant_id).eq("external_message_id", status.id);
      }

      const contacts = new Map((value?.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name]));
      for (const message of value?.messages ?? []) {
        const phone = message.from?.replace(/\D/g, "");
        if (!phone || !message.id) continue;

        const { data: conversation, error: conversationError } = await supabase
          .from("whatsapp_conversations")
          .upsert({
            tenant_id: instance.tenant_id,
            instance_id: instance.id,
            contact_phone: phone,
            contact_name: contacts.get(message.from) ?? null,
            channel: "whatsapp",
            assignment_status: "new",
          }, { onConflict: "instance_id,contact_phone" })
          .select("id")
          .single();
        if (conversationError || !conversation) continue;

        const body = messageBody(message);
        const { error: messageError } = await supabase.from("whatsapp_messages").insert({
          tenant_id: instance.tenant_id,
          conversation_id: conversation.id,
          direction: "inbound",
          body,
          status: "received",
          external_message_id: message.id,
          created_at: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });

        // The unique index makes retries a no-op; only a newly stored message
        // updates the inbox preview and unread count.
        if (!messageError) {
          await supabase.from("whatsapp_conversations").update({
            last_message: body,
            last_message_at: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
            unread_count: 1,
            assignment_status: "new",
          }).eq("id", conversation.id);
        }
      }
    }
  }
}

/**
 * Meta Cloud API webhook handshake and signature validation.
 * Message persistence is intentionally added only after a tenant is linked to
 * a real WhatsApp Business phone number, avoiding unscoped inbound data.
 */
export async function handleMetaWhatsAppWebhook(request: Request, env: WorkerBindings): Promise<Response> {
  const url = new URL(request.url);
  const verifyToken = binding(env, "META_WEBHOOK_VERIFY_TOKEN");

  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && challenge && verifyToken && token && constantTimeEqual(token, verifyToken)) {
      return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, POST" } });

  const appSecret = binding(env, "META_APP_SECRET");
  if (!appSecret) return new Response("Webhook not configured", { status: 503 });

  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!(await validMetaSignature(body, signature, appSecret))) return new Response("Invalid signature", { status: 401 });

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(body) as MetaWebhookPayload;
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  try {
    await persistWebhookEvents(payload, env);
  } catch (error) {
    // Meta retries non-2xx responses. We acknowledge a valid delivery and log
    // the server-side persistence error without exposing request contents.
    console.error("Failed to persist Meta WhatsApp webhook", error);
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}
