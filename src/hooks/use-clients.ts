/**
 * use-clients.ts — Hook de Clientes com validação Zod e LGPD compliance
 *
 * Correções desta versão (Auditoria 2026-07-25):
 * - Substituição de `payload as any` por parseOrThrow(clientCreateSchema)
 * - Mudança de etapa atômica com lock otimista e auditoria obrigatória
 * - Exclusão lógica para preservar vínculos jurídicos e trilha LGPD
 * - toggleHot com onError explícito
 * - Limite de 500 registros com aviso ao atingir
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import { toast } from "sonner";
import {
  clientCreateSchema,
  clientStatusSchema,
  clientUpdateSchema,
  parseOrThrow,
  type ClientCreate,
  type ClientUpdate,
} from "@/lib/validators";

export type Client = {
  id: string; name: string; email: string | null; phone: string | null;
  doc: string | null; type: string; status: string; notes: string | null;
  area: string | null; value_cents: number; owner: string | null;
  is_hot: boolean; address: string | null; city: string | null; state: string | null;
  tenant_id: string; created_by: string | null; deleted_at: string | null;
  status_version: number; stage_entered_at: string;
  created_at: string; updated_at: string;
};

export const STAGES = [
  { id: "novo_contato",      label: "Novo Contato",        subtitle: "Primeiro contato",    color: "oklch(0.70 0.18 285)", ring: "ring-violet-500/40",  bar: "bg-violet-500",  text: "text-violet-300",  bg: "bg-violet-500/10" },
  { id: "triagem",           label: "Triagem",             subtitle: "Qualificação",        color: "oklch(0.70 0.18 250)", ring: "ring-blue-500/40",    bar: "bg-blue-500",    text: "text-blue-300",    bg: "bg-blue-500/10" },
  { id: "consulta_agendada", label: "Consulta Agendada",   subtitle: "Reunião marcada",     color: "oklch(0.78 0.14 200)", ring: "ring-cyan-500/40",    bar: "bg-cyan-500",    text: "text-cyan-300",    bg: "bg-cyan-500/10" },
  { id: "proposta",          label: "Proposta",            subtitle: "Honorários enviados", color: "oklch(0.80 0.15 85)",  ring: "ring-amber-500/40",   bar: "bg-amber-500",   text: "text-amber-300",   bg: "bg-amber-500/10" },
  { id: "contrato",          label: "Contrato",            subtitle: "Assinado",            color: "oklch(0.74 0.17 130)", ring: "ring-lime-500/40",    bar: "bg-lime-500",    text: "text-lime-300",    bg: "bg-lime-500/10" },
  { id: "em_andamento",      label: "Em Andamento",        subtitle: "Caso ativo",          color: "oklch(0.72 0.17 155)", ring: "ring-emerald-500/40", bar: "bg-emerald-500", text: "text-emerald-300", bg: "bg-emerald-500/10" },
  { id: "encerrado",         label: "Concluído / Perdido", subtitle: "Encerrado",           color: "oklch(0.65 0.10 25)",  ring: "ring-rose-500/40",    bar: "bg-rose-500",    text: "text-rose-300",    bg: "bg-rose-500/10" },
] as const;

export const LEGACY_STAGE_MAP: Record<string, string> = {
  lead: "novo_contato", prospect: "novo_contato", qualificacao: "triagem",
  reuniao: "consulta_agendada", fechado: "contrato", ativo: "em_andamento",
  perdido: "encerrado", inativo: "encerrado",
};

export function stageOf(status: string): string {
  return LEGACY_STAGE_MAP[status] ?? status;
}

const CLIENT_QUERY_LIMIT = 500;

type ClientsQueryData = {
  items: Client[];
  totalCount: number;
};

function clientMutationMessage(error: Error, fallback: string) {
  if (/^\[(Criar|Atualizar) Cliente\]/.test(error.message)) {
    return error.message.replace(/^\[[^\]]+\]\s*/, "");
  }
  if (/^(Sessão expirada|Cliente não encontrado)/.test(error.message)) {
    return error.message;
  }
  return fallback;
}

export function useClients() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const tenantId = profile?.tenant_id ?? null;

  useRealtimeTables(["clients"], [["clients", tenantId]]);

  const query = useQuery({
    queryKey: ["clients", tenantId],
    queryFn: async () => {
      if (!tenantId) {
        return { items: [], totalCount: 0 } satisfies ClientsQueryData;
      }

      const { data, error, count } = await supabase
        .from("clients")
        .select("*", { count: "estimated" })
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(CLIENT_QUERY_LIMIT);
      if (error) throw new Error(error.message);

      const totalCount = count ?? data?.length ?? 0;
      if (totalCount > CLIENT_QUERY_LIMIT) {
        console.warn(
          `[useClients] Exibindo ${CLIENT_QUERY_LIMIT} de ${totalCount} clientes. A consulta está pronta para receber paginação.`,
        );
      }

      return {
        items: (data ?? []) as Client[],
        totalCount,
      } satisfies ClientsQueryData;
    },
    enabled: !!tenantId,
  });

  const create = useMutation({
    mutationFn: async (raw: Partial<Client>) => {
      if (!tenantId || !profile?.id) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      const payload: ClientCreate = parseOrThrow(clientCreateSchema, raw, "Criar Cliente");
      const { data, error } = await supabase
        .from("clients")
        .insert({
          ...payload,
          tenant_id: tenantId,
          created_by: profile.id,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data as Client;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients", tenantId] });
      toast.success("Cliente criado");
    },
    onError: (err: Error) =>
      toast.error(clientMutationMessage(err, "Não foi possível criar o cliente.")),
  });

  const update = useMutation({
    mutationFn: async ({ id, payload: raw }: { id: string; payload: Partial<Client> }) => {
      if (!tenantId) throw new Error("Sessão expirada. Faça login novamente.");

      const payload: ClientUpdate = parseOrThrow(clientUpdateSchema, raw, "Atualizar Cliente");
      const { data, error } = await supabase
        .from("clients")
        .update(payload)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Cliente não encontrado ou já removido.");
      return data as Client;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients", tenantId] });
    },
    onError: (err: Error) =>
      toast.error(clientMutationMessage(err, "Não foi possível atualizar o cliente.")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error("Sessão expirada. Faça login novamente.");

      const { data, error } = await supabase.rpc("soft_delete_client", {
        p_client_id: id,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Cliente não encontrado ou já removido.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients", tenantId] });
      toast.success("Cliente removido");
    },
    onError: (err: Error) =>
      toast.error(clientMutationMessage(err, "Não foi possível remover o cliente.")),
  });

  const moveStage = useMutation({
    mutationFn: async ({
      id,
      status: rawStatus,
      expectedVersion,
    }: {
      id: string;
      status: string;
      prevStatus?: string;
      expectedVersion?: number;
    }) => {
      const status = parseOrThrow(clientStatusSchema, rawStatus, "Mover Cliente");
      const cached = qc.getQueryData<ClientsQueryData>(["clients", tenantId]);
      const current = cached?.items.find((client) => client.id === id);
      const version =
        expectedVersion ??
        (current?.status === status
          ? current.status_version - 1
          : current?.status_version);

      if (!version) {
        throw new Error("CLIENT_STATUS_VERSION_REQUIRED");
      }

      const { data, error } = await supabase.rpc("move_client_stage", {
        p_client_id: id,
        p_next_status: status,
        p_expected_version: version,
      });
      if (error) throw new Error(error.message);
      return data as Client;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["clients", tenantId] });
      const previous = qc.getQueryData<ClientsQueryData>(["clients", tenantId]);
      if (previous) {
        qc.setQueryData<ClientsQueryData>(["clients", tenantId], {
          ...previous,
          items: previous.items.map((client) =>
            client.id === id
              ? {
                  ...client,
                  status,
                  status_version: client.status_version + 1,
                  stage_entered_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
              : client,
          ),
        });
      }
      return { previous };
    },
    onError: (err: Error, _variables, context) => {
      if (context?.previous) {
        qc.setQueryData(["clients", tenantId], context.previous);
      }
      toast.error(
        /CLIENT_STATUS_CONFLICT/i.test(err.message)
          ? "Este cliente foi movido por outra pessoa. Atualizamos o quadro."
          : /CLIENT_STATUS_VERSION_REQUIRED/i.test(err.message)
            ? "Não foi possível confirmar a versão do cliente. Atualize o quadro e tente novamente."
            : "Não foi possível mover o cliente.",
      );
    },
    onSuccess: (updated) => {
      qc.setQueryData<ClientsQueryData>(["clients", tenantId], (current) =>
        current
          ? {
              ...current,
              items: current.items.map((client) => (client.id === updated.id ? updated : client)),
            }
          : current,
      );
      toast.success("Etapa do cliente atualizada");
    },
    onSettled: (_data, _error, variables) => {
      qc.invalidateQueries({ queryKey: ["clients", tenantId] });
      qc.invalidateQueries({ queryKey: ["client-activities", variables.id] });
    },
  });

  const toggleHot = useMutation({
    mutationFn: async ({ id, is_hot }: { id: string; is_hot: boolean }) => {
      if (!tenantId) throw new Error("Sessão expirada. Faça login novamente.");

      const { data, error } = await supabase
        .from("clients")
        .update({ is_hot })
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Cliente não encontrado ou já removido.");
      return data as Client;
    },
    onMutate: async ({ id, is_hot }) => {
      await qc.cancelQueries({ queryKey: ["clients", tenantId] });
      const previous = qc.getQueryData<ClientsQueryData>(["clients", tenantId]);
      if (previous) {
        qc.setQueryData<ClientsQueryData>(["clients", tenantId], {
          ...previous,
          items: previous.items.map((client) =>
            client.id === id ? { ...client, is_hot } : client,
          ),
        });
      }
      return { previous };
    },
    onError: (err: Error, _variables, context) => {
      if (context?.previous) {
        qc.setQueryData(["clients", tenantId], context.previous);
      }
      toast.error(clientMutationMessage(err, "Não foi possível atualizar a prioridade."));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["clients", tenantId] });
    },
  });

  return {
    clients: query.data?.items ?? [],
    totalCount: query.data?.totalCount ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    create,
    update,
    remove,
    moveStage,
    toggleHot,
  };
}
