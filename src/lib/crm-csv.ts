const DEFAULT_MAX_ROWS = 5_000;

export const CRM_STAGE_IDS = [
  "novo_contato",
  "triagem",
  "consulta_agendada",
  "proposta",
  "contrato",
  "em_andamento",
  "encerrado",
] as const;

export type CrmStageId = (typeof CRM_STAGE_IDS)[number];

export type CrmCsvIssue = {
  row: number;
  message: string;
};

export type CrmCsvClient = {
  name: string;
  email: string | null;
  phone: string | null;
  doc: string | null;
  type: "PF" | "PJ";
  status: CrmStageId;
  area: string | null;
  value_cents: number;
  owner: string | null;
  is_hot: boolean;
};

export type CrmCsvImportResult = {
  records: CrmCsvClient[];
  issues: CrmCsvIssue[];
  totalRows: number;
  truncated: boolean;
};

function detectDelimiter(line: string) {
  let commaCount = 0;
  let semicolonCount = 0;
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === ",") {
      commaCount += 1;
    } else if (!quoted && char === ";") {
      semicolonCount += 1;
    }
  }

  return semicolonCount > commaCount ? ";" : ",";
}

export function parseCsvRows(text: string): Record<string, string>[] {
  const normalized = text.replace(/^\uFEFF/, "");
  const firstLine = normalized.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (quoted) {
      if (char === '"' && normalized[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && normalized[index + 1] === "\n") index += 1;
      if (field !== "" || row.some((cell) => cell !== "")) {
        row.push(field);
        rows.push(row);
      }
      field = "";
      row = [];
    } else {
      field += char;
    }
  }

  if (field !== "" || row.some((cell) => cell !== "")) {
    row.push(field);
    rows.push(row);
  }

  if (quoted || rows.length === 0) return [];

  const headers = rows[0].map((header) =>
    header
      .trim()
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, ""),
  );

  return rows
    .slice(1)
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? "").trim()])),
    );
}

/**
 * Converts a value entered in Brazilian reais to integer cents.
 *
 * Supported examples: 10000, 10.000, 10.000,50, 10k and "10 mil".
 * Returns null for empty, negative or ambiguous/invalid values.
 */
export function parseBrlToCents(rawValue: string | number | null | undefined): number | null {
  if (rawValue == null) return null;
  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue) && rawValue >= 0
      ? Math.round(rawValue * 100)
      : null;
  }

  let value = rawValue
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/\u00A0/g, " ")
    .replace(/^r\$\s*/, "");

  if (!value) return null;

  let multiplier = 1;
  if (/\s*(k|mil)\s*$/.test(value)) {
    multiplier = 1_000;
    value = value.replace(/\s*(k|mil)\s*$/, "");
  }

  value = value.replace(/\s/g, "");
  if (!/^\d+(?:[.,]\d+)*(?:,\d{1,2})?$/.test(value)) return null;

  const commaIndex = value.lastIndexOf(",");
  let normalized: string;

  if (commaIndex >= 0) {
    const integerPart = value.slice(0, commaIndex).replace(/\./g, "");
    const decimalPart = value.slice(commaIndex + 1);
    normalized = `${integerPart}.${decimalPart.padEnd(2, "0")}`;
  } else {
    const dotParts = value.split(".");
    if (dotParts.length > 1 && dotParts.slice(1).every((part) => part.length === 3)) {
      normalized = dotParts.join("");
    } else if (dotParts.length === 2 && dotParts[1].length <= 2) {
      normalized = value;
    } else if (dotParts.length === 1) {
      normalized = value;
    } else {
      return null;
    }
  }

  const amount = Number(normalized) * multiplier;
  if (!Number.isFinite(amount) || amount < 0) return null;

  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function firstValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]?.trim();
    if (value) {
      // Excel-compatible exports prefix formulas and identifiers with an
      // apostrophe. Restore the original value when the same file is imported.
      return /^'[=+\-@\d]/.test(value) ? value.slice(1) : value;
    }
  }
  return "";
}

function parseBoolean(value: string) {
  return ["1", "true", "sim", "s", "yes", "quente"].includes(
    value.trim().toLocaleLowerCase("pt-BR"),
  );
}

function parseStage(value: string): CrmStageId {
  const normalized = value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s*\/\s*/g, "_")
    .replace(/\s+/g, "_");

  const aliases: Record<string, CrmStageId> = {
    novo: "novo_contato",
    novo_contato: "novo_contato",
    triagem: "triagem",
    qualificacao: "triagem",
    consulta: "consulta_agendada",
    consulta_agendada: "consulta_agendada",
    proposta: "proposta",
    contrato: "contrato",
    em_andamento: "em_andamento",
    concluido: "encerrado",
    perdido: "encerrado",
    concluido_perdido: "encerrado",
    encerrado: "encerrado",
  };

  return aliases[normalized] ?? "novo_contato";
}

function dedupeKey(record: CrmCsvClient) {
  if (record.doc) return `doc:${record.doc.replace(/\D/g, "")}`;
  if (record.email) return `email:${record.email.toLocaleLowerCase("pt-BR")}`;
  if (record.phone) return `phone:${record.phone.replace(/\D/g, "")}`;
  return `name:${record.name.toLocaleLowerCase("pt-BR")}`;
}

export function parseCrmImportCsv(
  text: string,
  options: { maxRows?: number; defaultOwner?: string | null } = {},
): CrmCsvImportResult {
  const rows = parseCsvRows(text);
  const maxRows = Math.max(1, options.maxRows ?? DEFAULT_MAX_ROWS);
  const limitedRows = rows.slice(0, maxRows);
  const issues: CrmCsvIssue[] = [];
  const records: CrmCsvClient[] = [];
  const seen = new Set<string>();

  limitedRows.forEach((row, index) => {
    const csvRow = index + 2;
    const name = firstValue(row, ["name", "nome"]);
    if (name.length < 2) {
      issues.push({ row: csvRow, message: "Nome obrigatório com pelo menos 2 caracteres." });
      return;
    }

    const rawType = firstValue(row, ["type", "tipo"]).toLocaleUpperCase("pt-BR");
    const type: "PF" | "PJ" = rawType === "PJ" || rawType === "JURIDICA" ? "PJ" : "PF";
    const status = parseStage(firstValue(row, ["status", "etapa"]));
    // CSV values are always expressed in reais. An internal `value_cents`
    // column must never be interpreted as reais, otherwise an exported amount
    // could be multiplied by 100 on the next import.
    const rawValue = firstValue(row, ["value", "valor", "honorario", "honorarios"]);
    const valueCents = rawValue ? parseBrlToCents(rawValue) : 0;

    if (valueCents == null) {
      issues.push({ row: csvRow, message: `Honorário inválido: "${rawValue}".` });
      return;
    }

    const record: CrmCsvClient = {
      name,
      email: firstValue(row, ["email", "e-mail"]) || null,
      phone: firstValue(row, ["phone", "telefone", "whatsapp"]) || null,
      doc: firstValue(row, ["doc", "cpf", "cnpj", "cpf/cnpj"]) || null,
      type,
      status,
      area: firstValue(row, ["area", "area juridica"]) || null,
      value_cents: valueCents,
      owner: firstValue(row, ["owner", "responsavel"]) || options.defaultOwner || null,
      is_hot: parseBoolean(firstValue(row, ["is_hot", "hot", "quente"])),
    };

    const key = dedupeKey(record);
    if (seen.has(key)) {
      issues.push({ row: csvRow, message: "Registro duplicado dentro do arquivo." });
      return;
    }

    seen.add(key);
    records.push(record);
  });

  if (rows.length > maxRows) {
    issues.push({
      row: maxRows + 2,
      message: `O arquivo excede o limite de ${maxRows} registros por importação.`,
    });
  }

  return {
    records,
    issues,
    totalRows: rows.length,
    truncated: rows.length > maxRows,
  };
}

export function neutralizeSpreadsheetFormula(value: string) {
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function createCsv(
  rows: Record<string, string | number | null | undefined>[],
  delimiter = ";",
) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);

  const escapeCell = (raw: string | number | null | undefined) => {
    const value =
      typeof raw === "string"
        ? neutralizeSpreadsheetFormula(raw)
        : raw == null
          ? ""
          : String(raw);
    return new RegExp(`["${delimiter}\\n\\r]`).test(value)
      ? `"${value.replace(/"/g, '""')}"`
      : value;
  };

  return [
    headers.map(escapeCell).join(delimiter),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(delimiter)),
  ].join("\r\n");
}
