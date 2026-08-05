import { useState } from "react";

import { getBrandInitial } from "@/lib/brand-mark";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  brandName?: string | null;
  logoUrl?: string | null;
  className?: string;
  fallbackClassName?: string;
};

export function BrandMark({
  brandName,
  logoUrl,
  className,
  fallbackClassName,
}: BrandMarkProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const normalizedUrl = logoUrl?.trim() || null;

  if (normalizedUrl && failedUrl !== normalizedUrl) {
    return (
      <img
        src={normalizedUrl}
        alt={brandName?.trim() ? `Logotipo ${brandName.trim()}` : "Logotipo do escritório"}
        className={cn("object-contain", className)}
        onError={() => setFailedUrl(normalizedUrl)}
      />
    );
  }

  return (
    <span
      className={cn("grid place-items-center font-bold text-primary", className, fallbackClassName)}
      aria-label={brandName?.trim() ? `Marca ${brandName.trim()}` : "Marca Advora"}
      role="img"
    >
      {getBrandInitial(brandName)}
    </span>
  );
}
