export type PeriodKey = "7d" | "30d" | "mtd" | "ytd" | "12m";

/**
 * Returns an inclusive calendar range in the user's local timezone.
 *
 * The backend RPC accepts `date` (rather than timestamps), so "7 dias" means
 * today plus the previous six calendar days.
 */
export function getPeriodRange(period: PeriodKey, now = new Date()): { start: Date; end: Date } {
  const end = new Date(now);
  const start = new Date(end);
  switch (period) {
    case "7d":
      start.setDate(end.getDate() - 6);
      break;
    case "30d":
      start.setDate(end.getDate() - 29);
      break;
    case "mtd":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case "ytd":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
    case "12m":
      start.setMonth(end.getMonth() - 11, 1);
      start.setHours(0, 0, 0, 0);
      break;
  }
  return { start, end };
}

/** Formats a local calendar date without the UTC shift caused by toISOString. */
export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
