import { describe, expect, it } from "vitest";
import {
  createCsv,
  neutralizeSpreadsheetFormula,
  parseBrlToCents,
  parseCrmImportCsv,
  parseCsvRows,
} from "./crm-csv";

describe("parseBrlToCents", () => {
  it.each([
    ["10000", 1_000_000],
    ["10.000", 1_000_000],
    ["10.000,50", 1_000_050],
    ["10k", 1_000_000],
    ["10 mil", 1_000_000],
    ["0", 0],
    ["R$ 1.234,56", 123_456],
  ])("parses %s", (input, expected) => {
    expect(parseBrlToCents(input)).toBe(expected);
  });

  it.each(["", "-10", "dez mil", "10.0.00"])("rejects %s", (input) => {
    expect(parseBrlToCents(input)).toBeNull();
  });
});

describe("parseCsvRows", () => {
  it("supports BOM, semicolon, CRLF and quoted delimiters", () => {
    const rows = parseCsvRows(
      '\uFEFFNome;E-mail;Valor\r\n"Silva; Sociedade";contato@silva.test;"10.000,50"\r\n',
    );

    expect(rows).toEqual([
      {
        nome: "Silva; Sociedade",
        "e-mail": "contato@silva.test",
        valor: "10.000,50",
      },
    ]);
  });
});

describe("parseCrmImportCsv", () => {
  it("keeps zero, reports invalid values and removes duplicates", () => {
    const result = parseCrmImportCsv(
      [
        "nome;email;valor;tipo;quente",
        "Cliente A;a@test.dev;0;PF;sim",
        "Cliente A;a@test.dev;100;PF;nao",
        "Cliente B;b@test.dev;dez mil;PJ;nao",
      ].join("\r\n"),
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      name: "Cliente A",
      value_cents: 0,
      type: "PF",
      is_hot: true,
    });
    expect(result.issues).toEqual([
      { row: 3, message: "Registro duplicado dentro do arquivo." },
      { row: 4, message: 'Honorário inválido: "dez mil".' },
    ]);
  });

  it("round-trips exported reais without treating an internal cents column as reais", () => {
    const result = parseCrmImportCsv(
      [
        "name;status;value;value_cents",
        "Cliente Exportado;consulta_agendada;10000;1000000",
      ].join("\r\n"),
    );

    expect(result.records[0]).toMatchObject({
      status: "consulta_agendada",
      value_cents: 1_000_000,
    });
  });

  it("accepts the readable labels used by older reports", () => {
    const result = parseCrmImportCsv(
      ["nome;etapa;valor", "Cliente A;Concluído / Perdido;100"].join("\r\n"),
    );

    expect(result.records[0].status).toBe("encerrado");
  });
});

describe("createCsv", () => {
  it("neutralizes spreadsheet formulas while leaving numeric values untouched", () => {
    expect(neutralizeSpreadsheetFormula("=HYPERLINK(\"bad\")")).toBe(
      "'=HYPERLINK(\"bad\")",
    );
    expect(neutralizeSpreadsheetFormula("Cliente")).toBe("Cliente");

    const csv = createCsv([{ nome: "=1+1", valor: 10_000 }]);
    expect(csv).toBe("nome;valor\r\n'=1+1;10000");
  });
});
