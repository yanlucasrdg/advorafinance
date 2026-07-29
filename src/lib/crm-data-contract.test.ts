import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260729121500_crm_clients_data_contract.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("CRM clients data contract migration", () => {
  it("protege a mudança de etapa com versão esperada e row lock", () => {
    expect(migration).toContain("p_expected_version integer");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("CLIENT_STATUS_CONFLICT");
  });

  it("grava a mudança e a auditoria na mesma função transacional", () => {
    const rpc = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.move_client_stage"));

    expect(rpc).toContain("UPDATE public.clients");
    expect(rpc).toContain("INSERT INTO public.client_activities");
    expect(rpc).not.toMatch(/EXCEPTION\s+WHEN[\s\S]*client_activities/i);
  });

  it("impede bypass da etapa e exclusão física pelo navegador", () => {
    expect(migration).toContain("REVOKE UPDATE ON public.clients FROM authenticated");
    expect(migration).toContain("REVOKE DELETE ON public.clients FROM authenticated");
    expect(migration).toContain("FUNCTION public.soft_delete_client");
    expect(migration).not.toMatch(/GRANT UPDATE \([^)]*\bstatus\b[^)]*\)/i);
    expect(migration).not.toMatch(/GRANT UPDATE \([^)]*\bdeleted_at\b[^)]*\)/i);
  });

  it("deriva tenant e autor da sessão em inserts autenticados", () => {
    expect(migration).toContain("NEW.tenant_id := public.current_tenant_id()");
    expect(migration).toContain("NEW.created_by := auth.uid()");
  });

  it("audita também o soft-delete dentro da transação", () => {
    const rpc = migration.slice(migration.indexOf("FUNCTION public.soft_delete_client"));

    expect(rpc).toContain("SET deleted_at = now()");
    expect(rpc).toContain("INSERT INTO public.client_activities");
    expect(rpc).toContain("'Cliente removido'");
  });

  it("mantém o relógio da etapa separado de updated_at", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz");
    expect(migration).toContain("ALTER COLUMN stage_entered_at SET NOT NULL");
    expect(migration).toContain("NEW.stage_entered_at := now()");
  });
});
