import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260806020000_financial_reports_aggregation.sql",
    import.meta.url,
  ),
  "utf8",
);
const financeRoute = readFileSync(
  new URL("../routes/_authenticated/financeiro.tsx", import.meta.url),
  "utf8",
);
const metricsHook = readFileSync(
  new URL("../hooks/use-metrics.ts", import.meta.url),
  "utf8",
);

describe("Server-side financial reports", () => {
  it("não usa a página operacional como fonte dos relatórios", () => {
    expect(financeRoute).toContain("useFinancialReports");
    expect(financeRoute).not.toContain("financeKpis(");
    expect(financeRoute).not.toContain("revenueByMonth(");
    expect(financeRoute).not.toContain("dreReport(");
    expect(financeRoute).not.toContain("cashFlowDirect(");
    expect(financeRoute).not.toContain("cashFlowIndirect(");
  });

  it("reconhece baixas parciais e estornos pela data do movimento", () => {
    expect(migration).toContain("FROM public.financial_payments payment");
    expect(migration).toContain("FROM public.financial_payment_reversals reversal");
    expect(migration).toContain("-reversal.amount_cents::bigint AS signed_amount");
    expect(migration).toContain("payment.paid_at >= v_from_at");
    expect(migration).toContain("reversal.reversed_at >= v_from_at");
  });

  it("calcula DRE configurável em todo o conjunto filtrado", () => {
    expect(migration).toContain("setting.enabled_categories");
    expect(migration).toContain("setting.category_map");
    expect(migration).toContain("settings.apply_cogs");
    expect(migration).toContain("dre_bucket_rows AS MATERIALIZED");
  });

  it("calcula aging pelo saldo residual, inclusive sem vencimento", () => {
    expect(migration).toContain("GREATEST(amount_cents - paid_amount_cents, 0)");
    expect(migration).toContain("'no_due_date'::text");
    expect(migration).toContain("aging_values AS MATERIALIZED");
  });

  it("agrega clientes, processos, áreas e responsáveis no banco", () => {
    expect(migration).toContain("client_groups AS MATERIALIZED");
    expect(migration).toContain("case_groups AS MATERIALIZED");
    expect(migration).toContain("area_groups AS MATERIALIZED");
    expect(migration).toContain("responsible_groups AS MATERIALIZED");
    expect(migration).toContain("revenue AS value, revenue, expense, net, count");
    expect(financeRoute).toContain("Top processos");
  });

  it("busca filtros no banco sem depender das listas operacionais", () => {
    expect(migration).toContain("financial_report_filter_options");
    expect(migration).toContain("_dimension = 'client'");
    expect(migration).toContain("_dimension = 'area'");
    expect(migration).toContain("_dimension = 'responsible'");
    expect(metricsHook).toContain('rpc("financial_report_filter_options"');
    expect(financeRoute).toContain("ReportFilterSelect");
    expect(financeRoute).not.toContain("areasList");
    expect(financeRoute).not.toContain("respsList");
  });

  it("impõe tenant, RBAC e limites de período no RPC", () => {
    expect(migration).toContain("FINANCIAL_LEDGER_MIGRATION_REQUIRED");
    expect(migration).toContain("entry.tenant_id = v_tenant_id");
    expect(migration).toContain("financial_has_any_tenant_role");
    expect(migration).toContain("FINANCIAL_REPORT_PERIOD_TOO_LARGE");
    expect(migration).toContain("FINANCIAL_RESPONSIBLE_INVALID");
  });

  it("não publica uma estimativa como fluxo indireto contábil", () => {
    expect(migration).toContain("'available', false");
    expect(migration).toContain("'requires_competence_ledger'");
    expect(financeRoute).toContain("não apresenta uma estimativa como se fosse um demonstrativo contábil");
  });

  it("invalida o relatório quando qualquer dimensão financeira muda", () => {
    expect(metricsHook).toContain('"financial_payment_reversals"');
    expect(metricsHook).toContain('"dre_settings"');
    expect(metricsHook).toContain('"profiles"');
    expect(metricsHook).toContain('rpc("financial_reports"');
  });
});
