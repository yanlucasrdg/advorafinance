import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260806010000_financial_ledger_integrity.sql",
    import.meta.url,
  ),
  "utf8",
);
const financeHook = readFileSync(
  new URL("../hooks/use-finance.ts", import.meta.url),
  "utf8",
);
const financeRoute = readFileSync(
  new URL("../routes/_authenticated/financeiro.tsx", import.meta.url),
  "utf8",
);

describe("Financial ledger integrity", () => {
  it("inclui os helpers ausentes nas instalações legadas", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS timezone");
    expect(migration).toContain("FUNCTION public.financial_has_any_tenant_role");
    expect(migration).toContain("FUNCTION public.financial_tenant_has_subscription_access");
    expect(migration).toContain("to_regclass('public.tenant_subscriptions') IS NULL");
    expect(migration).not.toContain("public.has_any_tenant_role(");
    expect(migration).not.toContain("public.tenant_has_subscription_access(");
  });

  it("valida vínculos de cliente e processo no tenant antes de criar lançamentos", () => {
    expect(migration).toContain("FINANCIAL_CLIENT_NOT_FOUND");
    expect(migration).toContain("FINANCIAL_CASE_NOT_FOUND");
    expect(migration).toContain("FINANCIAL_CASE_CLIENT_MISMATCH");
    expect(migration).toContain("NEW.tenant_id <> v_tenant_id");
  });

  it("exige autorização, assinatura e pagamento integral para conciliar", () => {
    expect(migration).toContain("FUNCTION public.reconcile_financial_entry");
    expect(migration).toContain("ROLE_ACCESS_DENIED");
    expect(migration).toContain("SUBSCRIPTION_ACCESS_DENIED");
    expect(migration).toContain("FINANCIAL_ENTRY_NOT_FULLY_PAID");
  });

  it("mantém estornos append-only e indisponíveis para escrita direta", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.financial_payment_reversals");
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toContain("REVOKE ALL ON public.financial_payment_reversals FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("'payment_reversed'");
  });

  it("protege a baixa contra vínculo cruzado, excesso e mutação posterior", () => {
    expect(migration).toContain("FUNCTION public.normalize_financial_payment");
    expect(migration).toContain("FINANCIAL_ENTRY_TENANT_MISMATCH");
    expect(migration).toContain("FINANCIAL_PAYMENT_AMOUNT_INVALID");
    expect(migration).toContain("REVOKE UPDATE, DELETE ON public.financial_payments FROM authenticated");
  });

  it("torna o histórico financeiro append-only para usuários da aplicação", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "tenant insert audit"');
    expect(migration).toContain("REVOKE ALL ON public.financial_audit_log FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT SELECT ON public.financial_audit_log TO authenticated");
  });

  it("calcula realizado por movimentos líquidos e aberto pelo saldo residual", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.metrics_financeiro(date, date)");
    expect(migration).toContain("FROM public.financial_payments payment");
    expect(migration).toContain("-reversal.amount_cents");
    expect(migration).toContain("entry.amount_cents - entry.paid_amount_cents");
    expect(migration).toContain("occurred_at AT TIME ZONE v_timezone");
    expect(migration).toContain("entry.tenant_id = public.current_tenant_id()");
  });

  it("expõe estorno com motivo obrigatório na aplicação", () => {
    expect(financeHook).toContain('rpc("reverse_financial_payment"');
    expect(financeRoute).toContain("Motivo do estorno");
    expect(financeRoute).toContain("O motivo não poderá ser alterado");
    expect(financeRoute).toContain("reversePayment.isPending");
  });
});
