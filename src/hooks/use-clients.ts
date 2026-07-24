import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import { toast } from "sonner";

export type Client = {
  id: string; name: string; email: string | null; phone: string | null;
  doc: string | null; type: string; status: string; notes: string | null;
  area: string | null; value_cents: number | null; owner: string | null;
  is_hot: boolean; address: string | null; city: string | null; state: string | null;
  created_at: string; updated_at: string;
};

export const STAGES = [
  { id: "novo_contato",      label: "Novo Contato",      subtitle: "Primeiro contato",    color: "oklch(0.70 0.18 285)", ring: "ring-violet-500/40",  bar: "bg-violet-500",  text: "text-violet-300",  bg: "bg-violet-500/10" },
  { id: "triagem",           label: "Triagem",           subtitle: "Qualificação",        color: "oklch(0.70 0.18 250)", ring: "ring-blue-500/40",    bar: "bg-blue-500",    text: "text-blue-300",    bg: "bg-blue-500/10" },
  { id: "consulta_agendada", label: "Consulta Agendada", subtitle: "Reunião marcada",     color: "oklch(0.78 0.14 200)", ring: "ring-cyan-500/40",    bar: "bg-cyan-500",    text: "text-cyan-300",    bg: "bg-cyan-500/10" },
  { id: "proposta",          label: "Proposta",          subtitle: "Honorários enviados", color: "oklch(0.80 0.15 85)",  ring: "ring-amber-500/40",   bar: "bg-amber-500",   text: "text-amber-300",   bg: "bg-amber-500/10" },
  { id: "contrato",          label: "Contrato",          subtitle: "Assinado",            color: "oklch(0.74 0.17 130)", ring: "ring-lime-500/40",    bar: "bg-lime-500",    text: "text-lime-300",    bg: "bg-lime-500/10" },
  { id: "em_andamento",      label: "Em Andamento",      subtitle: "Caso ativo",          color: "oklch(0.72 0.17 155)", ring: "ring-emerald-500/40", bar: "bg-emerald-500", text: "text-emerald-300", bg: "bg-emerald-500/10" },
  { id: "encerrado",         label: "Concluído / Perdido", subtitle: "Encerrado",         color: "oklch(0.65 0.10 25)",  ring: "ring-rose-500/40",    bar: "bg-rose-500",    text: "text-rose-300",    bg: "bg-rose-500/10" },
] as const;

export const LEGACY_STAGE_MAP: Record<string, string> = {
  lead: "novo_contato", prospect: "novo_contato", qualificacao: "triagem",
  reuniao: "consulta_agendada", fechado: "contrato", ativo: "em_andamento",
  perdido: "encerrado", inativo: "encerrado",
};
export function stageOf(status: string): string {
  return LEGACY_STAGE_MAP[status] ?? status;
}

export function useClients() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const tenantId = profile?.tenant_id ?? null;

  useRealtimeTables(["clients"], [["clients", tenantId]]);

  const query = useQuery({
    queryKey: ["clients", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown) as Client[];
    },
    enabled: !!tenantId,
  });

  const create = useMutation({
    mutationFn: async (payload: Partial<Client>) => {
      const { error } = await supabase.from("clients").insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients", profile?.tenant_id] });
      toast.success("Cliente criado");
    },
    onError: (err) => toast.error(err.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, payload }: { id: string, payload: Partial<Client> }) => {
      const { error } = await supabase.from("clients").update(payload as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients", profile?.tenant_id] });
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients", profile?.tenant_id] });
      toast.success("Cliente removido");
    },
    onError: (err) => toast.error(err.message),
  });

  const moveStage = useMutation({
    mutationFn: async ({ id, status, prevStatus }: { id: string, status: string, prevStatus?: string }) => {
      const oldLabel = prevStatus ? (STAGES.find(s => s.id === stageOf(prevStatus))?.label ?? prevStatus) : "";
      const newLabel = STAGES.find(s => s.id === stageOf(status))?.label ?? status;
      
      // Update the stage
      const { error } = await supabase.from("clients").update({ status } as any).eq("id", id);
      if (error) throw error;

      // Log stage change activity if possible
      if (prevStatus && prevStatus !== status && profile?.tenant_id) {
        await (supabase.from("client_activities") as any).insert({
          tenant_id: profile.tenant_id, client_id: id,
          user_id: profile.id, kind: "stage_change",
          title: `Etapa alterada: ${oldLabel} → ${newLabel}`,
          meta: { old_stage: prevStatus, new_stage: status },
        });
      }
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["clients", profile?.tenant_id] });
      const previous = qc.getQueryData<Client[]>(["clients", profile?.tenant_id]);
      if (previous) {
        qc.setQueryData<Client[]>(["clients", profile?.tenant_id], old => 
          old?.map(c => c.id === id ? { ...c, status } : c)
        );
      }
      return { previous };
    },
    onError: (err, variables, context) => {
      if (context?.previous) {
        qc.setQueryData(["clients", profile?.tenant_id], context.previous);
      }
      toast.error(err.message);
    },
    onSettled: (data, error, variables) => {
      qc.invalidateQueries({ queryKey: ["clients", profile?.tenant_id] });
      qc.invalidateQueries({ queryKey: ["client-activities", variables.id] });
    }
  });

  const toggleHot = useMutation({
    mutationFn: async ({ id, is_hot }: { id: string, is_hot: boolean }) => {
      const { error } = await supabase.from("clients").update({ is_hot } as any).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, is_hot }) => {
      await qc.cancelQueries({ queryKey: ["clients", profile?.tenant_id] });
      const previous = qc.getQueryData<Client[]>(["clients", profile?.tenant_id]);
      if (previous) {
        qc.setQueryData<Client[]>(["clients", profile?.tenant_id], old => 
          old?.map(c => c.id === id ? { ...c, is_hot } : c)
        );
      }
      return { previous };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["clients", profile?.tenant_id] });
    }
  });

  return {
    clients: query.data ?? [],
    isLoading: query.isLoading,
    create,
    update,
    remove,
    moveStage,
    toggleHot,
  };
}
