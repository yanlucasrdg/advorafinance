import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { syncCaseMovements } from "@/lib/datajud.functions";
import { useRealtimeTables } from "@/hooks/use-realtime-table";

export type Case = {
  id: string; number: string | null; title: string; court: string | null;
  area: string | null; status: string; value_cents: number | null;
  client_id: string | null; responsible: string | null; description: string | null;
  updated_at: string; created_at: string; status_version: number;
  tribunal?: string | null; class_name?: string | null;
  tenant_id?: string;
  last_movement_at?: string | null; datajud_synced_at?: string | null;
  clients?: { name: string } | null;
  [key: string]: any;
};

export type Deadline = { id: string; case_id: string | null; title: string; due_at: string; done: boolean; kind: string };
export type Entry = { id: string; case_id: string | null; amount_cents: number; status: string; kind: string };
export type Movement = { id: string; case_id: string; occurred_at: string; name: string; code: string | null; complement: string | null };
export type Client = { id: string; name: string };

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
      const { data, error } = await supabase.from("cases").select("*, clients(name)").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Case[];
    },
    enabled: !!profile?.tenant_id,
  });

  const queryClients = useQuery({
    queryKey: ["clients-light", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as Client[];
    },
    enabled: !!tenantId,
  });

  const queryDeadlines = useQuery({
    queryKey: ["deadlines-light", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("deadlines").select("id, case_id, title, due_at, done, kind");
      if (error) throw error;
      return (data ?? []) as Deadline[];
    },
    enabled: !!tenantId,
  });

  const queryEntries = useQuery({
    queryKey: ["entries-light", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("financial_entries").select("id, case_id, amount_cents, status, kind");
      if (error) throw error;
      return (data ?? []) as Entry[];
    },
    enabled: !!tenantId,
  });

  const create = useMutation({
    mutationFn: async (payload: any) => {
      const { data, error } = await supabase.from("cases").insert(payload as any).select("id").maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: (data, payload) => {
      qc.invalidateQueries({ queryKey: ["cases", profile?.tenant_id] });
      toast.success("Processo criado");
      
      // Auto-sync DataJud if CNJ is present
      if (data?.id && payload.number) {
        syncFn({ data: { caseId: data.id } })
          .then(() => toast.success("DataJud sincronizado em 2º plano"))
          .catch(() => {});
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, payload }: { id: string, payload: Partial<Case> }) => {
      const { error } = await supabase.from("cases").update(payload as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases", profile?.tenant_id] });
    },
    onError: (err) => toast.error(err.message),
  });

  const moveStatus = useMutation({
    mutationFn: async ({ id, status, expectedVersion }: { id: string; status: string; expectedVersion: number }) => {
      const { data, error } = await (supabase as any).rpc("move_case_status", {
        p_case_id: id,
        p_next_status: status,
        p_expected_version: expectedVersion,
      });
      if (error) throw error;
      return data as Case;
    },
    onMutate: async ({ id, status, expectedVersion }) => {
      await qc.cancelQueries({ queryKey: ["cases", tenantId] });
      const previous = qc.getQueryData<Case[]>(["cases", tenantId]);
      qc.setQueryData<Case[]>(["cases", tenantId], (current = []) => current.map((item) =>
        item.id === id && item.status_version === expectedVersion
          ? { ...item, status, status_version: item.status_version + 1, updated_at: new Date().toISOString() }
          : item
      ));
      return { previous };
    },
    onError: (err: Error, _variables, context) => {
      if (context?.previous) qc.setQueryData(["cases", tenantId], context.previous);
      qc.invalidateQueries({ queryKey: ["cases", tenantId] });
      toast.error(
        /CASE_STATUS_CONFLICT/i.test(err.message)
          ? "Este processo foi alterado por outra pessoa. Atualizamos o quadro."
          : "Não foi possível mover o processo."
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
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases", profile?.tenant_id] });
      toast.success("Processo removido");
    },
    onError: (err) => toast.error(err.message),
  });

  return {
    cases: queryCases.data ?? [],
    clients: queryClients.data ?? [],
    deadlines: queryDeadlines.data ?? [],
    entries: queryEntries.data ?? [],
    isLoading: queryCases.isLoading || queryClients.isLoading || queryDeadlines.isLoading || queryEntries.isLoading,
    create,
    update,
    moveStatus,
    remove,
  };
}
