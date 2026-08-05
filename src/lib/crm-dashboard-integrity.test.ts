import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260805223000_crm_dashboard_integrity.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("CRM and dashboard integrity migration", () => {
  it("calcula o funil a partir de clientes e usa o tipo normalizado de prazo", () => {
    expect(migration).toContain("FROM public.clients");
    expect(migration).toContain("kind = 'prazo_processual'");
    expect(migration).not.toContain("kind = 'prazo'");
  });

  it("impede arquivamento com pendências jurídicas ou financeiras", () => {
    expect(migration).toContain("CASE_ARCHIVE_REQUIRES_OUTCOME");
    expect(migration).toContain("CASE_ARCHIVE_OPEN_DEADLINES");
    expect(migration).toContain("CASE_ARCHIVE_OPEN_FINANCIAL");
  });

  it("substitui exclusão financeira por remoção lógica auditada", () => {
    expect(migration).toContain("FUNCTION public.soft_delete_financial_entry");
    expect(migration).toContain("SET deleted_at = now()");
    expect(migration).toContain("'soft_deleted'");
    expect(migration).toContain("REVOKE DELETE ON public.financial_entries FROM authenticated");
  });

  it("preserva pagamentos e histórico de auditoria", () => {
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toContain("ON DELETE SET NULL");
  });
});
