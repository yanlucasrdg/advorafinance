import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { BILLING_PLANS, normalizeLegacyPlan } from "@/lib/billing";

const CheckoutSchema = z.object({
  plan: z.enum(["essential", "performance", "business"]),
  interval: z.enum(["monthly", "annual"]),
});

type AuthenticatedContext = { supabase: SupabaseClient<Database>; userId: string };

async function getTenantContext(context: AuthenticatedContext) {
  const { data: profile, error } = await context.supabase
    .from("profiles")
    .select("tenant_id, full_name, email")
    .eq("id", context.userId)
    .maybeSingle();
  if (error || !profile?.tenant_id) throw new Error("Escritório não encontrado.");
  return { ...profile, tenant_id: profile.tenant_id as string };
}

async function requireOwner(context: AuthenticatedContext) {
  const profile = await getTenantContext(context);
  const { data: role } = await context.supabase
    .from("user_roles")
    .select("id")
    .eq("tenant_id", profile.tenant_id)
    .eq("user_id", context.userId)
    .eq("role", "owner")
    .maybeSingle();
  if (!role) throw new Error("Apenas o proprietário pode alterar a assinatura.");
  return profile;
}

export const getBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const profile = await getTenantContext(context);
    const tenantId = profile.tenant_id;
    const [tenantResult, subscriptionResult, usersResult, casesResult] = await Promise.all([
      context.supabase.from("tenants").select("plan").eq("id", tenantId).single(),
      context.supabase.from("tenant_subscriptions").select("plan, status, billing_interval, current_period_end, trial_ends_at, cancel_at_period_end, provider").eq("tenant_id", tenantId).maybeSingle(),
      context.supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      context.supabase.from("cases").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("deleted_at", null),
    ]);

    if (tenantResult.error) throw new Error(tenantResult.error.message);
    if (subscriptionResult.error) throw new Error(subscriptionResult.error.message);

    const subscription = subscriptionResult.data;
    const plan = normalizeLegacyPlan(subscription?.plan ?? tenantResult.data.plan);
    return {
      plan,
      status: subscription?.status ?? "trialing",
      billingInterval: subscription?.billing_interval ?? null,
      currentPeriodEnd: subscription?.current_period_end ?? null,
      trialEndsAt: subscription?.trial_ends_at ?? null,
      cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
      provider: subscription?.provider ?? "kirvano",
      usage: { users: usersResult.count ?? 0, cases: casesResult.count ?? 0 },
      limits: plan === "trial" ? { users: 2, cases: 50, storageGb: 1, aiCredits: 30, automations: 3 } : BILLING_PLANS[plan].limits,
    };
  });

export const createKirvanoCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => CheckoutSchema.parse(data))
  .handler(async ({ data, context }) => {
    const profile = await requireOwner(context);
    const { getServerEnv } = await import("@/integrations/supabase/runtime-env.server");
    const envName = `KIRVANO_${data.plan.toUpperCase()}_${data.interval.toUpperCase()}_CHECKOUT_URL`;
    const checkoutUrl = getServerEnv(envName);
    if (!checkoutUrl) throw new Error(`Checkout ainda não configurado para o plano ${BILLING_PLANS[data.plan].name}.`);

    let url: URL;
    try {
      url = new URL(checkoutUrl);
    } catch {
      throw new Error(`A URL configurada em ${envName} é inválida.`);
    }
    if (url.protocol !== "https:" || url.hostname !== "pay.kirvano.com") {
      throw new Error("O checkout deve usar uma URL segura do domínio pay.kirvano.com.");
    }

    if (profile.full_name) url.searchParams.set("customer.name", profile.full_name);
    if (profile.email) url.searchParams.set("customer.email", profile.email);
    url.searchParams.set("utm_source", "advora");
    url.searchParams.set("utm_medium", "app");
    url.searchParams.set("utm_campaign", `upgrade_${data.plan}_${data.interval}`);
    url.searchParams.set("utm_term", profile.tenant_id);
    return { url: url.toString() };
  });
