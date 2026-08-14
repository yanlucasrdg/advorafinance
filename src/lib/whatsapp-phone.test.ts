import { describe, expect, it } from "vitest";
import { normalizeWhatsAppPhone } from "./whatsapp-phone";
import { phoneSchema } from "./validators";

describe("normalizeWhatsAppPhone", () => {
  it.each([
    ["(21) 99999-9999", "5521999999999"],
    ["11 3333-4444", "551133334444"],
    ["55 21 99999-9999", "5521999999999"],
    ["+55 (21) 99999-9999", "5521999999999"],
    ["+1 (415) 555-2671", "14155552671"],
  ])("normaliza %s", (input, expected) => {
    expect(normalizeWhatsAppPhone(input)).toBe(expected);
  });

  it.each([
    "219976868609",
    "121999999999",
    "+55 21 99768-68609",
    "123456789",
    "+0123456789",
    "+55 21 abc",
    "",
  ])("rejeita o telefone ambíguo ou inválido %s", (input) => {
    expect(() => normalizeWhatsAppPhone(input)).toThrow(
      "Cadastre com DDI, DDD e número",
    );
  });
});

describe("phoneSchema", () => {
  it("persiste o telefone do cliente em E.164 explícito", () => {
    expect(phoneSchema.parse("(21) 99999-9999")).toBe("+5521999999999");
    expect(phoneSchema.parse("+1 (415) 555-2671")).toBe("+14155552671");
  });

  it("não salva telefone brasileiro ambíguo", () => {
    expect(phoneSchema.safeParse("219976868609").success).toBe(false);
  });
});
