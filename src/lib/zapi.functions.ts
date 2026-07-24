import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

function baseUrl() {
  const id = process.env.ZAPI_INSTANCE_ID;
  const token = process.env.ZAPI_INSTANCE_TOKEN;
  if (!id || !token) {
    throw new Error(
      "Z-API não configurada. Defina ZAPI_INSTANCE_ID e ZAPI_INSTANCE_TOKEN.",
    );
  }
  return `https://api.z-api.io/instances/${id}/token/${token}`;
}

function clientHeaders() {
  const clientToken = process.env.ZAPI_CLIENT_TOKEN ?? "";
  return {
    "Content-Type": "application/json",
    "Client-Token": clientToken,
  };
}

async function zapiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...clientHeaders(), ...(init?.headers ?? {}) },
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
  .handler(async (): Promise<ZapiStatus> => {
    try {
      const data = await zapiFetch<{
        connected?: boolean;
        session?: boolean;
        smartphoneConnected?: boolean;
        error?: string | null;
      }>("/status");
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
  .handler(async (): Promise<{ image: string | null; error?: string }> => {
    try {
      const data = await zapiFetch<{ value?: string }>("/qr-code/image");
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
  .handler(async (): Promise<ZapiDevice | null> => {
    try {
      return await zapiFetch<ZapiDevice>("/device");
    } catch {
      return null;
    }
  });

export const zapiDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await zapiFetch("/disconnect");
    return { ok: true };
  });

export const zapiRestart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await zapiFetch("/restart");
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
  .handler(async ({ data }) => {
    return await zapiFetch<{ zaapId?: string; messageId?: string; id?: string }>("/send-text", {
      method: "POST",
      body: JSON.stringify({ phone: data.phone, message: data.message }),
    });
  });
