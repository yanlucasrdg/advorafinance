export type AppRole =
  | "master_admin"
  | "owner"
  | "admin"
  | "lawyer"
  | "secretary"
  | "intern"
  | "client";

export type AppModule =
  | "dashboard"
  | "crm"
  | "cases"
  | "agenda"
  | "finance"
  | "reports"
  | "communications"
  | "automations"
  | "integrations"
  | "billing"
  | "settings"
  | "users"
  | "copilot"
  | "export";

const ROLE_PRIORITY: AppRole[] = [
  "master_admin",
  "owner",
  "admin",
  "lawyer",
  "secretary",
  "intern",
  "client",
];

const MODULE_ROLES: Record<AppModule, readonly AppRole[]> = {
  dashboard: ["master_admin", "owner", "admin", "lawyer", "secretary", "intern"],
  crm: ["master_admin", "owner", "admin", "lawyer", "secretary", "intern"],
  cases: ["master_admin", "owner", "admin", "lawyer", "secretary", "intern"],
  agenda: ["master_admin", "owner", "admin", "lawyer", "secretary", "intern"],
  finance: ["master_admin", "owner", "admin"],
  reports: ["master_admin", "owner", "admin", "lawyer"],
  communications: ["master_admin", "owner", "admin", "lawyer", "secretary"],
  automations: ["master_admin", "owner", "admin"],
  integrations: ["master_admin", "owner", "admin"],
  billing: ["master_admin", "owner"],
  settings: ["master_admin", "owner", "admin"],
  users: ["master_admin", "owner"],
  copilot: ["master_admin", "owner", "admin", "lawyer"],
  export: ["master_admin", "owner"],
};

export const ROUTE_MODULES: Record<string, AppModule> = {
  "/dashboard": "dashboard",
  "/crm": "crm",
  "/processos": "cases",
  "/agenda": "agenda",
  "/financeiro": "finance",
  "/relatorios": "reports",
  "/comunicacoes": "communications",
  "/automacoes": "automations",
  "/integracoes": "integrations",
  "/assinatura": "billing",
  "/config": "settings",
  "/admin/usuarios": "users",
  "/copiloto": "copilot",
  "/exportar-dados": "export",
};

export function normalizeRoles(values: readonly string[] | null | undefined): AppRole[] {
  const valid = new Set<AppRole>(ROLE_PRIORITY);
  return Array.from(new Set(values ?? [])).filter((role): role is AppRole => valid.has(role as AppRole));
}

export function primaryRole(roles: readonly AppRole[]): AppRole | null {
  return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? null;
}

export function canAccessModule(roles: readonly AppRole[], module: AppModule): boolean {
  return roles.some((role) => MODULE_ROLES[module].includes(role));
}

export function moduleForPath(pathname: string): AppModule | null {
  const root = `/${pathname.split("/").filter(Boolean).slice(0, 2).join("/")}`;
  return ROUTE_MODULES[pathname] ?? ROUTE_MODULES[root] ?? ROUTE_MODULES[`/${pathname.split("/")[1]}`] ?? null;
}
