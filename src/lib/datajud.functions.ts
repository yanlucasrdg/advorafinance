import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

function parseCNJ(raw: string): { clean: string; segmento: string; tribunal: string } | null {
  const clean = raw.replace(/\D/g, "");
  if (clean.length !== 20) return null;
  // NNNNNNN DD AAAA J TT OOOO
  const segmento = clean.slice(13, 14);
  const tribunal = clean.slice(14, 16);
  return { clean, segmento, tribunal };
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
  const parsed = parseCNJ(numero);
  if (!parsed) throw new Error("Número CNJ inválido. Use o formato NNNNNNN-DD.AAAA.J.TT.OOOO.");
  const alias = tribunalAlias(parsed.segmento, parsed.tribunal);
  if (!alias) throw new Error("Tribunal não suportado pelo DataJud público para este número.");

  const res = await fetch(`${DATAJUD_BASE}/${alias}/_search`, {
    method: "POST",
    headers: {
      "Authorization": `APIKey ${DATAJUD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { match: { numeroProcesso: parsed.clean } } }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha DataJud (${res.status}). ${text.slice(0, 120)}`);
  }
  const json = (await res.json()) as any;
  const hit = json?.hits?.hits?.[0]?._source;
  if (!hit) throw new Error("Processo não encontrado no DataJud.");

  const movimentos: DataJudMovimento[] = Array.isArray(hit.movimentos)
    ? hit.movimentos.map((m: any) => ({
        occurred_at: m.dataHora ?? new Date().toISOString(),
        code: m.codigo != null ? String(m.codigo) : null,
        name: String(m.nome ?? "Movimentação"),
        complement: Array.isArray(m.complementosTabelados) && m.complementosTabelados.length
          ? m.complementosTabelados.map((c: any) => c?.descricao).filter(Boolean).join(" • ")
          : null,
      }))
    : [];
  movimentos.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

  return {
    number: parsed.clean,
    tribunal: hit.tribunal ?? alias.replace("api_publica_", "").toUpperCase(),
    alias,
    court: hit.orgaoJulgador?.nome ?? null,
    className: hit.classe?.nome ?? null,
    subjects: Array.isArray(hit.assuntos)
      ? hit.assuntos.map((a: any) => ({ code: a.codigo, name: String(a.nome ?? "") })).filter((a: any) => a.name)
      : [],
    parties: [], // DataJud público não retorna partes; mantemos para uso futuro
    distributionDate: hit.dataAjuizamento ?? null,
    lastMovementAt: movimentos[0]?.occurred_at ?? null,
    movements: movimentos,
  };
}

/** Apenas consulta o DataJud (não persiste). Usada no diálogo de import. */
export const lookupDatajud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string }) => d)
  .handler(async ({ data }) => fetchFromDataJud(data.numero));

/** Sincroniza movimentações de um processo já existente. */
export const syncCaseMovements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { caseId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
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
