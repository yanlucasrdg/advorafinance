import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { getPeriodRange, type PeriodKey } from "@/lib/global-filter-utils";

export type { PeriodKey } from "@/lib/global-filter-utils";

export type GlobalFilters = {
  period: PeriodKey;
  responsible: string | null;
  area: string | null;
  clientId: string | null;
  status: string | null;
};

type Ctx = {
  filters: GlobalFilters;
  setFilter: <K extends keyof GlobalFilters>(k: K, v: GlobalFilters[K]) => void;
  reset: () => void;
  range: { start: Date; end: Date };
};

const DEFAULT: GlobalFilters = {
  period: "30d",
  responsible: null,
  area: null,
  clientId: null,
  status: null,
};

const GlobalFiltersCtx = createContext<Ctx | undefined>(undefined);

export function GlobalFiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<GlobalFilters>(DEFAULT);
  const value = useMemo<Ctx>(
    () => ({
      filters,
      setFilter: (k, v) => setFilters((f) => ({ ...f, [k]: v })),
      reset: () => setFilters(DEFAULT),
      range: getPeriodRange(filters.period),
    }),
    [filters],
  );
  return <GlobalFiltersCtx.Provider value={value}>{children}</GlobalFiltersCtx.Provider>;
}

export function useGlobalFilters() {
  const c = useContext(GlobalFiltersCtx);
  if (!c) throw new Error("useGlobalFilters must be used within GlobalFiltersProvider");
  return c;
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  mtd: "Mês atual",
  ytd: "Ano",
  "12m": "12 meses",
};
