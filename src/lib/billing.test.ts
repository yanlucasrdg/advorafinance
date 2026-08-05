import { describe, expect, it } from "vitest";
import { BILLING_PLANS, isBillingPlanId, normalizeLegacyPlan } from "./billing";

describe("billing catalog", () => {
  it("keeps the annual prices lower than monthly prices", () => {
    for (const plan of Object.values(BILLING_PLANS)) {
      expect(plan.annualMonthlyPrice).toBeLessThan(plan.monthlyPrice);
    }
  });

  it("maps legacy tenant plans without losing access", () => {
    expect(normalizeLegacyPlan("starter")).toBe("essential");
    expect(normalizeLegacyPlan("professional")).toBe("performance");
    expect(normalizeLegacyPlan("enterprise")).toBe("business");
    expect(normalizeLegacyPlan("trial")).toBe("trial");
  });

  it("accepts only sellable plan identifiers", () => {
    expect(isBillingPlanId("performance")).toBe(true);
    expect(isBillingPlanId("trial")).toBe(false);
  });
});
