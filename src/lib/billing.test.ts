import { describe, expect, it } from "vitest";
import { BILLING_PLANS, billingStatus, isBillingPlanId, normalizeLegacyPlan } from "./billing";

describe("billing catalog", () => {
  it("ends a trial at its exact deadline while preserving a converted subscription", () => {
    const deadline = "2026-11-27T12:00:00Z";
    const end = Date.parse(deadline);
    expect(billingStatus("trialing", deadline, end - 1)).toBe("trialing");
    expect(billingStatus("trialing", deadline, end)).toBe("expired");
    expect(billingStatus("active", deadline, end)).toBe("active");
    expect(billingStatus("trialing", null, end)).toBe("expired");
  });
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
