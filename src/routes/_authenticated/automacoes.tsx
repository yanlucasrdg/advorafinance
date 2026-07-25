import { createFileRoute } from "@tanstack/react-router";
import { BellRing, CheckCircle2, Clock3, MessageCircle, ShieldCheck, Workflow, Wrench } from "lucide-react";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/automacoes")({
  head: () => ({ meta: [{ title: "Automações — Advora" }] }),
  component: AutomacoesPage,
});

function AutomacoesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <PageHeader title="Automações" subtitle="Acompanhe somente as rotinas que realmente trabalham no seu escritório." />

      <Panel className="border-primary/20 bg-primary/[0.035] p-5">
        <div className="flex gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Workflow className="size-5" /></div><div><h2 className="text-base font-semibold">O que esta área significa</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Uma automação é uma ação que o Advora executa sozinho. Aqui não há botões decorativos: cada item informa exatamente o que acontece e quando.</p></div></div>
      </Panel>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Ativas agora</h2>
        <AutomationRow icon={Clock3} tone="emerald" title="Primeiro atendimento de novo contato" status="Ativa" description="Ao criar uma conversa em Comunicações, o contato entra em Triagem e o Advora cria uma pendência de primeira resposta para 15 minutos." outcomes={["Contato vinculado ao cliente", "Pendência criada na Agenda", "Alerta interno de novo lead"]} />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Prontas, aguardando o WhatsApp receber mensagens</h2>
        <AutomationRow icon={MessageCircle} tone="violet" title="Qualificação inicial de mensagem" status="Aguardando webhook" description="Quando uma mensagem recebida chegar pelo WhatsApp, o Advora identifica a área provável e organiza a conversa em Jurídico, Financeiro, Secretaria ou Triagem." outcomes={["Detecta termos de urgência", "Aplica tags sem tirar decisões humanas", "Cria alerta quando houver indício de urgência"]} />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Ainda não configuradas</h2>
        <AutomationRow icon={Wrench} tone="slate" title="Lembretes de prazo e follow-up de proposta" status="Não configurada" description="Essas rotinas não estão ligadas ainda. Para fazê-las corretamente precisamos definir horários, responsáveis e a frequência de cobrança — sem gerar notificações inúteis." outcomes={["Prazo crítico", "Proposta sem resposta", "Cobrança financeira"]} />
      </section>

      <Panel className="p-5"><div className="flex gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600"><ShieldCheck className="size-4" /></div><div><h2 className="text-sm font-semibold">Próxima evolução</h2><p className="mt-1 text-sm text-muted-foreground">Depois de estabilizarmos a entrada das mensagens do WhatsApp, montamos juntos as regras de prazo e de proposta com responsável, horário e histórico de execução.</p></div></div></Panel>
    </div>
  );
}

function AutomationRow({ icon: Icon, tone, title, status, description, outcomes }: { icon: typeof Clock3; tone: "emerald" | "violet" | "slate"; title: string; status: string; description: string; outcomes: string[] }) {
  const tones = { emerald: "bg-emerald-500/10 text-emerald-600", violet: "bg-primary/10 text-primary", slate: "bg-muted text-muted-foreground" };
  const statusClass = tone === "emerald" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : tone === "violet" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground";
  return <Panel className="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start"><div className={`grid size-10 shrink-0 place-items-center rounded-xl ${tones[tone]}`}><Icon className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{title}</h3><Badge className={statusClass}>{tone === "emerald" && <CheckCircle2 className="mr-1 size-3" />}{status}</Badge></div><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p><div className="mt-4 flex flex-wrap gap-2">{outcomes.map((outcome) => <span key={outcome} className="inline-flex items-center gap-1 rounded-md border bg-muted/25 px-2 py-1 text-xs text-muted-foreground"><BellRing className="size-3 text-primary" />{outcome}</span>)}</div></div></div></Panel>;
}
