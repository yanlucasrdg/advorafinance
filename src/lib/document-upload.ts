export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf", "png", "jpg", "jpeg",
]);

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "application/rtf",
  "text/rtf",
  "image/png",
  "image/jpeg",
]);

export type DocumentFileInfo = { name: string; size: number; type: string };

export function validateDocumentFile(file: DocumentFileInfo): string | null {
  if (file.size <= 0) return "O arquivo está vazio.";
  if (file.size > DOCUMENT_MAX_BYTES) return "O arquivo excede o limite de 25 MB.";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension)) return "Formato não permitido. Envie PDF, Office, texto ou imagem.";
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) return "O tipo real do arquivo não é permitido.";
  return null;
}

export function safeDocumentFileName(name: string) {
  const basename = name.split(/[\\/]/).pop() ?? "";
  const normalized = basename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-160);
  return safe || "documento";
}
