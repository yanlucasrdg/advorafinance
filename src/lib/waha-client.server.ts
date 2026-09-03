import { getServerEnv } from "@/integrations/supabase/runtime-env.server";

export type WahaSessionStatus = "STOPPED" | "STARTING" | "SCAN_QR_CODE" | "WORKING" | "FAILED" | string;

export type WahaSession = {
  name: string;
  status: WahaSessionStatus;
  me?: { id?: string; pushName?: string } | null;
  config?: Record<string, unknown> & {
    metadata?: Record<string, unknown>;
    ignore?: Record<string, unknown>;
    noweb?: { store?: { enabled?: boolean; fullSync?: boolean } };
    webhooks?: Array<{ url?: string; events?: string[]; hmac?: { key?: string } }>;
  };
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

export function isInboundWahaMessage(event?: string, fromMe?: boolean) {
  return event === "message" && fromMe !== true;
}

export function phoneFromWahaId(value?: string | null) {
  if (typeof value !== "string" || !value) return null;
  const suffix = value.endsWith("@c.us") ? "@c.us" : value.endsWith("@s.whatsapp.net") ? "@s.whatsapp.net" : null;
  if (!suffix) return null;
  const match = value.slice(0, -suffix.length).match(/^(\d+)(?::\d+)?$/);
  const phone = match?.[1] ?? "";
  return phone.length >= 10 && phone.length <= 15 ? phone : null;
}

export function phoneFromWahaPhoneNumber(value?: string | null) {
  if (typeof value !== "string" || !value) return null;
  const fromId = phoneFromWahaId(value);
  if (fromId) return fromId;
  const phone = value.replace(/^\+/, "");
  return /^\d{10,15}$/.test(phone) ? phone : null;
}

export function wahaLidFromId(value?: string | null) {
  return typeof value === "string" && /^\d+@lid$/.test(value) ? value : null;
}

export function wahaMessageCreatedAt(value?: number | string, fallback = new Date()) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return fallback.toISOString();
  const date = new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

type WahaLidLookup = (sessionName: string, lid: string) => Promise<string | null>;

export type WahaContactPayload = {
  chatId?: string;
  from?: string;
  participant?: string;
  _data?: {
    key?: { remoteJid?: string; remoteJidAlt?: string; participant?: string; participantAlt?: string };
    Info?: { Chat?: string; Sender?: string; SenderAlt?: string };
  };
};

const unsupportedChatSuffixes = ["@g.us", "@newsletter", "@broadcast"];

export function wahaInboundContactIdentifiers(payload: WahaContactPayload) {
  const chatIdentifiers = [
    payload.chatId,
    payload.from,
    payload._data?.key?.remoteJid,
    payload._data?.Info?.Chat,
  ];
  if (chatIdentifiers.some((value) => typeof value === "string" && unsupportedChatSuffixes.some((suffix) => value.endsWith(suffix)))) {
    return [];
  }
  return [
    payload.from,
    payload.chatId,
    payload._data?.key?.remoteJidAlt,
    payload._data?.Info?.SenderAlt,
    payload._data?.key?.participantAlt,
    payload._data?.key?.remoteJid,
    payload._data?.Info?.Sender,
    payload.participant,
    payload._data?.key?.participant,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function lookupWahaPhoneByLid(sessionName: string, lid: string) {
  const mapping = await wahaFetch<{ pn?: string | null }>(
    `/api/${encodeURIComponent(sessionName)}/lids/${encodeURIComponent(lid)}`,
  );
  return mapping.pn ?? null;
}

export async function resolveWahaContactPhone(
  sessionName: string,
  identifiers: Array<string | null | undefined>,
  lookupLid: WahaLidLookup = lookupWahaPhoneByLid,
) {
  for (const identifier of identifiers) {
    const phone = phoneFromWahaId(identifier);
    if (phone) return phone;
  }
  const lid = identifiers.map(wahaLidFromId).find((value): value is string => Boolean(value));
  if (!lid) return null;
  return phoneFromWahaPhoneNumber(await lookupLid(sessionName, lid));
}
