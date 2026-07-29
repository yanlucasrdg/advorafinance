import { describe, expect, it } from "vitest";

import { caseCreateSchema, clientCreateSchema, clientUpdateSchema } from "@/lib/validators";

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

describe("clientCreateSchema", () => {
  it.each([
    ["pf", "PF"],
    ["PF", "PF"],
    [" pj ", "PJ"],
    ["PJ", "PJ"],
  ])("normaliza o tipo %s para %s", (input, expected) => {
    const result = clientCreateSchema.parse({
      name: "Cliente de teste",
      type: input,
    });

    expect(result.type).toBe(expected);
  });

  it("mantém os campos profissionais como fonte de verdade tipada", () => {
    const result = clientCreateSchema.parse({
      name: "Empresa Exemplo",
      type: "pj",
      area: "Empresarial",
      value_cents: 1_000_050,
      owner: "Dra. Ana",
      is_hot: true,
      address: "Av. Paulista, 1000",
      city: "São Paulo",
      state: "sp",
    });

    expect(result).toMatchObject({
      type: "PJ",
      status: "novo_contato",
      area: "Empresarial",
      value_cents: 1_000_050,
      owner: "Dra. Ana",
      is_hot: true,
      address: "Av. Paulista, 1000",
      city: "São Paulo",
      state: "SP",
    });
  });

  it("define honorário zero e lead frio quando omitidos", () => {
    const result = clientCreateSchema.parse({
      name: "Pessoa Física",
      type: "PF",
    });

    expect(result.value_cents).toBe(0);
    expect(result.is_hot).toBe(false);
  });

  it("rejeita honorário fracionário, negativo e campos não permitidos", () => {
    expect(
      clientCreateSchema.safeParse({
        name: "Cliente",
        type: "PF",
        value_cents: 100.5,
      }).success,
    ).toBe(false);
    expect(
      clientCreateSchema.safeParse({
        name: "Cliente",
        type: "PF",
        value_cents: -1,
      }).success,
    ).toBe(false);
    expect(
      clientCreateSchema.safeParse({
        name: "Cliente",
        type: "PF",
        tenant_id: "não pode vir do navegador",
      }).success,
    ).toBe(false);
  });
});

describe("clientUpdateSchema", () => {
  it("impede alteração de etapa pelo update genérico", () => {
    const result = clientUpdateSchema.safeParse({ status: "contrato" });

    expect(result.success).toBe(false);
  });

  it("aceita atualização parcial dos dados cadastrais", () => {
    const result = clientUpdateSchema.parse({
      value_cents: 2_500_000,
      state: "rj",
    });

    expect(result).toEqual({ value_cents: 2_500_000, state: "RJ" });
  });

  it("não injeta defaults de criação em uma atualização parcial", () => {
    const result = clientUpdateSchema.parse({ notes: "Observação revisada" });

    expect(result).toEqual({ notes: "Observação revisada" });
  });
});
