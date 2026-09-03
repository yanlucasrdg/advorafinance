import type { AppModule } from "@/lib/permissions";

export const ADMIN_PLANS = {
  free: {
    id: "free",
    name: "Free",
    storedPlan: "trial",
    description: "Operação essencial para conhecer a plataforma.",
    modules: [
      "dashboard",
      "crm",
      "cases",
      "agenda",
      "settings",
      "billing",
      "copilot",
    ] as AppModule[],
  },
  starter: {
    id: "starter",
    name: "Starter",
    storedPlan: "essential",
    description: "Gestão completa para escritórios em estruturação.",
    modules: [
      "dashboard",
      "crm",
      "cases",
      "agenda",
      "finance",
      "settings",
      "users",
      "billing",
      "export",
    ] as AppModule[],
  },
  pro: {
    id: "pro",
    name: "Pro",
    storedPlan: "performance",
    description: "Automação, inteligência e comunicação para equipes em crescimento.",
    modules: [
      "dashboard",
      "crm",
      "cases",
      "agenda",
      "finance",
      "reports",
      "communications",
      "automations",
      "integrations",
      "settings",
      "users",
      "billing",
      "copilot",
      "export",
    ] as AppModule[],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    storedPlan: "business",
    description: "Governança e escala para operações jurídicas maduras.",
    modules: [
      "dashboard",
      "crm",
      "cases",
      "agenda",
      "finance",
      "reports",
      "communications",
      "automations",
      "integrations",
      "settings",
      "users",
      "billing",
      "copilot",
      "export",
    ] as AppModule[],
  },
} as const;

export type AdminPlanId = keyof typeof ADMIN_PLANS;
export type AdminSubscriptionStatus = "active" | "suspended" | "expired";

const STORED_TO_ADMIN: Record<string, AdminPlanId> = {
  trial: "free",
  essential: "starter",
  starter: "starter",
  performance: "pro",
  professional: "pro",
  business: "enterprise",
  enterprise: "enterprise",
};

export function toAdminPlan(value: string | null | undefined): AdminPlanId {
  return (value && STORED_TO_ADMIN[value]) || "free";
}

export function canAccessPlanModule(plan: AdminPlanId, module: AppModule): boolean {
  return ADMIN_PLANS[plan].modules.includes(module);
}

export function adminStatusLabel(status: AdminSubscriptionStatus) {
  return { active: "Ativo", suspended: "Suspenso", expired: "Expirado" }[status];
}
