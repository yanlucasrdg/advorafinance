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
export function useRealtimeTables(tables: string[], invalidateKeys: (string | (string | number)[])[]) {
  const qc = useQueryClient();
  useEffect(() => {
    if (tables.length === 0) return;
    const channel = supabase.channel(`rt:${tables.join(",")}:${Math.random().toString(36).slice(2, 8)}`);
    tables.forEach((table) => {
      channel.on(
        // @ts-expect-error supabase-js typing for postgres_changes is loose
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
