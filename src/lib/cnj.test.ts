import { describe, expect, it } from "vitest";
import { validateCNJ } from "@/lib/cnj";

describe("validateCNJ", () => {
  it("valida e normaliza um número CNJ formatado", () => {
    expect(validateCNJ("0000001-41.2024.8.01.0001")).toEqual({
      ok: true,
      clean: "00000014120248010001",
      formatted: "0000001-41.2024.8.01.0001",
      segmento: "8",
      tribunal: "01",
      ano: "2024",
    });
  });

  it("aceita a representação não formatada", () => {
    expect(validateCNJ("12345676420245010001")).toMatchObject({
      ok: true,
      clean: "12345676420245010001",
      formatted: "1234567-64.2024.5.01.0001",
      segmento: "5",
      tribunal: "01",
      ano: "2024",
    });
  });

  it("rejeita dígitos verificadores incorretos", () => {
    expect(validateCNJ("0000001-42.2024.8.01.0001")).toMatchObject({
      ok: false,
      reason: "DV",
    });
  });

  it("rejeita números com quantidade de dígitos diferente de 20", () => {
    expect(validateCNJ("123456")).toMatchObject({
      ok: false,
      reason: "LENGTH",
    });
  });

  it("rejeita ano anterior ao limite permitido", () => {
    expect(validateCNJ("0000001-00.1899.8.01.0001")).toMatchObject({
      ok: false,
      reason: "YEAR",
    });
  });

  it("rejeita ano superior ao próximo ano", () => {
    const anoInvalido = String(new Date().getFullYear() + 2);

    expect(validateCNJ(`0000001-00.${anoInvalido}.8.01.0001`)).toMatchObject({
      ok: false,
      reason: "YEAR",
    });
  });

  it("rejeita segmento do Judiciário igual a zero", () => {
    expect(validateCNJ("0000001-00.2024.0.01.0001")).toMatchObject({
      ok: false,
      reason: "SEGMENT",
    });
  });
});
