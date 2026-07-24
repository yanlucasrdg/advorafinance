import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to Postgres changes on one or more tables and invalidate
 * the given React Query keys whenever any change lands.
 *
 * Usage:
 *   useRealtimeTables(["financial_entries", "cases"], ["dashboard"]);
 */
export function useRealtimeTables(tables: string[], invalidateKeys: (string | readonly (string | number | null | undefined)[])[]) {
  const qc = useQueryClient();
  useEffect(() => {
    if (tables.length === 0) return;
    const channel = supabase.channel(`rt:${tables.join(",")}:${Math.random().toString(36).slice(2, 8)}`);
    tables.forEach((table) => {
      (channel as unknown as { on: (t: string, f: Record<string, unknown>, cb: () => void) => void }).on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          invalidateKeys.forEach((k) => {
            const key = Array.isArray(k) ? k : [k];
            qc.invalidateQueries({ queryKey: key });
          });
        },
      );
    });
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join("|"), invalidateKeys.map((k) => (Array.isArray(k) ? k.join(".") : k)).join("|")]);
}
