import { forwardRef, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { parseBrlInput } from "@/lib/currency";
import { cn } from "@/lib/utils";

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type CurrencyInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "onChange"
> & {
  valueInCents?: number;
  onValueChange: (valueInCents: number | undefined) => void;
};

type CurrencyDraft = {
  integerDigits: string;
  decimalDigits: string;
  decimalMode: boolean;
};

function draftFromCents(valueInCents: number | undefined): CurrencyDraft {
  if (valueInCents == null || !Number.isFinite(valueInCents)) {
    return { integerDigits: "", decimalDigits: "", decimalMode: false };
  }

  const safeCents = Math.max(0, Math.round(valueInCents));
  return {
    integerDigits: String(Math.floor(safeCents / 100)),
    decimalDigits: String(safeCents % 100).padStart(2, "0"),
    decimalMode: false,
  };
}

function centsFromDraft(draft: CurrencyDraft): number | undefined {
  if (!draft.integerDigits && !draft.decimalDigits) return undefined;

  const integerPart = Number(draft.integerDigits || "0");
  const decimalPart = Number(draft.decimalDigits.padEnd(2, "0").slice(0, 2) || "0");
  if (!Number.isSafeInteger(integerPart) || integerPart < 0) return undefined;

  const value = integerPart * 100 + decimalPart;
  return Number.isSafeInteger(value) ? value : undefined;
}

function formatDraft(draft: CurrencyDraft) {
  const cents = centsFromDraft(draft);
  return cents == null ? "" : brlFormatter.format(cents / 100);
}

/**
 * Brazilian currency field that keeps the value formatted while typing and
 * exposes only integer cents to the caller.
 *
 * Digits are appended to the reais portion. Press comma or dot to edit the
 * two decimal places. Example: 10000 is shown as R$ 10.000,00.
 */
const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  (
    { valueInCents, onValueChange, className, onBlur, onFocus, onKeyDown, onPaste, ...props },
    ref,
  ) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<CurrencyDraft>(() => draftFromCents(valueInCents));

    useEffect(() => {
      if (!editing) setDraft(draftFromCents(valueInCents));
    }, [editing, valueInCents]);

    const applyDraft = (nextDraft: CurrencyDraft) => {
      setDraft(nextDraft);
      onValueChange(centsFromDraft(nextDraft));
    };

    const appendDigit = (digit: string, replaceCurrentValue: boolean) => {
      const current = replaceCurrentValue
        ? { integerDigits: "", decimalDigits: "", decimalMode: false }
        : draft;

      if (current.decimalMode) {
        if (current.decimalDigits.length >= 2) return;
        applyDraft({
          ...current,
          decimalDigits: `${current.decimalDigits}${digit}`,
        });
        return;
      }

      const integerDigits = `${current.integerDigits}${digit}`
        .replace(/^0+(?=\d)/, "")
        .slice(0, 13);
      applyDraft({ ...current, integerDigits });
    };

    const clearValue = () => {
      applyDraft({ integerDigits: "", decimalDigits: "", decimalMode: false });
    };

    const display = editing
      ? formatDraft(draft)
      : valueInCents == null
        ? ""
        : brlFormatter.format(valueInCents / 100);

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={display}
        className={cn("tabular-nums", className)}
        onFocus={(event) => {
          setEditing(true);
          setDraft(draftFromCents(valueInCents));
          event.currentTarget.select();
          onFocus?.(event);
        }}
        onChange={(event) => {
          const insertedText = (event.nativeEvent as InputEvent).data;
          if (insertedText && /^\d$/.test(insertedText)) {
            const allSelected =
              event.currentTarget.selectionStart === 0 &&
              event.currentTarget.selectionEnd === display.length;
            appendDigit(insertedText, allSelected);
            return;
          }

          if (insertedText === "," || insertedText === ".") {
            applyDraft({ ...draft, decimalDigits: "", decimalMode: true });
            return;
          }

          const cents = parseBrlInput(event.currentTarget.value);
          if (cents == null) {
            if (!event.currentTarget.value.trim()) clearValue();
            return;
          }
          applyDraft(draftFromCents(cents));
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) {
            return;
          }

          const allSelected =
            event.currentTarget.selectionStart === 0 &&
            event.currentTarget.selectionEnd === display.length;

          if (/^\d$/.test(event.key)) {
            event.preventDefault();
            appendDigit(event.key, allSelected);
            return;
          }

          if (event.key === "," || event.key === ".") {
            event.preventDefault();
            applyDraft({
              ...(allSelected
                ? { integerDigits: "", decimalDigits: "", decimalMode: false }
                : draft),
              decimalDigits: "",
              decimalMode: true,
            });
            return;
          }

          if (event.key === "Backspace") {
            event.preventDefault();
            if (allSelected) {
              clearValue();
              return;
            }

            if (draft.decimalMode) {
              if (draft.decimalDigits) {
                applyDraft({
                  ...draft,
                  decimalDigits: draft.decimalDigits.slice(0, -1),
                });
              } else {
                applyDraft({ ...draft, decimalMode: false });
              }
              return;
            }

            applyDraft({
              ...draft,
              integerDigits: draft.integerDigits.slice(0, -1),
            });
            return;
          }

          if (event.key === "Delete" && allSelected) {
            event.preventDefault();
            clearValue();
          }
        }}
        onPaste={(event) => {
          onPaste?.(event);
          if (event.defaultPrevented) return;

          event.preventDefault();
          const cents = parseBrlInput(event.clipboardData.getData("text"));
          if (cents == null) return;
          applyDraft(draftFromCents(cents));
        }}
        onBlur={(event) => {
          setEditing(false);
          onValueChange(centsFromDraft(draft));
          onBlur?.(event);
        }}
      />
    );
  },
);
CurrencyInput.displayName = "CurrencyInput";

export { CurrencyInput };
