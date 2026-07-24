import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import { toast } from "sonner";

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
  cases?: { id: string; title: string; number: string | null } | null;
  clients?: { id: string; name: string } | null;
};

export type CaseLite = { id: string; title: string; number: string | null };
export type ClientLite = { id: string; name: string };

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
        .select("id, title, kind, due_at, done, priority, case_id, client_id, completed_at, cases(id, title, number), clients(id, name)")
        .order("due_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Deadline[];
    },
  });

  const casesQ = useQuery({
    queryKey: ["agenda", "cases", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("cases").select("id, title, number").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as CaseLite[];
    },
  });

  const clientsQ = useQuery({
    queryKey: ["agenda", "clients", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").order("name");
      if (error) throw error;
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
      if (error) throw error;
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
    mutationFn: async (payload: Partial<Deadline>) => {
      if (!tenantId) throw new Error("Tenant missing");
      const { error } = await supabase.from("deadlines").insert({ ...payload, tenant_id: tenantId } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.success("Evento criado");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (deadline: Deadline) => {
      const { error } = await supabase.from("deadlines").update({ done: !deadline.done }).eq("id", deadline.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("deadlines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda", "deadlines", tenantId] });
      toast.success("Evento removido");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return {
    deadlines: deadlinesQ.data ?? [],
    cases: casesQ.data ?? [],
    clients: clientsQ.data ?? [],
    lastComms,
    isLoading: deadlinesQ.isLoading || casesQ.isLoading || clientsQ.isLoading || lastCommsQ.isLoading,
    create: createMutation.mutateAsync,
    toggle: toggleMutation.mutateAsync,
    remove: removeMutation.mutateAsync,
  };
}
