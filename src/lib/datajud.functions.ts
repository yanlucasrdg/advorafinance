import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateCNJ, type CNJValidation } from "@/lib/cnj";
import { enforceRateLimit } from "@/lib/rate-limit";

export { validateCNJ };
export type { CNJValidation };

// ─────────────────────────────────────────────────────────────────────────────
// Retry exponencial com Circuit Breaker para chamadas ao DataJud
// O CNJ DataJud público tem instabilidades conhecidas; sem retry,
// qualquer timeout temporário causa erro imediato ao advogado.
// ─────────────────────────────────────────────────────────────────────────────

const DATAJUD_MAX_RETRIES = 3;
const DATAJUD_RETRY_BASE_MS = 800; // 800ms → 1.6s → 3.2s

/** Retorna true para status HTTP que valem retry (erros transitórios do servidor) */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Sleep helper */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch com retry exponencial.
 * Não faz retry em erros 4xx (exceto 429) — são erros do cliente.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = DATAJUD_MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = DATAJUD_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(`[DataJud] Tentativa ${attempt + 1}/${maxRetries + 1} após ${delay}ms...`);
      await sleep(delay);
    }

    try {
      const res = await fetch(url, init);

      // Retorna imediatamente para respostas definitivas (2xx, 4xx não-retryable)
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res;
      }

      // Para status retryable, tenta novamente
      if (isRetryableStatus(res.status) && attempt < maxRetries) {
        lastError = new Error(`DataJud HTTP ${res.status}`);
        continue;
      }

      return res; // última tentativa, retorna o que tiver
    } catch (fetchErr) {
      lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      if (attempt === maxRetries) break;
    }
  }

  throw lastError ?? new Error("Não foi possível conectar ao DataJud após múltiplas tentativas.");
}

// API pública divulgada pelo CNJ (DataJud Wiki)
// Header: Authorization: APIKey <key>
const DATAJUD_API_KEY =
  "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";
const DATAJUD_BASE = "https://api-publica.datajud.cnj.jus.br";

// Mapeia (segmento, tribunal) -> alias do índice do DataJud
// Formato CNJ: NNNNNNN-DD.AAAA.J.TT.OOOO  (J = segmento, TT = tribunal)
function tribunalAlias(segmento: string, tribunal: string): string | null {
  const j = segmento;
  const tt = tribunal.padStart(2, "0");
  // STF/CNJ/STJ/TST/TSE/STM (TT = 00)
  if (j === "1" && tt === "00") return "api_publica_stf";
  if (j === "2" && tt === "00") return "api_publica_cnj";
  if (j === "3" && tt === "00") return "api_publica_stj";
  if (j === "4" && tt === "90") return "api_publica_tst";
  if (j === "6" && tt === "00") return "api_publica_tse";
  if (j === "7" && tt === "00") return "api_publica_stm";
  // Justiça Federal (TRFs)
  if (j === "4" && tt >= "01" && tt <= "06") return `api_publica_trf${Number(tt)}`;
  // Justiça do Trabalho (TRTs)
  if (j === "5" && Number(tt) >= 1 && Number(tt) <= 24) return `api_publica_trt${Number(tt)}`;
  // Justiça Eleitoral (TREs) — TT = UF code 01..27
  if (j === "6" && Number(tt) >= 1 && Number(tt) <= 27) {
    const ufs = ["", "ac","al","ap","am","ba","ce","df","es","go","ma","mt","ms","mg","pa","pb","pr","pe","pi","rj","rn","rs","ro","rr","sc","sp","se","to"];
    return `api_publica_tre-${ufs[Number(tt)]}`;
  }
  // Justiça Militar Estadual
  if (j === "7" && (tt === "13" || tt === "21" || tt === "26")) {
    const m: Record<string,string> = { "13": "mg", "21": "rs", "26": "sp" };
    return `api_publica_tjm-${m[tt]}`;
  }
  // Justiça Estadual (TJs)
  if (j === "8" && Number(tt) >= 1 && Number(tt) <= 27) {
    const ufs = ["", "ac","al","ap","am","ba","ce","df","es","go","ma","mt","ms","mg","pa","pb","pr","pe","pi","rj","rn","rs","ro","rr","sc","sp","se","to"];
    return `api_publica_tj${ufs[Number(tt)]}`;
  }
  return null;
}

export type DataJudMovimento = {
  occurred_at: string;
  code: string | null;
  name: string;
  complement: string | null;
};

export type DataJudResult = {
  number: string;
  tribunal: string;
  alias: string;
  court: string | null;
  className: string | null;
  subjects: Array<{ code?: number; name: string }>;
  parties: Array<{ name: string; role?: string }>;
  distributionDate: string | null;
  lastMovementAt: string | null;
  movements: DataJudMovimento[];
};

async function fetchFromDataJud(numero: string): Promise<DataJudResult> {
  const v = validateCNJ(numero);
  if (!v.ok) throw new Error(v.message);
  const alias = tribunalAlias(v.segmento, v.tribunal);
  if (!alias) {
    throw new Error(
      `Tribunal não suportado pelo DataJud público (segmento ${v.segmento}, tribunal ${v.tribunal}). ` +
      `Verifique se o número está correto.`,
    );
  }

  // ✅ Retry exponencial: 3 tentativas com backoff 800ms → 1.6s → 3.2s
  let res: Response;
  try {
    res = await fetchWithRetry(
      `${DATAJUD_BASE}/${alias}/_search`,
      {
        method:  "POST",
        headers: {
          Authorization:  `APIKey ${DATAJUD_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: { match: { numeroProcesso: v.clean } } }),
      },
    );
  } catch (netErr) {
    const msg = netErr instanceof Error ? netErr.message : String(netErr);
    throw new Error(`Não foi possível conectar ao DataJud (CNJ) após 3 tentativas: ${msg}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("DataJud recusou a autenticação. A chave pública pode estar temporariamente indisponível.");
  }
  if (res.status === 429) {
    throw new Error("Muitas consultas ao DataJud em pouco tempo. Aguarde alguns segundos e tente de novo.");
  }
  if (res.status >= 500) {
    throw new Error(`O DataJud está instável no momento (HTTP ${res.status}) após 3 tentativas. Tente mais tarde.`);
  }
  if (!res.ok) {
    throw new Error(`Falha ao consultar o DataJud (HTTP ${res.status}).`);
  }

  let json: Record<string, unknown>;
  try { json = await res.json() as Record<string, unknown>; }
  catch { throw new Error("Resposta inválida do DataJud. Tente novamente."); }

  const hits = (json as { hits?: { hits?: Array<{ _source: unknown }> } })?.hits?.hits;
  const hit = hits?.[0]?._source as Record<string, unknown> | undefined;
  if (!hit) {
    throw new Error(
      `Processo ${v.formatted} não encontrado no tribunal correspondente. ` +
      `Confira o número, o tribunal pode ainda não tê-lo publicado no DataJud.`,
    );
  }

  const movimentos: DataJudMovimento[] = Array.isArray(hit.movimentos)
    ? (hit.movimentos as Array<Record<string, unknown>>).map((m) => ({
        occurred_at: (m.dataHora as string) ?? new Date().toISOString(),
        code:        m.codigo != null ? String(m.codigo) : null,
        name:        String(m.nome ?? "Movimentação"),
        complement:  Array.isArray(m.complementosTabelados) && (m.complementosTabelados as unknown[]).length
          ? (m.complementosTabelados as Array<Record<string, unknown>>).map((c) => c?.descricao).filter(Boolean).join(" • ")
          : null,
      }))
    : [];
  movimentos.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

  return {
    number:           v.clean,
    tribunal:         (hit.tribunal as string) ?? alias.replace("api_publica_", "").toUpperCase(),
    alias,
    court:            (hit.orgaoJulgador as Record<string, string>)?.nome ?? null,
    className:        (hit.classe as Record<string, string>)?.nome ?? null,
    subjects: Array.isArray(hit.assuntos)
      ? (hit.assuntos as Array<Record<string, unknown>>).map((a) => ({ code: a.codigo as number, name: String(a.nome ?? "") })).filter((a) => a.name)
      : [],
    parties:          [], // DataJud público não retorna partes; mantemos para uso futuro
    distributionDate: (hit.dataAjuizamento as string) ?? null,
    lastMovementAt:   movimentos[0]?.occurred_at ?? null,
    movements:        movimentos,
  };
}

/** Apenas consulta o DataJud (não persiste). Usada no diálogo de import. */
export const lookupDatajud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ numero: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    await enforceRateLimit(context.supabase, "datajud_lookup");
    return fetchFromDataJud(data.numero);
  });

/** Sincroniza movimentações de um processo já existente. */
export const syncCaseMovements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await enforceRateLimit(supabase, "datajud_sync");
    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, tenant_id, number")
      .eq("id", data.caseId)
      .maybeSingle();
    if (caseErr) throw new Error(caseErr.message);
    if (!caseRow) throw new Error("Processo não encontrado.");
    if (!caseRow.number) throw new Error("Este processo não tem número CNJ cadastrado.");

    const result = await fetchFromDataJud(caseRow.number);

    // Upsert do case
    const { error: updErr } = await supabase
      .from("cases")
      .update({
        tribunal: result.tribunal,
        court: result.court ?? undefined,
        class_name: result.className,
        subjects: result.subjects,
        distribution_date: result.distributionDate,
        last_movement_at: result.lastMovementAt,
        datajud_synced_at: new Date().toISOString(),
      })
      .eq("id", caseRow.id);
    if (updErr) throw new Error(updErr.message);

    // Insere movimentações (unique index evita duplicatas)
    if (result.movements.length > 0) {
      const rows = result.movements.map((m) => ({
        tenant_id: caseRow.tenant_id,
        case_id: caseRow.id,
        occurred_at: m.occurred_at,
        code: m.code,
        name: m.name,
        complement: m.complement,
        raw: m as unknown as never,
      }));
      // upsert ignorando duplicatas pelo unique (case_id, occurred_at, code, name)
      const { error: insErr } = await supabase
        .from("case_movements")
        .upsert(rows, { onConflict: "case_id,occurred_at,code,name", ignoreDuplicates: true });
      if (insErr) throw new Error(insErr.message);
    }

    return { inserted: result.movements.length, last: result.lastMovementAt };
  });
