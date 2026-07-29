import { describe, expect, it } from "vitest";

import { caseCreateSchema } from "@/lib/validators";

const operationalStatuses = ["ativo", "suspenso", "recurso", "arquivado", "ganho", "perdido"];

describe("caseCreateSchema", () => {
  it.each(operationalStatuses)("aceita o status operacional %s", (status) => {
    const result = caseCreateSchema.safeParse({
      title: "Ação trabalhista",
      area: "civel",
      status,
      value_cents: 1_000_000,
      parties: [{ name: "Parte contrária", role: "Ré" }],
    });

    expect(result.success).toBe(true);
  });

  it("usa o status operacional padrão quando ele não é informado", () => {
    const result = caseCreateSchema.parse({
      title: "Ação de cobrança",
      area: "civel",
      value_cents: 0,
    });

    expect(result.status).toBe("ativo");
  });

  it("rejeita status e área desconhecidos", () => {
    const result = caseCreateSchema.safeParse({
      title: "Processo inválido",
      area: "desconhecida",
      status: "qualquer",
      value_cents: 0,
    });

    expect(result.success).toBe(false);
  });

  it("rejeita partes sem nome", () => {
    const result = caseCreateSchema.safeParse({
      title: "Processo com parte inválida",
      area: "trabalhista",
      status: "ativo",
      value_cents: 0,
      parties: [{ name: "   " }],
    });

    expect(result.success).toBe(false);
  });
});
