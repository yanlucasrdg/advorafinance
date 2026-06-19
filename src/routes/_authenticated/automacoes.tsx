import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, EmptyState } from "@/components/data-table-shell";

export const Route = createFileRoute("/_authenticated/automacoes")({
  head: () => ({ meta: [{ title: "Automações — Legion AI" }] }),
  component: () => (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader title="Automações" subtitle="Fluxos inteligentes e regras do escritório" />
      <Panel className="p-10"><EmptyState title="Em breve" hint="Crie gatilhos por prazo, status e clientes." /></Panel>
    </div>
  ),
});
