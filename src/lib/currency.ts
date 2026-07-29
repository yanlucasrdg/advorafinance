/** Parse Brazilian currency text and return an integer number of cents. */
export function parseBrlInput(input: string): number | undefined {
  let raw = input
    .trim()
    .toLowerCase()
    .replace(/^r\$\s*/, "")
    .replace(/\s/g, "");
  if (!raw) return undefined;

  let multiplier = 1;
  if (raw.endsWith("mil")) {
    multiplier = 1_000;
    raw = raw.slice(0, -3);
  } else if (raw.endsWith("k")) {
    multiplier = 1_000;
    raw = raw.slice(0, -1);
  } else if (raw.endsWith("mi") || raw.endsWith("m")) {
    multiplier = 1_000_000;
    raw = raw.replace(/m(i)?$/, "");
  }

  raw = raw.trim();
  if (!raw || !/^[\d.,]+$/.test(raw)) return undefined;

  // pt-BR accepts 10.000,50. A lone dot with three digits after it is treated
  // as a thousands separator; other lone dots work as a decimal convenience.
  let normalized: string;
  if (raw.includes(",")) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if ((raw.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(raw)) {
    normalized = raw.replace(/\./g, "");
  } else {
    normalized = raw;
  }

  const reais = Number(normalized) * multiplier;
  if (!Number.isFinite(reais) || reais < 0) return undefined;
  return Math.round(reais * 100);
}
