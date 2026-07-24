import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, EmptyState } from "@/components/data-table-shell";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios — Advora" }] }),
  component: () => (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader title="Relatórios" subtitle="Análises e exportações do escritório" />
      <Panel className="p-10"><EmptyState title="Em breve" hint="Relatórios consolidados de produtividade, financeiro e processual." /></Panel>
    </div>
  ),
});
