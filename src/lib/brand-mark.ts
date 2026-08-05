export function getBrandInitial(brandName?: string | null) {
  const normalizedName = brandName?.trim();
  return normalizedName ? Array.from(normalizedName)[0].toUpperCase() : "A";
}
