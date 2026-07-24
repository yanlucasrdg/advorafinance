import { createServerFn } from "@tanstack/react-start";
import { getServerEnv } from "@/integrations/supabase/runtime-env.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enforceRateLimit } from "@/lib/rate-limit";

type MetaChannel = { id: string; tenantId: string; phoneNumberId: string };

function configuredPhoneNumberId() {
  const value = getServerEnv("META_WHATSAPP_PHONE_NUMBER_ID")?.trim();
  if (!value) throw new Error("Falta configurar META_WHATSAPP_PHONE_NUMBER_ID nos Secrets do Worker.");
  return value;
}

async function loadOrCreateChannel(userId: string): Promise<MetaChannel> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const phoneNumberId = configuredPhoneNumberId();
  const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile?.tenant_id) throw new Error("Seu usuário não está vinculado a um escritório.");

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("whatsapp_instances").select("id, tenant_id").eq("external_instance_id", phoneNumberId).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    if (existing.tenant_id !== profile.tenant_id) throw new Error("Este número do WhatsApp já está vinculado a outro escritório.");
    return { id: existing.id, tenantId: existing.tenant_id, phoneNumberId };
  }

  const { data: created, error: createError } = await supabaseAdmin.from("whatsapp_instances").insert({
    tenant_id: profile.tenant_id,
    user_id: userId,
    instance_name: "WhatsApp Business (Meta)",
    external_instance_id: phoneNumberId,
    status: "connected",
    last_connected_at: new Date().toISOString(),
    metadata: { provider: "meta_cloud_api", phone_number_id: phoneNumberId },
  }).select("id, tenant_id").single();
  if (createError) throw new Error(createError.message);
  return { id: created.id, tenantId: created.tenant_id, phoneNumberId };
}

async function findOrCreateConversation(channel: MetaChannel, phone: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const normalizedPhone = phone.replace(/\D/g, "");
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("whatsapp_conversations").select("id").eq("instance_id", channel.id)
    .in("contact_phone", [normalizedPhone, `+${normalizedPhone}`]).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return existing.id;
  const { data: created, error: createError } = await supabaseAdmin.from("whatsapp_conversations").insert({
    tenant_id: channel.tenantId,
    instance_id: channel.id,
    contact_phone: normalizedPhone,
    channel: "whatsapp",
    assignment_status: "new",
  }).select("id").single();
  if (createError) throw new Error(createError.message);
  return created.id;
}

export const metaWhatsAppConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const channel = await loadOrCreateChannel(context.userId);
    return { connected: true, phoneNumberId: channel.phoneNumberId };
  });

export const metaWhatsAppSendText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string; message: string }) => {
    const phone = String(input?.phone ?? "").replace(/\D/g, "");
    const message = String(input?.message ?? "").trim();
    if (phone.length < 10 || phone.length > 15) throw new Error("Telefone inválido. Use DDI, DDD e número.");
    if (!message) throw new Error("Mensagem vazia.");
    if (message.length > 4096) throw new Error("A mensagem excede o limite de 4096 caracteres.");
    return { phone, message };
  })
  .handler(async ({ data, context }) => {
    await enforceRateLimit(context.supabase, "zapi_send_text");
    const accessToken = getServerEnv("META_WHATSAPP_ACCESS_TOKEN")?.trim();
    if (!accessToken) throw new Error("Falta configurar META_WHATSAPP_ACCESS_TOKEN nos Secrets do Worker.");
    const channel = await loadOrCreateChannel(context.userId);
    const response = await fetch(`https://graph.facebook.com/v23.0/${channel.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: data.phone, type: "text", text: { preview_url: false, body: data.message } }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string }; messages?: Array<{ id?: string }> };
    if (!response.ok) throw new Error(payload.error?.message ?? `Meta retornou HTTP ${response.status}.`);
    const conversationId = await findOrCreateConversation(channel, data.phone);
    const externalMessageId = payload.messages?.[0]?.id ?? null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: messageError } = await supabaseAdmin.from("whatsapp_messages").insert({
      tenant_id: channel.tenantId, conversation_id: conversationId, direction: "outbound", body: data.message,
      status: "sent", external_message_id: externalMessageId,
    });
    if (messageError) throw new Error(messageError.message);
    await supabaseAdmin.from("whatsapp_conversations").update({ last_message: data.message, last_message_at: new Date().toISOString(), unread_count: 0 }).eq("id", conversationId);
    return { conversationId, externalMessageId };
  });
