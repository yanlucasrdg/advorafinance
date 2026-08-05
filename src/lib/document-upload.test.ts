import { describe, expect, it } from "vitest";
import { DOCUMENT_MAX_BYTES, safeDocumentFileName, validateDocumentFile } from "./document-upload";

describe("document upload policy", () => {
  it("accepts supported legal document formats", () => {
    expect(validateDocumentFile({ name: "procuracao.pdf", size: 1024, type: "application/pdf" })).toBeNull();
  });

  it("rejects oversized, empty and executable files", () => {
    expect(validateDocumentFile({ name: "vazio.pdf", size: 0, type: "application/pdf" })).toBeTruthy();
    expect(validateDocumentFile({ name: "grande.pdf", size: DOCUMENT_MAX_BYTES + 1, type: "application/pdf" })).toBeTruthy();
    expect(validateDocumentFile({ name: "malware.exe", size: 100, type: "application/octet-stream" })).toBeTruthy();
  });

  it("removes path and unsafe filename characters", () => {
    expect(safeDocumentFileName("../../Procuração final?.pdf")).toBe("Procuracao_final_.pdf");
  });
});
