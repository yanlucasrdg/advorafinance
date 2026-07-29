type ChartColors = readonly [string, string, string, string, string, string, string, string];

export type BrandThemeTokens = {
  action: string;
  actionHover: string;
  onBrand: string;
  soft: string;
  focus: string;
  charts: ChartColors;
};

export type BrandPalette = {
  name: string;
  description: string;
  primary: string;
  secondary: string;
  light: BrandThemeTokens;
  dark: BrandThemeTokens;
};

export const BRAND_PALETTES = [
  {
    name: "Indigo",
    description: "Equilibrada e institucional",
    primary: "#5B4CF0",
    secondary: "#7C6BFF",
    light: {
      action: "#4F46E5",
      actionHover: "#4338CA",
      onBrand: "#FFFFFF",
      soft: "#EEF2FF",
      focus: "#4F46E5",
      charts: [
        "#4F46E5",
        "#0284C7",
        "#0F766E",
        "#B45309",
        "#BE123C",
        "#7E22CE",
        "#475569",
        "#15803D",
      ],
    },
    dark: {
      action: "#818CF8",
      actionHover: "#A5B4FC",
      onBrand: "#111827",
      soft: "#27243F",
      focus: "#A5B4FC",
      charts: [
        "#818CF8",
        "#38BDF8",
        "#2DD4BF",
        "#FBBF24",
        "#FB7185",
        "#C084FC",
        "#94A3B8",
        "#4ADE80",
      ],
    },
  },
  {
    name: "Oceano",
    description: "Clara e confiável",
    primary: "#0284C7",
    secondary: "#06B6D4",
    light: {
      action: "#0369A1",
      actionHover: "#075985",
      onBrand: "#FFFFFF",
      soft: "#E0F2FE",
      focus: "#0369A1",
      charts: [
        "#0369A1",
        "#0E7490",
        "#4F46E5",
        "#047857",
        "#B45309",
        "#BE123C",
        "#6D28D9",
        "#475569",
      ],
    },
    dark: {
      action: "#38BDF8",
      actionHover: "#7DD3FC",
      onBrand: "#082F49",
      soft: "#102E3B",
      focus: "#7DD3FC",
      charts: [
        "#38BDF8",
        "#22D3EE",
        "#818CF8",
        "#34D399",
        "#FBBF24",
        "#FB7185",
        "#C084FC",
        "#94A3B8",
      ],
    },
  },
  {
    name: "Esmeralda",
    description: "Próxima e contemporânea",
    primary: "#059669",
    secondary: "#22C55E",
    light: {
      action: "#047857",
      actionHover: "#065F46",
      onBrand: "#FFFFFF",
      soft: "#ECFDF5",
      focus: "#047857",
      charts: [
        "#047857",
        "#15803D",
        "#0F766E",
        "#0369A1",
        "#B45309",
        "#BE123C",
        "#6D28D9",
        "#475569",
      ],
    },
    dark: {
      action: "#34D399",
      actionHover: "#6EE7B7",
      onBrand: "#052E16",
      soft: "#12372E",
      focus: "#6EE7B7",
      charts: [
        "#34D399",
        "#4ADE80",
        "#2DD4BF",
        "#38BDF8",
        "#FBBF24",
        "#FB7185",
        "#C084FC",
        "#94A3B8",
      ],
    },
  },
  {
    name: "Violeta",
    description: "Sofisticada e marcante",
    primary: "#7C3AED",
    secondary: "#C026D3",
    light: {
      action: "#7C3AED",
      actionHover: "#6D28D9",
      onBrand: "#FFFFFF",
      soft: "#F5F3FF",
      focus: "#7C3AED",
      charts: [
        "#7C3AED",
        "#A21CAF",
        "#4F46E5",
        "#0369A1",
        "#0F766E",
        "#B45309",
        "#BE123C",
        "#475569",
      ],
    },
    dark: {
      action: "#C084FC",
      actionHover: "#D8B4FE",
      onBrand: "#2E1065",
      soft: "#302445",
      focus: "#D8B4FE",
      charts: [
        "#C084FC",
        "#E879F9",
        "#818CF8",
        "#38BDF8",
        "#2DD4BF",
        "#FBBF24",
        "#FB7185",
        "#94A3B8",
      ],
    },
  },
  {
    name: "Coral",
    description: "Direta e energética",
    primary: "#E11D48",
    secondary: "#F97316",
    light: {
      action: "#BE123C",
      actionHover: "#9F1239",
      onBrand: "#FFFFFF",
      soft: "#FFF1F2",
      focus: "#BE123C",
      charts: [
        "#BE123C",
        "#C2410C",
        "#7C3AED",
        "#0369A1",
        "#047857",
        "#B45309",
        "#A21CAF",
        "#475569",
      ],
    },
    dark: {
      action: "#FB7185",
      actionHover: "#FDA4AF",
      onBrand: "#4C0519",
      soft: "#3D2029",
      focus: "#FDA4AF",
      charts: [
        "#FB7185",
        "#FB923C",
        "#C084FC",
        "#38BDF8",
        "#34D399",
        "#FBBF24",
        "#E879F9",
        "#94A3B8",
      ],
    },
  },
  {
    name: "Grafite",
    description: "Sólida e discreta",
    primary: "#334155",
    secondary: "#64748B",
    light: {
      action: "#334155",
      actionHover: "#1E293B",
      onBrand: "#FFFFFF",
      soft: "#F1F5F9",
      focus: "#475569",
      charts: [
        "#334155",
        "#475569",
        "#0369A1",
        "#047857",
        "#B45309",
        "#BE123C",
        "#6D28D9",
        "#0F766E",
      ],
    },
    dark: {
      action: "#CBD5E1",
      actionHover: "#E2E8F0",
      onBrand: "#0F172A",
      soft: "#29313E",
      focus: "#CBD5E1",
      charts: [
        "#CBD5E1",
        "#94A3B8",
        "#38BDF8",
        "#34D399",
        "#FBBF24",
        "#FB7185",
        "#C084FC",
        "#2DD4BF",
      ],
    },
  },
] as const satisfies readonly BrandPalette[];

export const DEFAULT_BRAND_PALETTE = BRAND_PALETTES[0];

const FALLBACK_CHARTS_LIGHT = DEFAULT_BRAND_PALETTE.light.charts;
const FALLBACK_CHARTS_DARK = DEFAULT_BRAND_PALETTE.dark.charts;

function normalizeHex(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function getContrastRatio(colorA: string, colorB: string): number {
  const luminanceA = relativeLuminance(colorA);
  const luminanceB = relativeLuminance(colorB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHex(color: string, target: string, amount: number): string {
  const sourceChannels = hexToRgb(color);
  const targetChannels = hexToRgb(target);
  const channels = sourceChannels.map((channel, index) =>
    Math.round(channel + (targetChannels[index] - channel) * amount),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function pickReadableForeground(background: string): string {
  const white = "#FFFFFF";
  const ink = "#0F172A";
  return getContrastRatio(background, white) >= getContrastRatio(background, ink) ? white : ink;
}

function ensureAccessibleAction(
  color: string,
  theme: "light" | "dark",
): { action: string; onBrand: string } {
  const surface = theme === "light" ? "#FFFFFF" : "#171923";
  const target = theme === "light" ? "#000000" : "#FFFFFF";

  for (let step = 0; step <= 10; step += 1) {
    const candidate = mixHex(color, target, step / 10);
    const foreground = pickReadableForeground(candidate);
    if (
      getContrastRatio(candidate, foreground) >= 4.5 &&
      getContrastRatio(candidate, surface) >= 3
    ) {
      return { action: candidate, onBrand: foreground };
    }
  }

  return theme === "light"
    ? { action: "#334155", onBrand: "#FFFFFF" }
    : { action: "#CBD5E1", onBrand: "#0F172A" };
}

function fallbackThemeTokens(
  primary: string,
  secondary: string,
  theme: "light" | "dark",
): BrandThemeTokens {
  const { action, onBrand } = ensureAccessibleAction(primary, theme);
  const hoverTarget = theme === "light" ? "#000000" : "#FFFFFF";
  const charts = theme === "light" ? FALLBACK_CHARTS_LIGHT : FALLBACK_CHARTS_DARK;
  return {
    action,
    actionHover: mixHex(action, hoverTarget, 0.14),
    onBrand,
    soft: mixHex(
      primary,
      theme === "light" ? "#FFFFFF" : "#171923",
      theme === "light" ? 0.9 : 0.72,
    ),
    focus: action,
    charts: [primary, secondary, charts[2], charts[3], charts[4], charts[5], charts[6], charts[7]],
  };
}

export function resolveBrandPalette(primaryColor: string, secondaryColor: string): BrandPalette {
  const primary = normalizeHex(primaryColor) ?? DEFAULT_BRAND_PALETTE.primary;
  const secondary = normalizeHex(secondaryColor) ?? DEFAULT_BRAND_PALETTE.secondary;
  const preset = BRAND_PALETTES.find(
    (palette) => palette.primary === primary && palette.secondary === secondary,
  );

  if (preset) return preset;

  return {
    name: "Personalizada",
    description: "Paleta personalizada do escritório",
    primary,
    secondary,
    light: fallbackThemeTokens(primary, secondary, "light"),
    dark: fallbackThemeTokens(primary, secondary, "dark"),
  };
}

export function getBrandCssVariables(
  primaryColor: string,
  secondaryColor: string,
): Record<string, string> {
  const palette = resolveBrandPalette(primaryColor, secondaryColor);
  const variables: Record<string, string> = {
    "--brand-primary": palette.primary,
    "--brand-secondary": palette.secondary,
    "--brand-action-light": palette.light.action,
    "--brand-action-hover-light": palette.light.actionHover,
    "--on-brand-light": palette.light.onBrand,
    "--brand-soft-light": palette.light.soft,
    "--brand-focus-light": palette.light.focus,
    "--brand-action-dark": palette.dark.action,
    "--brand-action-hover-dark": palette.dark.actionHover,
    "--on-brand-dark": palette.dark.onBrand,
    "--brand-soft-dark": palette.dark.soft,
    "--brand-focus-dark": palette.dark.focus,
    "--gradient-brand": `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`,
  };

  palette.light.charts.forEach((color, index) => {
    variables[`--chart-${index + 1}-light`] = color;
  });
  palette.dark.charts.forEach((color, index) => {
    variables[`--chart-${index + 1}-dark`] = color;
  });

  return variables;
}

export const BRAND_CSS_VARIABLE_NAMES = Object.keys(
  getBrandCssVariables(DEFAULT_BRAND_PALETTE.primary, DEFAULT_BRAND_PALETTE.secondary),
);
