import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, EmptyState } from "@/components/data-table-shell";

export const Route = createFileRoute("/_authenticated/integracoes")({
  head: () => ({ meta: [{ title: "Integrações — Legion AI" }] }),
  component: () => (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader title="Integrações" subtitle="Conecte tribunais, e-mail e ferramentas externas" />
      <Panel className="p-10"><EmptyState title="Em breve" hint="API pública, webhooks e conectores oficiais." /></Panel>
    </div>
  ),
});
