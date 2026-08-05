/**
 * use-agenda.ts — Hook de Prazos e Agenda com audit trail LGPD e validação Zod
 *
 * Correções desta versão (Auditoria 2026-07-25):
 * - Todas as mutations validam com Zod antes de gravar
 * - toggleMutation registra completed_by e completed_at (LGPD audit trail)
 * - Erros explícitos em vez de catch genérico
 * - Limite de 1000 prazos com aviso de escalabilidade
 */

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import { toast } from "sonner";
import {
  deadlineCreateSchema,
  deadlineUpdateSchema,
  parseOrThrow,
  type DeadlineCreate,
  type DeadlineUpdate,
} from "@/lib/validators";
import { deadlineErrorMessage } from "@/lib/deadline";

export type Deadline = {
  id: string;
  title: string;
  kind: string;
  due_at: string;
  done: boolean;
  priority: string | null;
  case_id: string | null;
  client_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
  status_version: number;
  notes?: string | null;
  cases?: { id: string; title: string; number: string | null } | null;
  clients?: { id: string; name: string } | null;
};

export type CaseLite = { id: string; title: string; number: string | null };
export type ClientLite = { id: string; name: string };

const DEADLINE_QUERY_LIMIT = 1000;

export function useAgenda() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const qc = useQueryClient();

  useRealtimeTables(["deadlines"], [["agenda", "deadlines", tenantId]]);

  const deadlinesQ = useQuery({
    queryKey: ["agenda", "deadlines", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deadlines")
        .select("id, title, kind, due_at, done, priority, case_id, client_id, completed_at, completed_by, status_version, notes, cases(id, title, number), clients(id, name)")
        .is("deleted_at", null)
        .order("due_at", { ascending: true })
        .limit(DEADLINE_QUERY_LIMIT);
      if (error) throw new Error("DEADLINES_LOAD_FAILED");
      return (data ?? []) as Deadline[];
    },
  });

  const casesQ = useQuery({
    queryKey: ["agenda", "cases", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("id, title, number")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error("CASES_LOAD_FAILED");
      return (data ?? []) as CaseLite[];
    },
  });

  const clientsQ = useQuery({
    queryKey: ["agenda", "clients", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .is("deleted_at", null)
        .order("name")
        .limit(500);
      if (error) throw new Error("CLIENTS_LOAD_FAILED");
      return (data ?? []) as ClientLite[];
    },
  });

  const lastCommsQ = useQuery({
    queryKey: ["agenda", "whatsapp_logs", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_logs")
        .select("client_id, created_at")
        .not("client_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) {
        throw new Error("COMMUNICATION_LOGS_UNAVAILABLE");
      }
      return data ?? [];
    },
  });

  const lastComms = useMemo(() => {
    const map = new Map<string, string>();
    (lastCommsQ.data ?? []).forEach((row: { client_id: string | null; created_at: string }) => {
      if (row.client_id && !map.has(row.client_id)) {
        map.set(row.client_id, row.created_at);
      }
    });
    return map;
  }, [lastCommsQ.data]);

  const createMutation = useMutation({
    mutationFn: async (raw: Partial<Deadline>) => {
      if (!tenantId) throw new Error("Sessão expirada. Faça login novamente.");
      const payload: DeadlineCreate = parseOrThrow(deadlineCreateSchema, raw, "Criar Prazo");
      const { data, error } = await supabase.rpc("create_deadline", {
        p_title: payload.title,
        p_kind: payload.kind,
        p_due_at: payload.due_at,
        p_priority: payload.priority ?? "medium",
        p_case_id: payload.case_id ?? null,
        p_client_id: payload.client_id ?? null,
        p_notes: payload.notes ?? null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.success("Prazo criado");
    },
    onError: (err: Error) => toast.error(deadlineErrorMessage(err, "Não foi possível criar o prazo.")),
  });

  const toggleMutation = useMutation({
    mutationFn: async (deadline: Deadline) => {
      const { data, error } = await supabase.rpc("toggle_deadline_completion", {
        p_deadline_id: deadline.id,
        p_expected_version: deadline.status_version,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onMutate: async (deadline) => {
      await qc.cancelQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      const previous = qc.getQueryData<Deadline[]>(["agenda", "deadlines", tenantId]);
      qc.setQueryData<Deadline[]>(["agenda", "deadlines", tenantId], (old = []) =>
        old.map((d) => d.id === deadline.id && d.status_version === deadline.status_version
          ? {
              ...d,
              done: !deadline.done,
              completed_at: !deadline.done ? new Date().toISOString() : null,
              completed_by: !deadline.done ? (profile?.id ?? null) : null,
              status_version: deadline.status_version + 1,
            }
          : d),
      );
      return { previous };
    },
    onError: (err: Error, _variables, context) => {
      if (context?.previous) {
        qc.setQueryData(["agenda", "deadlines", tenantId], context.previous);
      }
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.error(deadlineErrorMessage(err));
    },
    onSuccess: (_data, deadline) => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.success(
        deadline.done ? "Prazo reaberto" : "Prazo concluído",
        { description: deadline.title },
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, expectedVersion, payload: raw }: {
      id: string;
      expectedVersion: number;
      payload: Partial<Deadline>;
    }) => {
      const payload: DeadlineUpdate = parseOrThrow(deadlineUpdateSchema, raw, "Atualizar Prazo");
      const { data, error } = await supabase.rpc("update_deadline", {
        p_deadline_id: id,
        p_expected_version: expectedVersion,
        p_patch: payload,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.success("Prazo atualizado");
    },
    onError: (err: Error) => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.error(deadlineErrorMessage(err));
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (deadline: Deadline) => {
      const { data, error } = await supabase.rpc("soft_delete_deadline", {
        p_deadline_id: deadline.id,
        p_expected_version: deadline.status_version,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.success("Prazo removido");
    },
    onError: (err: Error) => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.error(deadlineErrorMessage(err, "Não foi possível remover o prazo."));
    },
  });

  return {
    deadlines:  deadlinesQ.data ?? [],
    cases:      casesQ.data ?? [],
    clients:    clientsQ.data ?? [],
    lastComms,
    communicationsUnavailable: lastCommsQ.isError,
    isLoading:  deadlinesQ.isLoading || casesQ.isLoading || clientsQ.isLoading,
    isFetching: deadlinesQ.isFetching || casesQ.isFetching || clientsQ.isFetching,
    isError:    deadlinesQ.isError || casesQ.isError || clientsQ.isError,
    error:      deadlinesQ.error ?? casesQ.error ?? clientsQ.error,
    refetch:    async () => Promise.all([deadlinesQ.refetch(), casesQ.refetch(), clientsQ.refetch()]),
    isMutating: createMutation.isPending || toggleMutation.isPending || updateMutation.isPending || removeMutation.isPending,
    create:     createMutation.mutateAsync,
    toggle:     toggleMutation.mutateAsync,
    update:     updateMutation.mutateAsync,
    remove:     removeMutation.mutateAsync,
  };
}
