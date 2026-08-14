import { getServerEnv } from "@/integrations/supabase/runtime-env.server";

export type WahaSessionStatus = "STOPPED" | "STARTING" | "SCAN_QR_CODE" | "WORKING" | "FAILED" | string;

export type WahaSession = {
  name: string;
  status: WahaSessionStatus;
  me?: { id?: string; pushName?: string } | null;
};

function wahaConfig() {
  const baseUrl = getServerEnv("WAHA_BASE_URL")?.trim().replace(/\/+$/, "");
  const apiKey = getServerEnv("WAHA_API_KEY")?.trim();
  if (!baseUrl || !apiKey) throw new Error("WAHA ainda não foi configurado no servidor do Advora.");
  return { baseUrl, apiKey };
}

export function isWahaConfigured() {
  return Boolean(getServerEnv("WAHA_BASE_URL")?.trim() && getServerEnv("WAHA_API_KEY")?.trim());
}

export async function wahaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, apiKey } = wahaConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) as unknown : null; }
  catch { payload = text ? { message: text } : null; }
  if (!response.ok) {
    const detail = payload as { message?: string; error?: string } | null;
    const error = new Error(detail?.message ?? detail?.error ?? `WAHA retornou HTTP ${response.status}.`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return payload as T;
}

export function wahaSessionName(tenantId: string) {
  return `advora-${tenantId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}

export function wahaStatus(status?: string) {
  if (status === "WORKING") return "connected" as const;
  if (
    status === "STARTING"
    || status === "SCAN_QR_CODE"
    || status === "PASSKEY_REQUIRED"
    || status === "PASSKEY_CONFIRMATION_REQUIRED"
  ) return "connecting" as const;
  if (status === "FAILED") return "error" as const;
  return "disconnected" as const;
}

export function wahaSessionRecoveryAction(status?: string) {
  if (status === "STOPPED") return "start" as const;
  if (status === "FAILED") return "restart" as const;
  return null;
}

export function phoneFromWahaId(value?: string | null) {
  if (!value || !value.endsWith("@c.us")) return null;
  const phone = value.slice(0, -5).replace(/\D/g, "");
  return phone.length >= 10 && phone.length <= 15 ? phone : null;
}
