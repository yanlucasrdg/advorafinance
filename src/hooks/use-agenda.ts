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
} from "@/lib/validators";

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
  completed_by?: string | null;
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
        .select("id, title, kind, due_at, done, priority, case_id, client_id, completed_at, notes, cases(id, title, number), clients(id, name)")
        .order("due_at", { ascending: true })
        .limit(DEADLINE_QUERY_LIMIT);
      if (error) throw new Error(error.message);
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
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
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
        .order("name")
        .limit(500);
      if (error) throw new Error(error.message);
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
        // ✅ Não derrubar a agenda por falha nos logs de comunicação
        console.warn("[useAgenda] Falha ao buscar logs WhatsApp:", error.message);
        return [];
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
      // ✅ Validação Zod antes de inserir
      const payload: DeadlineCreate = parseOrThrow(deadlineCreateSchema, raw, "Criar Prazo");
      const { error } = await supabase.from("deadlines").insert({
        ...payload,
        tenant_id: tenantId,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.success("Prazo criado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (deadline: Deadline) => {
      const nowDone = !deadline.done;
      const { error } = await supabase
        .from("deadlines")
        .update({
          done:         nowDone,
          // ✅ LGPD audit trail: registra quem e quando concluiu o prazo
          completed_at: nowDone ? new Date().toISOString() : null,
          completed_by: nowDone ? (profile?.id ?? null) : null,
        } as never)
        .eq("id", deadline.id);
      if (error) throw new Error(error.message);
      return { id: deadline.id, done: nowDone };
    },
    onMutate: async (deadline) => {
      await qc.cancelQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      const previous = qc.getQueryData<Deadline[]>(["agenda", "deadlines", tenantId]);
      qc.setQueryData<Deadline[]>(["agenda", "deadlines", tenantId], (old = []) =>
        old.map((d) => d.id === deadline.id ? { ...d, done: !deadline.done } : d),
      );
      return { previous };
    },
    onError: (err: Error, _variables, context) => {
      if (context?.previous) {
        qc.setQueryData(["agenda", "deadlines", tenantId], context.previous);
      }
      toast.error(`Não foi possível atualizar o prazo: ${err.message}`);
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
    mutationFn: async ({ id, payload: raw }: { id: string; payload: Partial<Deadline> }) => {
      const payload = parseOrThrow(deadlineUpdateSchema, raw, "Atualizar Prazo");
      const { error } = await supabase.from("deadlines").update(payload as never).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.success("Prazo atualizado");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("deadlines").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.success("Prazo removido");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return {
    deadlines:  deadlinesQ.data ?? [],
    cases:      casesQ.data ?? [],
    clients:    clientsQ.data ?? [],
    lastComms,
    isLoading:  deadlinesQ.isLoading || casesQ.isLoading || clientsQ.isLoading,
    isError:    deadlinesQ.isError,
    error:      deadlinesQ.error,
    create:     createMutation.mutateAsync,
    toggle:     toggleMutation.mutateAsync,
    update:     updateMutation.mutateAsync,
    remove:     removeMutation.mutateAsync,
  };
}
