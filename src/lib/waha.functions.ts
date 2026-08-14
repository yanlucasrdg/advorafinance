import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getServerEnv } from "@/integrations/supabase/runtime-env.server";
import { requireActiveSubscription, requireServerRole } from "@/lib/authorization.server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isWahaConfigured, phoneFromWahaId, wahaFetch, wahaSessionName, wahaSessionRecoveryAction, wahaStatus, type WahaSession } from "@/lib/waha-client.server";

type WahaConnection = { instance_id: string; tenant_id: string; session_name: string; status: string; connected_at: string | null; last_error: string | null };

async function tenantForUser(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.tenant_id) throw new Error("Seu usuário não está vinculado a um escritório.");
  return data.tenant_id;
}

async function loadWahaConnection(userId: string): Promise<WahaConnection> {
  const tenantId = await tenantForUser(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("whatsapp_waha_connections")
    .select("instance_id, tenant_id, session_name, status, connected_at, last_error")
    .eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Este escritório ainda não conectou o WhatsApp pelo WAHA.");
  return data;
}

async function syncSession(connection: WahaConnection, session: WahaSession) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const status = wahaStatus(session.status);
  const phone = phoneFromWahaId(session.me?.id);
  const connectedAt = status === "connected" ? connection.connected_at ?? new Date().toISOString() : connection.connected_at;
  await Promise.all([
    supabaseAdmin.from("whatsapp_waha_connections").update({ status, connected_at: connectedAt, last_error: status === "error" ? "A sessão WAHA falhou e precisa ser reconectada." : null }).eq("tenant_id", connection.tenant_id),
    supabaseAdmin.from("whatsapp_instances").update({ status, phone_number: phone, last_connected_at: connectedAt }).eq("id", connection.instance_id),
  ]);
  return { status, phone, connectedAt };
}

export async function hasWahaConnection(userId: string) {
  try {
    await loadWahaConnection(userId);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "Este escritório ainda não conectou o WhatsApp pelo WAHA.") return false;
    throw error;
  }
}

export async function hasWorkingWaha(userId: string) {
  if (!isWahaConfigured() || !(await hasWahaConnection(userId))) return false;
  try {
    const connection = await loadWahaConnection(userId);
    const session = await wahaFetch<WahaSession>(`/api/sessions/${encodeURIComponent(connection.session_name)}`);
    return session.status === "WORKING";
  } catch {
    return false;
  }
}

export async function sendWahaText(userId: string, data: { phone: string; message: string; clientId?: string }) {
  const connection = await loadWahaConnection(userId);
  const session = await wahaFetch<WahaSession>(`/api/sessions/${encodeURIComponent(connection.session_name)}`);
  if (session.status !== "WORKING") throw new Error("A sessão WAHA não está conectada. Abra Integrações e leia o QR Code.");
  const exists = await wahaFetch<{ numberExists?: boolean; chatId?: string }>(
    `/api/contacts/check-exists?phone=${encodeURIComponent(data.phone)}&session=${encodeURIComponent(connection.session_name)}`,
  );
  if (!exists.numberExists || !exists.chatId) throw new Error("Este número não foi encontrado no WhatsApp.");
  const payload = await wahaFetch<{ id?: string }>("/api/sendText", {
    method: "POST",
    body: JSON.stringify({ session: connection.session_name, chatId: exists.chatId, text: data.message, linkPreview: false }),
  });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (data.clientId) {
    const { data: client } = await supabaseAdmin.from("clients").select("id").eq("id", data.clientId).eq("tenant_id", connection.tenant_id).maybeSingle();
    if (!client) throw new Error("Cliente não pertence ao escritório atual.");
  }
  const { data: existing } = await supabaseAdmin.from("whatsapp_conversations").select("id")
    .eq("instance_id", connection.instance_id).in("contact_phone", [data.phone, `+${data.phone}`]).maybeSingle();
  let conversationId = existing?.id;
  if (!conversationId) {
    const { data: created, error } = await supabaseAdmin.from("whatsapp_conversations").insert({
      tenant_id: connection.tenant_id, instance_id: connection.instance_id, contact_phone: data.phone,
      client_id: data.clientId ?? null, channel: "whatsapp", assignment_status: "new",
    }).select("id").single();
    if (error) throw new Error(error.message);
    conversationId = created.id;
  } else if (data.clientId) {
    await supabaseAdmin.from("whatsapp_conversations").update({ client_id: data.clientId }).eq("id", conversationId);
  }
  const { data: persistedMessage, error: messageError } = await supabaseAdmin.from("whatsapp_messages").insert({
    tenant_id: connection.tenant_id, conversation_id: conversationId, direction: "outbound", body: data.message,
    status: "sent", external_message_id: payload.id ?? null,
  }).select("id, conversation_id, direction, body, created_at, status").single();
  if (messageError || !persistedMessage) throw new Error(messageError?.message ?? "Não foi possível registrar a mensagem enviada.");
  await supabaseAdmin.from("whatsapp_conversations").update({ last_message: data.message, last_message_at: new Date().toISOString(), unread_count: 0 }).eq("id", conversationId);
  return { conversationId, externalMessageId: payload.id ?? null, provider: "waha" as const, message: persistedMessage };
}

export const wahaWhatsAppStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireServerRole(context, ["master_admin", "owner", "admin"]);
    const configured = isWahaConfigured() && Boolean(getServerEnv("WAHA_WEBHOOK_URL")?.trim() && getServerEnv("WAHA_WEBHOOK_HMAC_KEY")?.trim());
    if (!configured) return { configured: false, connection: null, qrRequired: false };
    try {
      const connection = await loadWahaConnection(context.userId);
      const session = await wahaFetch<WahaSession>(`/api/sessions/${encodeURIComponent(connection.session_name)}`);
      const synced = await syncSession(connection, session);
      return { configured: true, connection: { ...connection, ...synced, sessionStatus: session.status }, qrRequired: session.status === "SCAN_QR_CODE" };
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 404 || (error instanceof Error && error.message.includes("ainda não conectou"))) {
        return { configured: true, connection: null, qrRequired: false };
      }
      throw error;
    }
  });

export const wahaWhatsAppConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireServerRole(context, ["master_admin", "owner", "admin"]);
    await requireActiveSubscription(context);
    await enforceRateLimit(context.supabase, "zapi_connection_action");
    const webhookUrl = getServerEnv("WAHA_WEBHOOK_URL")?.trim();
    const webhookSecret = getServerEnv("WAHA_WEBHOOK_HMAC_KEY")?.trim();
    if (!webhookUrl || !webhookSecret) throw new Error("O webhook seguro do WAHA ainda não foi configurado.");
    const tenantId = await tenantForUser(context.userId);
    const sessionName = wahaSessionName(tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existingConnection } = await supabaseAdmin.from("whatsapp_waha_connections")
      .select("instance_id, tenant_id, session_name, status, connected_at, last_error").eq("tenant_id", tenantId).maybeSingle();
    let instanceId = existingConnection?.instance_id;
    if (!instanceId) {
      const { data: instance, error } = await supabaseAdmin.from("whatsapp_instances").insert({
        tenant_id: tenantId, user_id: context.userId, instance_name: "WhatsApp (WAHA)",
        external_instance_id: sessionName, status: "connecting",
      }).select("id").single();
      if (error) throw new Error(error.message);
      instanceId = instance.id;
      const { error: mappingError } = await supabaseAdmin.from("whatsapp_waha_connections").insert({
        tenant_id: tenantId, instance_id: instanceId, session_name: sessionName, status: "connecting",
      });
      if (mappingError) throw new Error(mappingError.message);
    }
    const config = {
      name: sessionName,
      config: {
        metadata: { "advora.tenant_id": tenantId },
        ignore: { status: true, groups: true, channels: true },
        webhooks: [{
          url: webhookUrl,
          events: ["message", "message.ack", "session.status"],
          hmac: { key: webhookSecret },
          retries: { policy: "exponential", delaySeconds: 2, attempts: 8 },
        }],
      },
    };
    let session: WahaSession;
    try {
      session = await wahaFetch<WahaSession>(`/api/sessions/${encodeURIComponent(sessionName)}`);
      const recoveryAction = wahaSessionRecoveryAction(session.status);
      if (recoveryAction) {
        session = await wahaFetch<WahaSession>(`/api/sessions/${encodeURIComponent(sessionName)}/${recoveryAction}`, { method: "POST", body: "{}" });
      }
    } catch (error) {
      if ((error as Error & { status?: number }).status !== 404) throw error;
      session = await wahaFetch<WahaSession>("/api/sessions", { method: "POST", body: JSON.stringify(config) });
    }
    const connection = existingConnection ?? { instance_id: instanceId, tenant_id: tenantId, session_name: sessionName, status: "connecting", connected_at: null, last_error: null };
    return { ...(await syncSession(connection, session)), sessionStatus: session.status };
  });

export const wahaWhatsAppQrCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireServerRole(context, ["master_admin", "owner", "admin"]);
    await enforceRateLimit(context.supabase, "zapi_qr_code");
    const connection = await loadWahaConnection(context.userId);
    const sessionName = encodeURIComponent(connection.session_name);
    let lastStatus = "UNKNOWN";

    for (let attempt = 0; attempt < 12; attempt += 1) {
      let session = await wahaFetch<WahaSession>(`/api/sessions/${sessionName}`);
      lastStatus = session.status;

      const recoveryAction = wahaSessionRecoveryAction(session.status);
      if (recoveryAction) {
        session = await wahaFetch<WahaSession>(`/api/sessions/${sessionName}/${recoveryAction}`, { method: "POST", body: "{}" });
        lastStatus = session.status;
      }

      if (session.status === "WORKING") return { image: null, connected: true };

      if (session.status === "SCAN_QR_CODE") {
        try {
          const qr = await wahaFetch<{ mimetype?: string; data?: string }>(`/api/${sessionName}/auth/qr`, {
            headers: { Accept: "application/json" },
          });
          return {
            image: qr.data ? `data:${qr.mimetype || "image/png"};base64,${qr.data}` : null,
            connected: false,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (!message.includes("Session status is not as expected") || attempt === 11) throw error;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(`A sessão WAHA ainda está sendo preparada (${lastStatus}). Aguarde alguns segundos e tente novamente.`);
  });
