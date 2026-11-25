export const BILLING_PLANS = {
  essential: {
    id: "essential",
    name: "Essencial",
    description: "Para profissionais e pequenos escritórios que querem organizar a operação.",
    monthlyPrice: 149,
    annualMonthlyPrice: 119,
    limits: { users: 2, cases: 200, storageGb: 5, aiCredits: 100, automations: 3 },
    features: [
      "CRM jurídico e gestão de clientes",
      "Processos, agenda, prazos e tarefas",
      "Financeiro e dashboard operacional",
      "Exportação de dados do escritório",
    ],
  },
  performance: {
    id: "performance",
    name: "Performance",
    description: "Para escritórios em crescimento que precisam automatizar e ganhar previsibilidade.",
    monthlyPrice: 399,
    annualMonthlyPrice: 319,
    limits: { users: 7, cases: 1000, storageGb: 25, aiCredits: 500, automations: 20 },
    features: [
      "Tudo do Essencial",
      "Financeiro, relatórios e indicadores avançados",
      "Automações e workflows personalizados",
      "Permissões por função",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    description: "Para bancas estruturadas que operam com controladoria e governança.",
    monthlyPrice: 999,
    annualMonthlyPrice: 799,
    limits: { users: 20, cases: 5000, storageGb: 100, aiCredits: 2000, automations: null },
    features: [
      "Tudo do Performance",
      "Marca branca e identidade personalizada",
      "Relatórios executivos e trilhas de auditoria",
      "Permissões, filas e workflows avançados",
    ],
  },
} as const;

export type BillingPlanId = keyof typeof BILLING_PLANS;
export type BillingInterval = "monthly" | "annual";

export function isBillingPlanId(value: string): value is BillingPlanId {
  return Object.prototype.hasOwnProperty.call(BILLING_PLANS, value);
}

export function billingStatus(status: string, trialEnd: string | null, now = Date.now()) {
  if (status === "trialing" && !(trialEnd && Date.parse(trialEnd) > now)) return "expired";
  return status;
}

export function normalizeLegacyPlan(value: string | null | undefined): BillingPlanId | "trial" {
  if (value === "starter") return "essential";
  if (value === "professional") return "performance";
  if (value === "enterprise") return "business";
  return value && isBillingPlanId(value) ? value : "trial";
}

