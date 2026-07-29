import { describe, expect, it } from "vitest";
import { getCrmClientMeta } from "./crm-client";

describe("getCrmClientMeta", () => {
  it("prefers normalized columns", () => {
    expect(
      getCrmClientMeta({
        area: "Trabalhista",
        value_cents: 1_000_000,
        owner: "Dra. Ana",
        is_hot: false,
        notes: JSON.stringify({
          area: "Cível",
          value: 45_000,
          owner: "Legado",
          hot: true,
        }),
      }),
    ).toEqual({
      area: "Trabalhista",
      value: 10_000,
      valueCents: 1_000_000,
      owner: "Dra. Ana",
      hot: true,
    });
  });

  it("uses the legacy value only for a row that still has the migration default", () => {
    expect(
      getCrmClientMeta({
        value_cents: 0,
        notes: JSON.stringify({ value: 10_000 }),
      }).value,
    ).toBe(10_000);
  });

  it("never creates decorative/random metadata", () => {
    expect(getCrmClientMeta({ notes: "Anotação livre" })).toEqual({
      area: "Não definido",
      value: 0,
      valueCents: 0,
      owner: "Sem responsável",
      hot: false,
    });
  });
});
