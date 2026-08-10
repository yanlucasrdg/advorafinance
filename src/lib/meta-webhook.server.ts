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

type ServiceQueue = "triagem" | "juridico" | "financeiro" | "secretaria";
type Qualification = { queue: ServiceQueue; urgent: boolean };

const QUEUE_LABELS: Record<ServiceQueue, string> = {
  triagem: "Triagem",
  juridico: "Jurídico",
  financeiro: "Financeiro",
  secretaria: "Secretaria",
};

/**
 * A conservative first-pass classifier. It never sends a reply or assigns a
 * person; it only places a new conversation in the appropriate work queue so
 * the office remains in control of every legal interaction.
 */
export function qualifyInboundMessage(body: string): Qualification {
  const text = body.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const includesAny = (terms: string[]) => terms.some((term) => text.includes(term));
  const urgent = includesAny(["urgente", "urgencia", "hoje", "agora", "liminar", "audiencia", "prazo vence", "prisao", "preso"]);

  if (includesAny(["boleto", "pagamento", "cobranca", "cobrar", "fatura", "pix", "honorario", "reembolso", "nota fiscal"])) {
    return { queue: "financeiro", urgent };
  }
  if (includesAny(["agendar", "agenda", "consulta", "horario", "documento", "procuracao", "endereco", "atendimento presencial"])) {
    return { queue: "secretaria", urgent };
  }
  if (includesAny(["processo", "trabalhista", "previdenci", "criminal", "divorcio", "familia", "inventario", "contrato", "imovel", "indenizacao", "advogado", "demissao", "beneficio", "recurso"])) {
    return { queue: "juridico", urgent };
  }
  return { queue: "triagem", urgent };
}

async function persistWebhookEvents(payload: MetaWebhookPayload, env: WorkerBindings) {
  const supabaseUrl = binding(env, "SUPABASE_URL");
  const serviceRole = binding(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) throw new Error("META_PERSISTENCE_NOT_CONFIGURED");

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let persistenceFailures = 0;

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
      if (instanceError) { persistenceFailures += 1; continue; }
      if (!instance) continue;

      for (const status of value?.statuses ?? []) {
        if (!status.id || !status.status) continue;
        const { error: statusError } = await supabase.from("whatsapp_messages").update({ status: status.status })
          .eq("tenant_id", instance.tenant_id).eq("external_message_id", status.id);
        if (statusError) persistenceFailures += 1;
      }

      const contacts = new Map((value?.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name]));
      for (const message of value?.messages ?? []) {
        const phone = message.from?.replace(/\D/g, "");
        if (!phone || !message.id) continue;

        const { data: existingConversation, error: existingConversationError } = await supabase
          .from("whatsapp_conversations")
          .select("id, tags, assignment_status, category")
          .eq("tenant_id", instance.tenant_id)
          .eq("instance_id", instance.id)
          .eq("contact_phone", phone)
          .maybeSingle();
        if (existingConversationError) { persistenceFailures += 1; continue; }

        const { data: conversation, error: conversationError } = existingConversation
          ? { data: existingConversation, error: null }
          : await supabase.from("whatsapp_conversations").insert({
            tenant_id: instance.tenant_id,
            instance_id: instance.id,
            contact_phone: phone,
            contact_name: contacts.get(message.from) ?? null,
            channel: "whatsapp",
            assignment_status: "new",
            category: "triagem",
          }).select("id, tags, assignment_status, category").single();
        if (conversationError || !conversation) { persistenceFailures += 1; continue; }

        const body = messageBody(message);
        const qualification = qualifyInboundMessage(body);
        const knownQueues = ["Triagem", "Jurídico", "Financeiro", "Secretaria"];
        const currentTags = conversation.tags ?? [];
        const manuallyRouted = conversation.category && conversation.category !== "triagem";
        const category = manuallyRouted ? conversation.category as ServiceQueue : qualification.queue;
        const nextTags = Array.from(new Set([
          ...currentTags.filter((tag: string) => !knownQueues.includes(tag)),
          ...(qualification.urgent ? ["Urgente"] : []),
        ]));
        const createdAt = message.timestamp
          ? new Date(Number(message.timestamp) * 1000).toISOString()
          : new Date().toISOString();
        const { error: ingestError } = await supabase.rpc("ingest_meta_whatsapp_message", {
          p_tenant_id: instance.tenant_id,
          p_conversation_id: conversation.id,
          p_body: body,
          p_external_message_id: message.id,
          p_created_at: createdAt,
          p_tags: nextTags,
          p_category: category,
          p_urgent: qualification.urgent,
          p_notification_body: `A conversa foi encaminhada para ${QUEUE_LABELS[category]}. Revise a mensagem e assuma o atendimento.`,
        });
        if (ingestError) persistenceFailures += 1;
      }
    }
  }
  if (persistenceFailures > 0) {
    throw new Error(`META_PERSISTENCE_FAILED:${persistenceFailures}`);
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

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 1_000_000) return new Response("Payload too large", { status: 413 });

  const body = await request.text();
  if (encoder.encode(body).byteLength > 1_000_000) return new Response("Payload too large", { status: 413 });
  const signature = request.headers.get("x-hub-signature-256");
  console.log("Meta WhatsApp webhook request", { hasSignature: Boolean(signature), bytes: body.length });
  if (!(await validMetaSignature(body, signature, appSecret))) {
    console.warn("Meta WhatsApp webhook rejected: invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(body) as MetaWebhookPayload;
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const receivedMessages = (payload.entry ?? []).flatMap((entry) => entry.changes ?? [])
    .reduce((total, change) => total + (change.value?.messages?.length ?? 0), 0);
  console.log("Meta WhatsApp webhook received", { entries: payload.entry?.length ?? 0, messages: receivedMessages });

  try {
    await persistWebhookEvents(payload, env);
  } catch (error) {
    console.error("Failed to persist Meta WhatsApp webhook", error);
    return new Response("Persistence failed", { status: 500 });
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}
