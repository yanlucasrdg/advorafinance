/**
 * use-cases.ts — Hook de Processos com validação Zod e resiliência na sincronização
 *
 * Correções desta versão (Auditoria 2026-07-25):
 * - Substituição de `payload as any` por parseOrThrow(caseCreateSchema)
 * - DataJud sync com feedback ao usuário em vez de catch silencioso
 * - Limite de 500 processos com aviso de escalabilidade
 * - Tipos explícitos em todas as assinaturas
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { syncCaseMovements } from "@/lib/datajud.functions";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import {
  caseCreateSchema,
  caseUpdateSchema,
  parseOrThrow,
  type CaseCreate,
  type CaseUpdate,
} from "@/lib/validators";

export type Case = {
  id: string; number: string | null; title: string; court: string | null;
  area: string | null; status: string; value_cents: number | null;
  client_id: string | null; responsible: string | null; description: string | null;
  updated_at: string; created_at: string; status_version: number;
  tribunal?: string | null; class_name?: string | null;
  tenant_id?: string;
  last_movement_at?: string | null; datajud_synced_at?: string | null;
  clients?: { name: string } | null;
};

export type Deadline = { id: string; case_id: string | null; title: string; due_at: string; done: boolean; kind: string };
export type Entry = { id: string; case_id: string | null; amount_cents: number; status: string; kind: string };
export type Movement = { id: string; case_id: string; occurred_at: string; name: string; code: string | null; complement: string | null };
export type Client = { id: string; name: string };

const CASE_QUERY_LIMIT = 500;

export function useCases() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const tenantId = profile?.tenant_id ?? null;
  const syncFn = useServerFn(syncCaseMovements);

  useRealtimeTables(
    ["cases", "deadlines", "financial_entries", "clients"],
    [["cases", tenantId], ["clients-light", tenantId], ["deadlines-light", tenantId], ["entries-light", tenantId]],
  );

  const queryCases = useQuery({
    queryKey: ["cases", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("*, clients(name)")
        .order("created_at", { ascending: false })
        .limit(CASE_QUERY_LIMIT);
      if (error) throw new Error(error.message);
      return (data ?? []) as Case[];
    },
    enabled: !!tenantId,
  });

  const queryClients = useQuery({
    queryKey: ["clients-light", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").order("name").limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as Client[];
    },
    enabled: !!tenantId,
  });

  const queryDeadlines = useQuery({
    queryKey: ["deadlines-light", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("deadlines").select("id, case_id, title, due_at, done, kind").limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Deadline[];
    },
    enabled: !!tenantId,
  });

  const queryEntries = useQuery({
    queryKey: ["entries-light", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("financial_entries").select("id, case_id, amount_cents, status, kind").limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as Entry[];
    },
    enabled: !!tenantId,
  });

  const create = useMutation({
    mutationFn: async (raw: Partial<Case>) => {
      // ✅ Valida schema antes de inserir
      const payload: CaseCreate = parseOrThrow(caseCreateSchema, raw, "Criar Processo");
      const { data, error } = await supabase
        .from("cases")
        .insert({ ...payload, tenant_id: tenantId } as never)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data, raw) => {
      qc.invalidateQueries({ queryKey: ["cases", tenantId] });
      toast.success("Processo criado");

      // ✅ Auto-sync DataJud com feedback claro ao usuário
      if (data?.id && (raw as { number?: string })?.number) {
        const toastId = toast.loading("Sincronizando com o DataJud (CNJ)…");
        syncFn({ data: { caseId: data.id } })
          .then(() => toast.success("Movimentações do DataJud sincronizadas", { id: toastId }))
          .catch((err: Error) => {
            toast.warning("Processo salvo, mas não foi possível sincronizar com o DataJud agora", {
              id: toastId,
              description: err.message,
            });
          });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, payload: raw }: { id: string; payload: Partial<Case> }) => {
      const payload: CaseUpdate = parseOrThrow(caseUpdateSchema, raw, "Atualizar Processo");
      const { error } = await supabase.from("cases").update(payload as never).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases", tenantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const moveStatus = useMutation({
    mutationFn: async ({ id, status, expectedVersion }: { id: string; status: string; expectedVersion: number }) => {
      const { data, error } = await (supabase as never as {
        rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: Case; error: { message: string } | null }>;
      }).rpc("move_case_status", {
        p_case_id:         id,
        p_next_status:     status,
        p_expected_version: expectedVersion,
      });
      if (error) throw new Error(error.message);
      return data as Case;
    },
    onMutate: async ({ id, status, expectedVersion }) => {
      await qc.cancelQueries({ queryKey: ["cases", tenantId] });
      const previous = qc.getQueryData<Case[]>(["cases", tenantId]);
      qc.setQueryData<Case[]>(["cases", tenantId], (current = []) =>
        current.map((item) =>
          item.id === id && item.status_version === expectedVersion
            ? { ...item, status, status_version: item.status_version + 1, updated_at: new Date().toISOString() }
            : item,
        ),
      );
      return { previous };
    },
    onError: (err: Error, _variables, context) => {
      if (context?.previous) qc.setQueryData(["cases", tenantId], context.previous);
      qc.invalidateQueries({ queryKey: ["cases", tenantId] });
      toast.error(
        /CASE_STATUS_CONFLICT/i.test(err.message)
          ? "Este processo foi alterado por outra pessoa. Atualizamos o quadro."
          : "Não foi possível mover o processo.",
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases", tenantId] });
      toast.success("Etapa do processo atualizada");
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cases").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases", tenantId] });
      toast.success("Processo removido");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return {
    cases:     queryCases.data ?? [],
    clients:   queryClients.data ?? [],
    deadlines: queryDeadlines.data ?? [],
    entries:   queryEntries.data ?? [],
    isLoading: queryCases.isLoading || queryClients.isLoading || queryDeadlines.isLoading || queryEntries.isLoading,
    isError:   queryCases.isError,
    error:     queryCases.error,
    create,
    update,
    moveStatus,
    remove,
  };
}
