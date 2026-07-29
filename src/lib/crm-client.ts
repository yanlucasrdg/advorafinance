export type CrmClientMetadataSource = {
  area?: string | null;
  value_cents?: number | null;
  owner?: string | null;
  is_hot?: boolean | null;
  notes?: string | null;
};

export type CrmClientMeta = {
  area: string;
  value: number;
  valueCents: number;
  owner: string;
  hot: boolean;
};

type LegacyClientMetadata = {
  area?: unknown;
  value?: unknown;
  owner?: unknown;
  hot?: unknown;
};

function parseLegacyMetadata(notes: string | null | undefined): LegacyClientMetadata {
  if (!notes) return {};
  try {
    const parsed: unknown = JSON.parse(notes);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as LegacyClientMetadata)
      : {};
  } catch {
    return {};
  }
}

/**
 * Reads normalized CRM columns first and temporarily falls back to the legacy
 * metadata stored in notes. The fallback can be removed after every deployed
 * tenant has run the corrective backfill migration.
 */
export function getCrmClientMeta(client: CrmClientMetadataSource): CrmClientMeta {
  const legacy = parseLegacyMetadata(client.notes);
  const legacyValue = Number(legacy.value);
  const normalizedValue =
    typeof client.value_cents === "number" &&
    Number.isSafeInteger(client.value_cents) &&
    client.value_cents >= 0
      ? client.value_cents
      : null;
  const legacyValueCents =
    Number.isFinite(legacyValue) && legacyValue >= 0
      ? Math.round(legacyValue * 100)
      : null;

  // value_cents was introduced with DEFAULT 0. Existing rows therefore need
  // this transitional preference until the corrective migration is applied.
  const valueCents =
    normalizedValue != null && (normalizedValue > 0 || legacyValueCents == null)
      ? normalizedValue
      : (legacyValueCents ?? 0);

  const normalizedArea = client.area?.trim();
  const legacyArea = typeof legacy.area === "string" ? legacy.area.trim() : "";
  const normalizedOwner = client.owner?.trim();
  const legacyOwner = typeof legacy.owner === "string" ? legacy.owner.trim() : "";

  return {
    area: normalizedArea || legacyArea || "Não definido",
    value: valueCents / 100,
    valueCents,
    owner: normalizedOwner || legacyOwner || "Sem responsável",
    hot: client.is_hot === true || legacy.hot === true,
  };
}
