import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260903230000_platform_admin.sql", "utf8");
const serverFunctions = readFileSync("src/lib/platform-admin.functions.ts", "utf8");

describe("platform admin security contract", () => {
  it("checks master_admin inside every administrative RPC", () => {
    expect(migration.match(/PLATFORM_ADMIN_REQUIRED/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain("role = 'master_admin'");
  });

  it("protects billing changes with RLS, an audit trail and atomic RPC", () => {
    expect(migration).toContain("subscription_admin_audit ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("platform_admin_update_subscription");
    expect(migration).toContain("protect_tenant_plan_trigger");
  });

  it("never imports the service-role client in browser-callable functions", () => {
    expect(serverFunctions).not.toContain("supabaseAdmin");
    expect(serverFunctions).not.toContain("SERVICE_ROLE");
    expect(serverFunctions).toContain("requireSupabaseAuth");
  });
});
