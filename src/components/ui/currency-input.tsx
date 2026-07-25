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

/** A currency field that presents Brazilian reais and exposes integer cents. */
const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ valueInCents, onValueChange, className, onFocus, ...props }, ref) => {
    const [display, setDisplay] = useState(valueInCents == null ? "" : brlFormatter.format(valueInCents / 100));

    useEffect(() => {
      setDisplay(valueInCents == null ? "" : brlFormatter.format(valueInCents / 100));
    }, [valueInCents]);

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
          event.currentTarget.select();
          onFocus?.(event);
        }}
        onChange={(event) => {
          const digits = event.currentTarget.value.replace(/\D/g, "");
          if (!digits) {
            setDisplay("");
            onValueChange(undefined);
            return;
          }
          const cents = Number(digits);
          setDisplay(brlFormatter.format(cents / 100));
          onValueChange(cents);
        }}
      />
    );
  },
);
CurrencyInput.displayName = "CurrencyInput";

export { CurrencyInput };
