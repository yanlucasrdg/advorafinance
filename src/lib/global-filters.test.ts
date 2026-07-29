import { describe, expect, it } from "vitest";
import { formatDateOnly, getPeriodRange } from "@/lib/global-filter-utils";

const NOW = new Date(2026, 6, 29, 15, 30);

describe("getPeriodRange", () => {
  it("returns exactly seven inclusive calendar days", () => {
    const range = getPeriodRange("7d", NOW);

    expect(formatDateOnly(range.start)).toBe("2026-07-23");
    expect(formatDateOnly(range.end)).toBe("2026-07-29");
  });

  it("returns exactly thirty inclusive calendar days", () => {
    const range = getPeriodRange("30d", NOW);

    expect(formatDateOnly(range.start)).toBe("2026-06-30");
    expect(formatDateOnly(range.end)).toBe("2026-07-29");
  });

  it.each([
    ["mtd", "2026-07-01"],
    ["ytd", "2026-01-01"],
    ["12m", "2025-08-01"],
  ] as const)("calculates the %s calendar boundary", (period, expectedStart) => {
    expect(formatDateOnly(getPeriodRange(period, NOW).start)).toBe(expectedStart);
  });
});

describe("formatDateOnly", () => {
  it("does not convert the local calendar date to UTC", () => {
    expect(formatDateOnly(new Date(2026, 0, 2, 0, 5))).toBe("2026-01-02");
  });
});
