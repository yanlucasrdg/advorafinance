import { describe, expect, it } from "vitest";
import {
  BRAND_PALETTES,
  getBrandCssVariables,
  getContrastRatio,
  resolveBrandPalette,
} from "@/lib/brand-palettes";

describe("brand palettes", () => {
  it.each(BRAND_PALETTES)("$name keeps action labels at WCAG AA contrast", (palette) => {
    expect(getContrastRatio(palette.light.action, palette.light.onBrand)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(getContrastRatio(palette.dark.action, palette.dark.onBrand)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BRAND_PALETTES)("$name keeps actions distinguishable from their surface", (palette) => {
    expect(getContrastRatio(palette.light.action, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(getContrastRatio(palette.dark.action, "#171923")).toBeGreaterThanOrEqual(3);
  });

  it("normalizes known colors and resolves the matching preset", () => {
    expect(resolveBrandPalette("#5b4cf0", " #7c6bff ").name).toBe("Indigo");
  });

  it("creates a safe fallback for a custom light palette", () => {
    const palette = resolveBrandPalette("#FDE68A", "#FEF3C7");
    expect(palette.name).toBe("Personalizada");
    expect(getContrastRatio(palette.light.action, palette.light.onBrand)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(getContrastRatio(palette.light.action, "#FFFFFF")).toBeGreaterThanOrEqual(3);
  });

  it("exposes eight light and dark chart variables", () => {
    const variables = getBrandCssVariables("#0284C7", "#06B6D4");
    for (let index = 1; index <= 8; index += 1) {
      expect(variables[`--chart-${index}-light`]).toBeTruthy();
      expect(variables[`--chart-${index}-dark`]).toBeTruthy();
    }
  });
});
