import type { Database } from "@/integrations/supabase/types";
import { createClient } from "@supabase/supabase-js";
import { isBillingPlanId, type BillingPlanId } from "@/lib/billing";

type Bindings = Record<string, unknown>;
type KirvanoProduct = { id?: string; offer_id?: string; is_order_bump?: boolean };
type KirvanoPayload = {
  event?: string;
  checkout_id?: string;
  sale_id?: string;
  status?: string;
  created_at?: string;
  customer?: { email?: string };
  plan?: { charge_frequency?: string; next_charge_date?: string };
  products?: KirvanoProduct[];
  utm?: { utm_term?: string };
};

const ACTIVE_EVENTS = new Set(["SALE_APPROVED", "SUBSCRIPTION_RENEWED"]);
const TERMINAL_EVENTS = new Set(["SALE_REFUNDED", "SALE_CHARGEBACK"]);
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
  return request.headers.get("x-kirvano-token")
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
    const configuredProduct = readBinding(bindings, `KIRVANO_${plan.toUpperCase()}_PRODUCT_ID`);
    if (configuredProduct && configuredProduct === productId) return plan;
  }
  return null;
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
    payload = await request.json() as KirvanoPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!payload.event || !KNOWN_EVENTS.has(payload.event) || !payload.sale_id) {
    return Response.json({ received: true, ignored: true });
  }

  const supabaseUrl = readBinding(bindings, "SUPABASE_URL");
  const serviceKey = readBinding(bindings, "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return new Response("Server configuration error", { status: 503 });
  const admin = createClient<Database>(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const eventKey = `${payload.event}:${payload.sale_id}:${payload.created_at ?? payload.status ?? "unknown"}`;
  const { data: inserted, error: eventError } = await admin
    .from("billing_webhook_events")
    .upsert({ event_key: eventKey, event_type: payload.event, sale_id: payload.sale_id, checkout_id: payload.checkout_id ?? null, processing_status: "received" }, { onConflict: "event_key", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (eventError) return new Response("Persistence error", { status: 500 });
  if (!inserted) return Response.json({ received: true, duplicate: true });

  let tenantId = isUuid(payload.utm?.utm_term) ? payload.utm.utm_term : null;
  if (!tenantId && payload.customer?.email) {
    const { data: owner } = await admin.from("profiles").select("tenant_id").ilike("email", payload.customer.email).not("tenant_id", "is", null).limit(1).maybeSingle();
    tenantId = owner?.tenant_id ?? null;
  }
  const resolvedPlan = resolvePlan(payload, bindings);
  if (!tenantId || !resolvedPlan || !isBillingPlanId(resolvedPlan)) {
    await admin.from("billing_webhook_events").update({ processing_status: "ignored", processed_at: new Date().toISOString(), error_message: !tenantId ? "tenant_not_found" : "offer_not_mapped" }).eq("id", inserted.id);
    return Response.json({ received: true, ignored: true });
  }

  const product = payload.products?.find((entry) => !entry.is_order_bump);
  const nextCharge = normalizeDate(payload.plan?.next_charge_date);
  const now = new Date().toISOString();
  let status: Database["public"]["Enums"]["subscription_status"] = "active";
  let cancelAtPeriodEnd = false;
  if (payload.event === "SUBSCRIPTION_CANCELED") { status = "canceled"; cancelAtPeriodEnd = true; }
  else if (payload.event === "SUBSCRIPTION_EXPIRED") status = "past_due";
  else if (payload.event === "SALE_REFUNDED") status = "refunded";
  else if (payload.event === "SALE_CHARGEBACK") status = "chargeback";

  const { error: subscriptionError } = await admin.from("tenant_subscriptions").upsert({
    tenant_id: tenantId,
    plan: resolvedPlan,
    status,
    provider: "kirvano",
    billing_interval: resolveInterval(payload),
    kirvano_sale_id: payload.sale_id,
    kirvano_checkout_id: payload.checkout_id ?? null,
    kirvano_offer_id: product?.offer_id ?? null,
    kirvano_product_id: product?.id ?? null,
    customer_email: payload.customer?.email ?? null,
    current_period_end: nextCharge,
    cancel_at_period_end: cancelAtPeriodEnd,
    grace_ends_at: status === "past_due" ? new Date(Date.now() + 3 * 86_400_000).toISOString() : null,
    last_event_at: normalizeDate(payload.created_at) ?? now,
    updated_at: now,
  }, { onConflict: "tenant_id" });

  if (subscriptionError) {
    await admin.from("billing_webhook_events").update({ processing_status: "error", processed_at: now, error_message: "subscription_update_failed" }).eq("id", inserted.id);
    return new Response("Subscription update failed", { status: 500 });
  }

  const accessRemains = ACTIVE_EVENTS.has(payload.event) || (payload.event === "SUBSCRIPTION_CANCELED" && nextCharge && new Date(nextCharge) > new Date());
  await admin.from("tenants").update({ plan: accessRemains ? resolvedPlan : "trial", updated_at: now }).eq("id", tenantId);
  await admin.from("billing_webhook_events").update({ tenant_id: tenantId, processing_status: "processed", processed_at: now }).eq("id", inserted.id);
  return Response.json({ received: true });
}

