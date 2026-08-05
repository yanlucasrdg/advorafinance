import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const processesRoute = readFileSync(
  new URL("../routes/_authenticated/processos.tsx", import.meta.url),
  "utf8",
);
const processKanban = readFileSync(
  new URL("../components/processos/case-kanban.tsx", import.meta.url),
  "utf8",
);
const crmDrawer = readFileSync(
  new URL("../components/crm/crm-lead-drawer.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260805233000_process_operations_integrity.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Process and CRM operational integrity", () => {
  it("não apresenta score de êxito fabricado como inteligência artificial", () => {
    expect(processesRoute).not.toContain("hashSuccess");
    expect(processesRoute).not.toContain("Baseado em 24 fatores");
    expect(processKanban).not.toContain("successScore");
    expect(processKanban).not.toContain("Êxito:");
  });

  it("usa movimentações reais na timeline e nas métricas", () => {
    expect(processesRoute).toContain('.from("case_movements")');
    expect(migration).toContain("FROM public.case_movements");
    expect(migration).toContain("occurred_at AT TIME ZONE v_timezone");
  });

  it("normaliza e bloqueia duplicidade concorrente de CNJ", () => {
    expect(migration).toContain("FUNCTION public.normalize_case_cnj");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("v_expected_dv");
    expect(migration).toContain("CASE_CNJ_DUPLICATE");
  });

  it("conecta timeline e follow-up do CRM a dados persistidos", () => {
    expect(crmDrawer).toContain('.from("client_activities")');
    expect(crmDrawer).toContain('p_kind: "followup"');
    expect(crmDrawer).toContain('rpc("toggle_deadline_completion"');
  });
});
