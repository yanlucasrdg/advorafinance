import type { Database } from "@/integrations/supabase/types";
import { createClient } from "@supabase/supabase-js";
import type { BillingPlanId } from "@/lib/billing";

type Bindings = Record<string, unknown>;
type KirvanoProduct = { id?: string; offer_id?: string; is_order_bump?: boolean };
type KirvanoPayload = {
  event?: string;
  checkout_id?: string;
  sale_id?: string;
  status?: string;
  created_at?: string;
  customer?: { email?: string };
  plan?: { charge_frequency?: string; next_charge_date?: string; charge_number?: number };
  products?: KirvanoProduct[];
  utm?: { utm_term?: string };
};

const ACTIVE_EVENTS = new Set(["SALE_APPROVED", "SUBSCRIPTION_RENEWED"]);
const TERMINAL_EVENTS = new Set(["SALE_REFUNDED", "SALE_CHARGEBACK", "SALE_MED"]);
const KNOWN_EVENTS = new Set([...ACTIVE_EVENTS, ...TERMINAL_EVENTS, "SUBSCRIPTION_CANCELED", "SUBSCRIPTION_EXPIRED"]);

function readBinding(bindings: Bindings, key: string): string | undefined {
  const value = bindings[key] ?? process.env[key];
  return typeof value === "string" && value.length ? value : undefined;
}

function tokenMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const normalized = received.startsWith("Bearer ") ? received.slice(7) : received;
  if (normalized.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= normalized.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}

function webhookToken(request: Request): string | null {
  return request.headers.get("security-token")
    ?? request.headers.get("x-kirvano-token")
    ?? request.headers.get("x-webhook-token")
    ?? request.headers.get("authorization")
    ?? request.headers.get("token");
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const withTimezone = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}-03:00` : value;
  const date = new Date(withTimezone);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resolvePlan(payload: KirvanoPayload, bindings: Bindings): BillingPlanId | null {
  const product = payload.products?.find((entry) => !entry.is_order_bump);
  const offerId = product?.offer_id;
  const productId = product?.id;
  for (const plan of ["essential", "performance", "business"] as const) {
    for (const interval of ["MONTHLY", "ANNUAL"] as const) {
      const configuredOffer = readBinding(bindings, `KIRVANO_${plan.toUpperCase()}_${interval}_OFFER_ID`);
      if (configuredOffer && configuredOffer === offerId) return plan;
    }
  }
  const matchingProducts = (["essential", "performance", "business"] as const)
    .filter(plan => productId && readBinding(bindings, `KIRVANO_${plan.toUpperCase()}_PRODUCT_ID`) === productId);
  return matchingProducts.length === 1 ? matchingProducts[0] : null;
}

function resolveInterval(payload: KirvanoPayload): "monthly" | "annual" | null {
  if (payload.plan?.charge_frequency === "MONTHLY") return "monthly";
  if (payload.plan?.charge_frequency === "ANNUALLY") return "annual";
  return null;
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export async function handleKirvanoWebhook(request: Request, bindings: Bindings): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const expectedToken = readBinding(bindings, "KIRVANO_WEBHOOK_TOKEN");
  if (!expectedToken) return new Response("Webhook not configured", { status: 503 });
  if (!tokenMatches(webhookToken(request), expectedToken)) return new Response("Unauthorized", { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64_000) return new Response("Payload too large", { status: 413 });

  let payload: KirvanoPayload;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 64_000) return new Response("Payload too large", { status: 413 });
    payload = JSON.parse(rawBody) as KirvanoPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || (payload.products != null && (!Array.isArray(payload.products)
          || payload.products.some(product => !product || typeof product !== "object")))) {
    return new Response("Invalid payload", { status: 400 });
  }
  if (!payload.event || !KNOWN_EVENTS.has(payload.event) || !payload.sale_id) {
    return Response.json({ received: true, ignored: true });
  }

  const supabaseUrl = readBinding(bindings, "SUPABASE_URL");
  const serviceKey = readBinding(bindings, "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return new Response("Server configuration error", { status: 503 });
  const admin = createClient<Database>(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const eventKey = `${payload.event}:${payload.sale_id}:${payload.plan?.charge_number ?? payload.created_at ?? payload.status ?? "unknown"}`;
  const resolvedPlan = resolvePlan(payload, bindings);
  if (!resolvedPlan) return new Response("Unmapped billing offer", { status: 422 });
  const product = payload.products?.find((entry) => !entry.is_order_bump);
  let status: Database["public"]["Enums"]["subscription_status"] = "active";
  if (payload.event === "SUBSCRIPTION_CANCELED") status = "canceled";
  else if (payload.event === "SUBSCRIPTION_EXPIRED") status = "past_due";
  else if (payload.event === "SALE_REFUNDED" || payload.event === "SALE_MED") status = "refunded";
  else if (payload.event === "SALE_CHARGEBACK") status = "chargeback";

  const { data, error } = await admin.rpc("apply_kirvano_event", { p_event: {
    key: eventKey, event: payload.event, sale: payload.sale_id, checkout: payload.checkout_id ?? null,
    tenant: isUuid(payload.utm?.utm_term) ? payload.utm.utm_term : null, email: payload.customer?.email ?? null,
    plan: resolvedPlan, status, interval: resolveInterval(payload), product: product?.id ?? null,
    offer: product?.offer_id ?? null, at: normalizeDate(payload.created_at) ?? new Date().toISOString(),
    period_end: normalizeDate(payload.plan?.next_charge_date),
  } });
  if (error) return new Response("Billing event could not be applied", { status: 500 });
  return Response.json({ received: true, result: data });
}
