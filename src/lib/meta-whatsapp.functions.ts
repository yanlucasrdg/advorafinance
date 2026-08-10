import { createServerFn } from "@tanstack/react-start";
import { getServerEnv } from "@/integrations/supabase/runtime-env.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptMetaAccessToken, decryptMetaAccessToken } from "@/lib/meta-whatsapp-credentials.server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireActiveSubscription, requireServerRole } from "@/lib/authorization.server";
import { hasWahaConnection, sendWahaText } from "@/lib/waha.functions";

type MetaChannel = { id: string; tenantId: string; phoneNumberId: string; accessToken: string };
type MetaConnectionRow = { instance_id: string; tenant_id: string; phone_number_id: string; business_account_id: string; access_token_ciphertext: string; status: string; connected_at: string | null; last_error: string | null };

async function tenantForUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.tenant_id) throw new Error("Seu usuário não está vinculado a um escritório.");
  return data.tenant_id;
}

async function configuredEmbeddedSignup() {
  const appId = getServerEnv("META_APP_ID")?.trim();
  const configId = getServerEnv("META_EMBEDDED_SIGNUP_CONFIG_ID")?.trim();
  return { appId: appId || null, configId: configId || null, ready: Boolean(appId && configId) };
}

async function loadMetaChannel(userId: string): Promise<MetaChannel> {
  const tenantId = await tenantForUser(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("whatsapp_meta_connections")
    .select("instance_id, tenant_id, phone_number_id, business_account_id, access_token_ciphertext, status, connected_at, last_error")
    .eq("tenant_id", tenantId).eq("status", "connected").maybeSingle() as { data: MetaConnectionRow | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Este escritório ainda não conectou um WhatsApp Business.");
  return { id: data.instance_id, tenantId, phoneNumberId: data.phone_number_id, accessToken: await decryptMetaAccessToken(data.access_token_ciphertext) };
}

async function subscribeAppToBusinessAccount(accessToken: string, businessAccountId: string) {
  const response = await fetch(`https://graph.facebook.com/v25.0/${businessAccountId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? "Não foi possível ativar os webhooks deste WhatsApp.");
  }
}

async function exchangeEmbeddedSignupCode(code: string) {
  const appId = getServerEnv("META_APP_ID")?.trim();
  const appSecret = getServerEnv("META_APP_SECRET")?.trim();
  if (!appId || !appSecret) throw new Error("A conexão profissional com a Meta ainda não foi configurada no Worker.");
  const response = await fetch("https://graph.facebook.com/v25.0/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: appId, client_secret: appSecret, code }),
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!response.ok || !payload.access_token) throw new Error(payload.error?.message ?? "A Meta não autorizou a conexão do WhatsApp.");
  return { accessToken: payload.access_token, expiresIn: payload.expires_in };
}

async function findOrCreateConversation(channel: MetaChannel, phone: string, clientId?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const normalizedPhone = phone.replace(/\D/g, "");
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("whatsapp_conversations").select("id").eq("instance_id", channel.id)
    .in("contact_phone", [normalizedPhone, `+${normalizedPhone}`]).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    if (clientId) await supabaseAdmin.from("whatsapp_conversations").update({ client_id: clientId }).eq("id", existing.id);
    return existing.id;
  }
  const { data: created, error: createError } = await supabaseAdmin.from("whatsapp_conversations").insert({
    tenant_id: channel.tenantId, instance_id: channel.id, contact_phone: normalizedPhone,
    client_id: clientId ?? null, channel: "whatsapp", assignment_status: "new",
  }).select("id").single();
  if (createError) throw new Error(createError.message);
  return created.id;
}

export const metaWhatsAppStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireServerRole(context, ["master_admin", "owner", "admin"]);
    const tenantId = await tenantForUser(context.userId);
    const config = await configuredEmbeddedSignup();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("whatsapp_meta_connections")
      .select("phone_number_id, business_account_id, status, connected_at, last_error")
      .eq("tenant_id", tenantId).maybeSingle() as { data: Omit<MetaConnectionRow, "instance_id" | "tenant_id" | "access_token_ciphertext"> | null };
    return { connection: data, embeddedSignup: config };
  });

export const metaWhatsAppCompleteEmbeddedSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { code: string; businessAccountId: string; phoneNumberId: string; displayPhoneNumber?: string }) => {
    const code = String(input?.code ?? "").trim();
    const businessAccountId = String(input?.businessAccountId ?? "").trim();
    const phoneNumberId = String(input?.phoneNumberId ?? "").trim();
    const displayPhoneNumber = String(input?.displayPhoneNumber ?? "").trim();
    if (!code || !businessAccountId || !phoneNumberId) throw new Error("A Meta não retornou os dados necessários para conectar o WhatsApp.");
    return { code, businessAccountId, phoneNumberId, displayPhoneNumber };
  })
  .handler(async ({ data, context }) => {
    await requireServerRole(context, ["master_admin", "owner", "admin"]);
    await requireActiveSubscription(context);
    const tenantId = await tenantForUser(context.userId);
    const { accessToken, expiresIn } = await exchangeEmbeddedSignupCode(data.code);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: taken } = await supabaseAdmin.from("whatsapp_instances").select("id, tenant_id").eq("external_instance_id", data.phoneNumberId).maybeSingle();
    if (taken && taken.tenant_id !== tenantId) throw new Error("Este número já está conectado a outro escritório no Advora.");

    let instanceId = taken?.id;
    if (!instanceId) {
      const { data: created, error } = await supabaseAdmin.from("whatsapp_instances").insert({
        tenant_id: tenantId, user_id: context.userId, instance_name: "WhatsApp Business (Meta)",
        external_instance_id: data.phoneNumberId, phone_number: data.displayPhoneNumber || null,
        status: "connected", last_connected_at: new Date().toISOString(),
      }).select("id").single();
      if (error) throw new Error(error.message);
      instanceId = created.id;
    } else {
      await supabaseAdmin.from("whatsapp_instances").update({ status: "connected", phone_number: data.displayPhoneNumber || null, last_connected_at: new Date().toISOString() }).eq("id", instanceId);
    }

    const connectedAt = new Date().toISOString();
    const accessTokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    const { error: connectionError } = await supabaseAdmin.from("whatsapp_meta_connections").upsert({
      tenant_id: tenantId, instance_id: instanceId, business_account_id: data.businessAccountId,
      phone_number_id: data.phoneNumberId, access_token_ciphertext: await encryptMetaAccessToken(accessToken),
      access_token_expires_at: accessTokenExpiresAt, status: "connected", connected_at: connectedAt, last_error: null,
    }, { onConflict: "tenant_id" });
    if (connectionError) throw new Error(connectionError.message);
    await subscribeAppToBusinessAccount(accessToken, data.businessAccountId);
    return { connected: true, phoneNumberId: data.phoneNumberId };
  });

export const metaWhatsAppSendText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { phone: string; message: string; clientId?: string }) => {
    const phone = String(input?.phone ?? "").replace(/\D/g, "");
    const message = String(input?.message ?? "").trim();
    if (phone.length < 10 || phone.length > 15) throw new Error("Telefone inválido. Use DDI, DDD e número.");
    if (!message) throw new Error("Mensagem vazia.");
    if (message.length > 4096) throw new Error("A mensagem excede o limite de 4096 caracteres.");
    return { phone, message, clientId: typeof input?.clientId === "string" && input.clientId.length > 0 ? input.clientId : undefined };
  })
  .handler(async ({ data, context }) => {
    await requireServerRole(context, ["master_admin", "owner", "admin", "lawyer", "secretary"]);
    await requireActiveSubscription(context);
    await enforceRateLimit(context.supabase, "zapi_send_text");
    if (await hasWahaConnection(context.userId)) {
      return await sendWahaText(context.userId, data);
    }
    const channel = await loadMetaChannel(context.userId);
    const response = await fetch(`https://graph.facebook.com/v25.0/${channel.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${channel.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: data.phone, type: "text", text: { preview_url: false, body: data.message } }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string }; messages?: Array<{ id?: string }> };
    if (!response.ok) throw new Error(payload.error?.message ?? `Meta retornou HTTP ${response.status}.`);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.clientId) {
      const { data: client } = await supabaseAdmin.from("clients").select("id").eq("id", data.clientId).eq("tenant_id", channel.tenantId).maybeSingle();
      if (!client) throw new Error("Cliente não pertence ao escritório atual.");
    }
    const conversationId = await findOrCreateConversation(channel, data.phone, data.clientId);
    const { error: messageError } = await supabaseAdmin.from("whatsapp_messages").insert({
      tenant_id: channel.tenantId, conversation_id: conversationId, direction: "outbound", body: data.message,
      status: "sent", external_message_id: payload.messages?.[0]?.id ?? null,
    });
    if (messageError) throw new Error(messageError.message);
    await supabaseAdmin.from("whatsapp_conversations").update({ last_message: data.message, last_message_at: new Date().toISOString(), unread_count: 0 }).eq("id", conversationId);
    return { conversationId, externalMessageId: payload.messages?.[0]?.id ?? null, provider: "meta" as const };
  });
