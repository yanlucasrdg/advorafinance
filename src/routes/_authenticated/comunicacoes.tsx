import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, EmptyState } from "@/components/data-table-shell";

export const Route = createFileRoute("/_authenticated/comunicacoes")({
  head: () => ({ meta: [{ title: "Comunicações — Legion AI" }] }),
  component: () => (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader title="Comunicações" subtitle="E-mails, WhatsApp e notificações aos clientes" />
      <Panel className="p-10"><EmptyState title="Em breve" hint="Central unificada de mensagens e templates." /></Panel>
    </div>
  ),
});
