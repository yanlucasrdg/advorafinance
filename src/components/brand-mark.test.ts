import { describe, expect, it } from "vitest";

import { getBrandInitial } from "@/lib/brand-mark";

describe("getBrandInitial", () => {
  it("usa a primeira letra significativa do escritório", () => {
    expect(getBrandInitial("  teste ")).toBe("T");
    expect(getBrandInitial("águia jurídica")).toBe("Á");
  });

  it("usa a marca Advora quando o nome está ausente", () => {
    expect(getBrandInitial(null)).toBe("A");
    expect(getBrandInitial("   ")).toBe("A");
  });
});
