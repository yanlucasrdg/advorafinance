import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type RateLimitScope =
  | "datajud_lookup"
  | "datajud_sync"
  | "zapi_status"
  | "zapi_qr_code"
  | "zapi_device"
  | "zapi_connection_action"
  | "zapi_send_text"
  | "copilot_prompt";

export async function enforceRateLimit(
  supabase: SupabaseClient<Database>,
  scope: RateLimitScope,
) {
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    _scope: scope,
  });

  if (error) throw new Error("NÃ£o foi possÃ­vel verificar o limite de uso. Tente novamente.");
  if (!data) throw new Error("Limite de uso atingido. Aguarde alguns instantes e tente novamente.");
}
