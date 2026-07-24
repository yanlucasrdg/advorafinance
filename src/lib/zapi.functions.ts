import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enforceRateLimit } from "@/lib/rate-limit";

type ZapiStatus = {
  connected: boolean;
  session: boolean;
  smartphoneConnected: boolean;
  needsQrCode?: boolean;
  error?: string | null;
};

type ZapiDevice = {
  phone?: string;
  name?: string;
  imgUrl?: string;
  connected?: boolean;
};

type ZapiCreds = {
  instanceId: string;
  token: string;
  clientToken: string;
};

async function loadTenantCreds(userId: string): Promise<ZapiCreds> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr) throw new Error(profileErr.message);
  const tenantId = profile?.tenant_id;

  if (tenantId) {
    const { data: inst, error: instErr } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("zapi_instance_id, zapi_token, zapi_client_token")
      .eq("tenant_id", tenantId)
      .not("zapi_instance_id", "is", null)
      .not("zapi_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (instErr) throw new Error(instErr.message);
    if (inst?.zapi_instance_id && inst?.zapi_token) {
      return {
        instanceId: inst.zapi_instance_id,
        token: inst.zapi_token,
        clientToken: inst.zapi_client_token ?? "",
      };
    }
  }

  // Fallback to process.env if available
  const envId = process.env.ZAPI_INSTANCE_ID;
  const envToken = process.env.ZAPI_INSTANCE_TOKEN;
  if (envId && envToken) {
    return {
      instanceId: envId,
      token: envToken,
      clientToken: process.env.ZAPI_CLIENT_TOKEN ?? "",
    };
  }

  throw new Error("WhatsApp não configurado para o seu escritório.");
}

function buildBaseUrl(creds: ZapiCreds) {
  return `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.token}`;
}

async function zapiFetch<T>(
  creds: ZapiCreds,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${buildBaseUrl(creds)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Client-Token": creds.clientToken,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const message =
      (json as { error?: string; message?: string })?.error ??
      (json as { message?: string })?.message ??
      `Z-API erro HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as T;
}

export const zapiStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ZapiStatus> => {
    try {
      await enforceRateLimit(context.supabase, "zapi_status");
      const creds = await loadTenantCreds(context.userId);
      const data = await zapiFetch<{
        connected?: boolean;
        session?: boolean;
        smartphoneConnected?: boolean;
        error?: string | null;
      }>(creds, "/status");
      return {
        connected: !!data.connected,
        session: !!data.session,
        smartphoneConnected: !!data.smartphoneConnected,
        needsQrCode: !data.connected,
        error: data.error ?? null,
      };
    } catch (e) {
      return {
        connected: false,
        session: false,
        smartphoneConnected: false,
        needsQrCode: true,
        error: e instanceof Error ? e.message : "Falha ao consultar status",
      };
    }
  });

export const zapiQrCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ image: string | null; error?: string }> => {
    try {
      await enforceRateLimit(context.supabase, "zapi_qr_code");
      const creds = await loadTenantCreds(context.userId);
      const data = await zapiFetch<{ value?: string }>(creds, "/qr-code/image");
      const value = data?.value ?? null;
      if (!value) return { image: null, error: "QR Code indisponível" };
      const image = value.startsWith("data:") ? value : `data:image/png;base64,${value}`;
      return { image };
    } catch (e) {
      return {
        image: null,
        error: e instanceof Error ? e.message : "Falha ao buscar QR Code",
      };
    }
  });

export const zapiDevice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ZapiDevice | null> => {
    try {
      await enforceRateLimit(context.supabase, "zapi_device");
      const creds = await loadTenantCreds(context.userId);
      return await zapiFetch<ZapiDevice>(creds, "/device");
    } catch {
      return null;
    }
  });

export const zapiDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await enforceRateLimit(context.supabase, "zapi_connection_action");
    const creds = await loadTenantCreds(context.userId);
    await zapiFetch(creds, "/disconnect");
    return { ok: true };
  });

export const zapiRestart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await enforceRateLimit(context.supabase, "zapi_connection_action");
    const creds = await loadTenantCreds(context.userId);
    await zapiFetch(creds, "/restart");
    return { ok: true };
  });

export const zapiSendText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string; message: string }) => {
    const phone = String(input?.phone ?? "").replace(/\D/g, "");
    const message = String(input?.message ?? "").trim();
    if (!phone || phone.length < 10) throw new Error("Telefone inválido (use DDI+DDD+número, ex.: 5511999999999).");
    if (!message) throw new Error("Mensagem vazia");
    return { phone, message };
  })
  .handler(async ({ data, context }) => {
    await enforceRateLimit(context.supabase, "zapi_send_text");
    const creds = await loadTenantCreds(context.userId);
    return await zapiFetch<{ zaapId?: string; messageId?: string; id?: string }>(
      creds,
      "/send-text",
      {
        method: "POST",
        body: JSON.stringify({ phone: data.phone, message: data.message }),
      },
    );
  });
