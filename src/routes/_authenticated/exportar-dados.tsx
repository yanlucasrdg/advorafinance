import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PageHeader } from "@/components/data-table-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/exportar-dados")({
  head: () => ({ meta: [{ title: "Exportar dados" }] }),
  component: ExportarDados,
});

const EXPORT_TABLES = [
  "tenants",
  "profiles",
  "user_roles",
  "clients",
  "cases",
  "case_movements",
  "deadlines",
  "financial_entries",
  "financial_payments",
  "financial_audit_log",
  "dre_settings",
  "notifications",
  "ai_messages",
  "whatsapp_instances",
  "whatsapp_conversations",
  "whatsapp_messages",
  "whatsapp_logs",
] as const;

const SAFE_INSTANCE_COLUMNS = [
  "id",
  "tenant_id",
  "user_id",
  "instance_name",
  "external_instance_id",
  "phone_number",
  "status",
  "last_connected_at",
  "created_at",
  "updated_at",
].join(", ");

async function readAllRows(table: (typeof EXPORT_TABLES)[number]) {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;

  const columns = table === "whatsapp_instances" ? SAFE_INSTANCE_COLUMNS : "*";

  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(start, start + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

function ExportarDados() {
  const { profile } = useAuth();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");

  const exportData = async () => {
    if (!profile?.tenant_id) return;
    setRunning(true);
    const tables: Record<string, Record<string, unknown>[]> = {};
    const unavailable: Record<string, string> = {};

    try {
      for (const table of EXPORT_TABLES) {
        setProgress(`Lendo ${table}...`);
        try {
          tables[table] = await readAllRows(table);
        } catch (error) {
          unavailable[table] = error instanceof Error ? error.message : "Falha ao ler tabela.";
        }
      }

      const payload = {
        format: "advora-tenant-export/v1",
        exported_at: new Date().toISOString(),
        tenant_id: profile.tenant_id,
        excluded_sensitive_fields: ["zapi_token", "zapi_client_token", "zapi_instance_id", "qr_code", "metadata"],
        tables,
        unavailable_tables: unavailable,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `advora-export-${profile.tenant_id}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(href);
      toast.success("Exportacao concluida. Guarde o arquivo em local seguro.");
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <PageHeader title="Exportar dados do tenant" subtitle="Arquivo de migracao somente leitura para o tenant autenticado." />
      <Panel className="p-6 space-y-5">
        <div className="flex gap-3">
          <ShieldCheck className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="text-foreground font-medium">O arquivo inclui CRM, processos, financeiro e conversas.</p>
            <p>Credenciais Z-API nao sao exportadas. Elas devem ser cadastradas novamente no ambiente externo.</p>
          </div>
        </div>
        <Button onClick={exportData} disabled={running} className="bg-[image:var(--gradient-brand)]">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {running ? progress || "Preparando..." : "Baixar exportacao JSON"}
        </Button>
      </Panel>
    </div>
  );
}
