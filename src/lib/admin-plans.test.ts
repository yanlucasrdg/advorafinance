import { describe, expect, it } from "vitest";
import { canAccessPlanModule, toAdminPlan } from "./admin-plans";

describe("admin plan entitlements", () => {
  it("normalizes current and legacy database plans", () => {
    expect(toAdminPlan("trial")).toBe("free");
    expect(toAdminPlan("essential")).toBe("starter");
    expect(toAdminPlan("professional")).toBe("pro");
    expect(toAdminPlan("business")).toBe("enterprise");
  });

  it("keeps premium modules out of free and starter", () => {
    expect(canAccessPlanModule("free", "finance")).toBe(false);
    expect(canAccessPlanModule("starter", "finance")).toBe(true);
    expect(canAccessPlanModule("starter", "communications")).toBe(false);
    expect(canAccessPlanModule("pro", "copilot")).toBe(true);
  });
});
