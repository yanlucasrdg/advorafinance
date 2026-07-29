import { describe, expect, it } from "vitest";

import { parseBrlInput } from "@/lib/currency";

describe("parseBrlInput", () => {
  it.each([
    ["10000", 1_000_000],
    ["R$ 10.000,00", 1_000_000],
    ["10.000,50", 1_000_050],
    ["10000,99", 1_000_099],
    ["10k", 1_000_000],
    ["1,5 mil", 150_000],
  ])("converte %s para centavos sem alterar o valor", (input, expected) => {
    expect(parseBrlInput(input)).toBe(expected);
  });

  it("mantém o campo vazio como valor indefinido", () => {
    expect(parseBrlInput("")).toBeUndefined();
  });

  it("rejeita valores negativos ou inválidos", () => {
    expect(parseBrlInput("-10")).toBeUndefined();
    expect(parseBrlInput("dez mil")).toBeUndefined();
  });
});
