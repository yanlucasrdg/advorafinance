const PHONE_FORMAT_ERROR =
  "Telefone inválido. Cadastre com DDI, DDD e número (ex.: +55 21 99999-9999).";

/**
 * Normalizes a user-entered WhatsApp phone number to digits-only E.164.
 *
 * Brazilian national numbers may omit the country code. International numbers
 * must make their country code explicit with a leading `+`, which prevents an
 * ambiguous value from being sent to the wrong contact.
 */
export function normalizeWhatsAppPhone(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) throw new Error(PHONE_FORMAT_ERROR);

  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    const invalidBrazilianLength =
      digits.startsWith("55") && digits.length !== 12 && digits.length !== 13;
    if (
      digits.length < 10 ||
      digits.length > 15 ||
      digits.startsWith("0") ||
      invalidBrazilianLength
    ) {
      throw new Error(PHONE_FORMAT_ERROR);
    }
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;

  throw new Error(PHONE_FORMAT_ERROR);
}
