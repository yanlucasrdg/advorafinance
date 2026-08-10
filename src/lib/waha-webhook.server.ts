import { qualifyInboundMessage } from "@/lib/meta-webhook.server";
import { phoneFromWahaId, wahaStatus } from "@/lib/waha-client.server";

type WorkerBindings = Record<string, unknown>;

type WahaWebhookPayload = {
  event?: string;
  session?: string;
  me?: { id?: string; pushName?: string } | null;
  payload?: {
    id?: string;
    timestamp?: number;
    from?: string;
    to?: string;
    fromMe?: boolean;
    body?: string;
    type?: string;
    ackName?: string;
    status?: string;
    _data?: { notifyName?: string; pushName?: string };
  };
};

const encoder = new TextEncoder();
const QUEUE_LABELS = { triagem: "Triagem", juridico: "Jurídico", financeiro: "Financeiro", secretaria: "Secretaria" } as const;

function binding(env: WorkerBindings, name: string) {
  const value = env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function validWahaSignature(body: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, signature.toLowerCase());
}

function ackStatus(ackName?: string) {
  if (ackName === "ERROR") return "failed";
  if (ackName === "READ" || ackName === "PLAYED") return "read";
  if (ackName === "DEVICE") return "delivered";
  return "sent";
}

async function persistWahaEvent(payload: WahaWebhookPayload, env: WorkerBindings) {
  const supabaseUrl = binding(env, "SUPABASE_URL");
  const serviceRole = binding(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) throw new Error("WAHA_PERSISTENCE_NOT_CONFIGURED");
  if (!payload.session) return;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: connection, error: connectionError } = await supabase.from("whatsapp_waha_connections")
    .select("tenant_id, instance_id, connected_at").eq("session_name", payload.session).maybeSingle();
  if (connectionError) throw new Error(connectionError.message);
  if (!connection) return;

  if (payload.event === "session.status") {
    const status = wahaStatus(payload.payload?.status);
    const connectedAt = status === "connected" ? connection.connected_at ?? new Date().toISOString() : connection.connected_at;
    const phone = phoneFromWahaId(payload.me?.id);
    const lastError = status === "error" ? "A sessão WAHA falhou e precisa ser reconectada." : null;
    const [{ error: mappingError }, { error: instanceError }] = await Promise.all([
      supabase.from("whatsapp_waha_connections").update({ status, connected_at: connectedAt, last_error: lastError }).eq("instance_id", connection.instance_id),
      supabase.from("whatsapp_instances").update({ status, phone_number: phone, last_connected_at: connectedAt }).eq("id", connection.instance_id),
    ]);
    if (mappingError || instanceError) throw new Error(mappingError?.message ?? instanceError?.message);
    return;
  }

  if (payload.event === "message.ack") {
    if (!payload.payload?.id) return;
    const { error } = await supabase.from("whatsapp_messages").update({ status: ackStatus(payload.payload.ackName) })
      .eq("tenant_id", connection.tenant_id).eq("external_message_id", payload.payload.id);
    if (error) throw new Error(error.message);
    return;
  }

  if (payload.event !== "message" || !payload.payload?.id) return;
  const phone = phoneFromWahaId(payload.payload.from);
  if (!phone) return;
  const body = payload.payload.body?.trim() || `Mensagem ${payload.payload.type ?? "recebida"}`;
  const contactName = payload.payload._data?.notifyName ?? payload.payload._data?.pushName ?? null;
  const { data: existing, error: existingError } = await supabase.from("whatsapp_conversations")
    .select("id, tags, assignment_status, category").eq("tenant_id", connection.tenant_id)
    .eq("instance_id", connection.instance_id).eq("contact_phone", phone).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const { data: conversation, error: conversationError } = existing
    ? { data: existing, error: null }
    : await supabase.from("whatsapp_conversations").insert({
      tenant_id: connection.tenant_id, instance_id: connection.instance_id, contact_phone: phone,
      contact_name: contactName, channel: "whatsapp", assignment_status: "new", category: "triagem",
    }).select("id, tags, assignment_status, category").single();
  if (conversationError || !conversation) throw new Error(conversationError?.message ?? "Não foi possível criar a conversa WAHA.");

  const qualification = qualifyInboundMessage(body);
  const knownQueues = Object.values(QUEUE_LABELS);
  const currentTags = conversation.tags ?? [];
  const manuallyRouted = conversation.category && conversation.category !== "triagem";
  const category = manuallyRouted ? conversation.category as keyof typeof QUEUE_LABELS : qualification.queue;
  const tags = Array.from(new Set([
    ...currentTags.filter((tag: string) => !knownQueues.includes(tag as typeof knownQueues[number])),
    ...(qualification.urgent ? ["Urgente"] : []),
  ]));
  const createdAt = payload.payload.timestamp
    ? new Date(payload.payload.timestamp > 10_000_000_000 ? payload.payload.timestamp : payload.payload.timestamp * 1000).toISOString()
    : new Date().toISOString();
  const { error: ingestError } = await supabase.rpc("ingest_meta_whatsapp_message", {
    p_tenant_id: connection.tenant_id,
    p_conversation_id: conversation.id,
    p_body: body,
    p_external_message_id: payload.payload.id,
    p_created_at: createdAt,
    p_tags: tags,
    p_category: category,
    p_urgent: qualification.urgent,
    p_notification_body: `A conversa foi encaminhada para ${QUEUE_LABELS[category]}. Revise a mensagem e assuma o atendimento.`,
  });
  if (ingestError) throw new Error(ingestError.message);
}

export async function handleWahaWebhook(request: Request, env: WorkerBindings) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  const secret = binding(env, "WAHA_WEBHOOK_HMAC_KEY");
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 1_000_000) return new Response("Payload too large", { status: 413 });
  const body = await request.text();
  if (encoder.encode(body).byteLength > 1_000_000) return new Response("Payload too large", { status: 413 });
  const algorithm = request.headers.get("x-webhook-hmac-algorithm")?.toLowerCase();
  if (algorithm !== "sha512" || !(await validWahaSignature(body, request.headers.get("x-webhook-hmac"), secret))) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: WahaWebhookPayload;
  try { payload = JSON.parse(body) as WahaWebhookPayload; }
  catch { return new Response("Invalid payload", { status: 400 }); }
  try { await persistWahaEvent(payload, env); }
  catch (error) {
    console.error("Failed to persist WAHA webhook", error);
    return new Response("Persistence failed", { status: 500 });
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
}
