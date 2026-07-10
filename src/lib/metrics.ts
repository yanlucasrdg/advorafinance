/**
 * Pure metric calculators. Zero mock data.
 * Each function accepts already-fetched rows and returns derived KPIs.
 */

export type FinRow = {
  amount_cents: number;
  kind: string; // "receita" | "despesa"
  status: string; // "pago" | "pendente" | "atrasado"
  due_date: string | null;
  paid_at: string | null;
  client_id: string | null;
  case_id: string | null;
  paid_amount_cents?: number | null;
  settlement_status?: string | null; // "previsto" | "confirmado" | "conciliado"
  category?: string | null;
  payment_method?: string | null;
};

export type CaseRow = {
  id: string;
  status: string;
  area: string | null;
  responsible: string | null;
  value_cents: number | null;
  last_movement_at: string | null;
  distribution_date: string | null;
  created_at: string;
  client_id: string | null;
};

export type ClientRow = {
  id: string;
  type: string; // PF | PJ
  status: string;
  created_at: string;
};

export type DeadlineRow = {
  id: string;
  due_at: string;
  done: boolean;
  kind: string;
};

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, m: number) => new Date(d.getFullYear(), d.getMonth() + m, 1);

export const monthAbbr = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// ---------- FINANCEIRO ----------
export function financeKpis(rows: FinRow[], now = new Date()) {
  const monthStart = startOfMonth(now);
  const prevMonthStart = addMonths(monthStart, -1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const twelveAgo = addMonths(monthStart, -11);

  let revMonth = 0, revPrev = 0, revYear = 0, rev12 = 0;
  let expMonth = 0, expYear = 0;
  let openReceivable = 0, overdueReceivable = 0;
  let openPayable = 0, overduePayable = 0;
  let paidCount = 0;
  const clientRev: Record<string, number> = {};
  const caseRev: Record<string, number> = {};

  rows.forEach((r) => {
    const amt = r.amount_cents ?? 0;
    const paidAt = r.paid_at ? new Date(r.paid_at) : null;
    const dueAt = r.due_date ? new Date(r.due_date) : null;
    const isRev = r.kind === "receita";
    const isPaid = r.status === "pago";

    if (isRev && isPaid && paidAt) {
      if (paidAt >= monthStart) revMonth += amt;
      if (paidAt >= prevMonthStart && paidAt < monthStart) revPrev += amt;
      if (paidAt >= yearStart) revYear += amt;
      if (paidAt >= twelveAgo) rev12 += amt;
      paidCount++;
      if (r.client_id) clientRev[r.client_id] = (clientRev[r.client_id] ?? 0) + amt;
      if (r.case_id) caseRev[r.case_id] = (caseRev[r.case_id] ?? 0) + amt;
    }
    if (!isRev && isPaid && paidAt) {
      if (paidAt >= monthStart) expMonth += amt;
      if (paidAt >= yearStart) expYear += amt;
    }
    if (isRev && !isPaid) {
      openReceivable += amt;
      if (dueAt && dueAt < now) overdueReceivable += amt;
    }
    if (!isRev && !isPaid) {
      openPayable += amt;
      if (dueAt && dueAt < now) overduePayable += amt;
    }
  });

  const totalReceivable = openReceivable;
  const delinquencyPct = totalReceivable > 0 ? (overdueReceivable / totalReceivable) * 100 : 0;
  const ticketAvg = paidCount > 0 ? revYear / paidCount : 0;

  return {
    revMonth, revPrev, revYear, rev12,
    expMonth, expYear,
    openReceivable, overdueReceivable,
    openPayable, overduePayable,
    delinquencyPct,
    ticketAvg,
    profitMonth: revMonth - expMonth,
    profitYear: revYear - expYear,
    cashFlow: revYear - expYear,
    clientRev, caseRev,
  };
}

export function revenueByMonth(rows: FinRow[], months = 12, now = new Date()) {
  const start = addMonths(startOfMonth(now), -(months - 1));
  const buckets: { key: string; label: string; receita: number; despesa: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = addMonths(start, i);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: `${monthAbbr[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`,
      receita: 0,
      despesa: 0,
    });
  }
  const idx = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
  rows.forEach((r) => {
    if (r.status !== "pago" || !r.paid_at) return;
    const d = new Date(r.paid_at);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    const i = idx[k];
    if (i === undefined) return;
    if (r.kind === "receita") buckets[i].receita += (r.amount_cents ?? 0);
    else buckets[i].despesa += (r.amount_cents ?? 0);
  });
  return buckets;
}

// ---------- PROCESSOS ----------
export function caseKpis(rows: CaseRow[], now = new Date()) {
  const byStatus: Record<string, number> = {};
  const byArea: Record<string, number> = {};
  const byResp: Record<string, number> = {};
  let valueInCause = 0;
  let stale30 = 0, stale60 = 0, stale90 = 0;
  const ms = now.getTime();
  rows.forEach((c) => {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    const a = c.area?.trim() || "Sem área";
    byArea[a] = (byArea[a] ?? 0) + 1;
    const r = c.responsible?.trim() || "Sem responsável";
    byResp[r] = (byResp[r] ?? 0) + 1;
    valueInCause += c.value_cents ?? 0;
    const last = c.last_movement_at ? new Date(c.last_movement_at).getTime() : new Date(c.created_at).getTime();
    const days = (ms - last) / 86400000;
    if (c.status === "ativo") {
      if (days >= 30) stale30++;
      if (days >= 60) stale60++;
      if (days >= 90) stale90++;
    }
  });
  return { byStatus, byArea, byResp, valueInCause, stale30, stale60, stale90, total: rows.length };
}

// ---------- CLIENTES ----------
export function clientKpis(rows: ClientRow[], now = new Date()) {
  const monthStart = startOfMonth(now);
  let active = 0, inactive = 0, pf = 0, pj = 0, newMonth = 0;
  rows.forEach((c) => {
    if (c.status === "ativo") active++; else inactive++;
    if ((c.type ?? "").toUpperCase() === "PJ") pj++; else pf++;
    if (new Date(c.created_at) >= monthStart) newMonth++;
  });
  return { total: rows.length, active, inactive, pf, pj, newMonth };
}

// ---------- AGENDA ----------
export function agendaKpis(rows: DeadlineRow[], now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const in7 = new Date(today); in7.setDate(today.getDate() + 7);
  let overdue = 0, todayCount = 0, next7 = 0, hearingsWeek = 0, done = 0;
  rows.forEach((d) => {
    const at = new Date(d.due_at);
    if (d.done) { done++; return; }
    if (at < now) overdue++;
    if (at >= today && at < tomorrow) todayCount++;
    if (at >= now && at <= in7) next7++;
    if (d.kind === "audiencia" && at >= now && at <= in7) hearingsWeek++;
  });
  return { overdue, today: todayCount, next7, hearingsWeek, done };
}

export function pctDelta(curr: number, prev: number) {
  if (!prev) return curr ? 100 : 0;
  return ((curr - prev) / prev) * 100;
}

export function fmtBRL(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((cents ?? 0) / 100);
}

export function fmtBRLCompact(cents: number) {
  const v = (cents ?? 0) / 100;
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}
