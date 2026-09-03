import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeRoles, type AppRole } from "@/lib/permissions";

export type AuthenticatedServerContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export async function getServerAuthorization(context: AuthenticatedServerContext) {
  const [{ data: profile, error: profileError }, { data: roleRows, error: roleError }] =
    await Promise.all([
      context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
    ]);

  if (profileError || roleError || !profile?.tenant_id) {
    throw new Error("Não foi possível identificar o escritório atual.");
  }

  return {
    tenantId: profile.tenant_id,
    roles: normalizeRoles((roleRows ?? []).map((row) => row.role)),
  };
}

export async function requireServerRole(
  context: AuthenticatedServerContext,
  allowed: readonly AppRole[],
) {
  const authorization = await getServerAuthorization(context);
  if (!authorization.roles.some((role) => allowed.includes(role))) {
    throw new Error("Seu perfil não possui permissão para executar esta ação.");
  }
  return authorization;
}

export async function requireActiveSubscription(context: AuthenticatedServerContext) {
  const authorization = await getServerAuthorization(context);
  const { data, error } = await context.supabase
    .from("tenant_subscriptions")
    .select("status, provider, trial_ends_at, current_period_end, grace_ends_at")
    .eq("tenant_id", authorization.tenantId)
    .maybeSingle();
  if (error || !data) throw new Error("Não foi possível validar a assinatura do escritório.");

  const now = Date.now();
  const manuallyManaged = data.provider === "manual";
  const active =
    (manuallyManaged && data.status !== "suspended") ||
    data.status === "active" ||
    (data.status === "trialing" &&
      !!data.trial_ends_at &&
      new Date(data.trial_ends_at).getTime() > now) ||
    (data.status === "canceled" &&
      !!data.current_period_end &&
      new Date(data.current_period_end).getTime() > now) ||
    (data.status === "past_due" &&
      !!data.grace_ends_at &&
      new Date(data.grace_ends_at).getTime() > now);
  if (!active) throw new Error("A assinatura deste escritório não está ativa.");
  return authorization;
}
