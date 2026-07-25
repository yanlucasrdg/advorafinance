import { forwardRef, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type CurrencyInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  valueInCents?: number;
  onValueChange: (valueInCents: number | undefined) => void;
};

function parseBrlInput(input: string): number | undefined {
  let raw = input.trim().toLowerCase().replace(/^r\$\s*/, "").replace(/\s/g, "");
  if (!raw) return undefined;

  let multiplier = 1;
  if (raw.endsWith("mil")) { multiplier = 1_000; raw = raw.slice(0, -3); }
  else if (raw.endsWith("k")) { multiplier = 1_000; raw = raw.slice(0, -1); }
  else if (raw.endsWith("mi") || raw.endsWith("m")) { multiplier = 1_000_000; raw = raw.replace(/m(i)?$/, ""); }

  raw = raw.trim();
  if (!raw || !/^[\d.,]+$/.test(raw)) return undefined;

  // pt-BR accepts 10.000,50. A lone dot with three digits after it is treated
  // as a thousands separator; other lone dots work as a decimal convenience.
  let normalized: string;
  if (raw.includes(",")) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if ((raw.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(raw)) normalized = raw.replace(/\./g, "");
  else normalized = raw;

  const reais = Number(normalized) * multiplier;
  if (!Number.isFinite(reais) || reais < 0) return undefined;
  return Math.round(reais * 100);
}

/** A currency field that presents Brazilian reais and exposes integer cents. */
const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ valueInCents, onValueChange, className, onFocus, ...props }, ref) => {
    const [display, setDisplay] = useState(valueInCents == null ? "" : brlFormatter.format(valueInCents / 100));
    const [editing, setEditing] = useState(false);

    useEffect(() => {
      if (!editing) setDisplay(valueInCents == null ? "" : brlFormatter.format(valueInCents / 100));
    }, [editing, valueInCents]);

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        className={cn("tabular-nums", className)}
        onFocus={(event) => {
          setEditing(true);
          setDisplay(valueInCents == null ? "" : String(valueInCents / 100).replace(".", ","));
          event.currentTarget.select();
          onFocus?.(event);
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDisplay(next);
          const cents = parseBrlInput(next);
          if (cents == null) {
            if (!next.trim()) onValueChange(undefined);
            return;
          }
          onValueChange(cents);
        }}
        onBlur={(event) => {
          setEditing(false);
          const cents = parseBrlInput(event.currentTarget.value);
          if (cents == null) {
            setDisplay("");
            onValueChange(undefined);
            return;
          }
          setDisplay(brlFormatter.format(cents / 100));
          onValueChange(cents);
        }}
      />
    );
  },
);
CurrencyInput.displayName = "CurrencyInput";

export { CurrencyInput };
