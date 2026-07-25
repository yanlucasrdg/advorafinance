import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BellRing,
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileSpreadsheet,
  Megaphone,
  MessageCircle,
  Network,
  PlugZap,
  Radio,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/automacoes")({
  head: () => ({ meta: [{ title: "Automações — Advora" }] }),
  component: AutomacoesPage,
});

const integrations = [
  { name: "WhatsApp Business", description: "Converse com clientes e inicie fluxos a partir de mensagens.", icon: MessageCircle, tone: "violet", status: "Canal oficial", href: "/integracoes" },
  { name: "Webhooks", description: "Envie eventos do Advora para sistemas que sua empresa já utiliza.", icon: Radio, tone: "sky", status: "Em preparação" },
  { name: "n8n", description: "Monte fluxos avançados com seus próprios conectores e regras.", icon: Network, tone: "pink", status: "Em preparação" },
  { name: "Make", description: "Conecte aplicativos e rotinas visuais sem desenvolver do zero.", icon: Workflow, tone: "indigo", status: "Em preparação" },
  { name: "HubSpot", description: "Sincronize contatos e oportunidades com o time comercial.", icon: Bot, tone: "orange", status: "Planejado" },
  { name: "Google Sheets", description: "Leve indicadores operacionais para planilhas da empresa.", icon: FileSpreadsheet, tone: "emerald", status: "Planejado" },
  { name: "Google Ads", description: "Relacione a origem do lead com campanhas e conversões.", icon: Megaphone, tone: "blue", status: "Planejado" },
  { name: "API do Advora", description: "Integre seu sistema próprio com uma API documentada e segura.", icon: Braces, tone: "slate", status: "Planejado" },
] as const;

const recipes = [
  { icon: MessageCircle, title: "Mensagem nova → Triagem", detail: "Quando um cliente iniciar uma conversa no WhatsApp, criar ou atualizar o contato e encaminhar para a fila correta.", status: "Pronta após conectar WhatsApp" },
  { icon: Clock3, title: "Prazo crítico → Avisar responsável", detail: "Alertar o responsável antes de um prazo jurídico vencer, sem criar notificações duplicadas.", status: "Configuração do escritório" },
  { icon: FileSpreadsheet, title: "Lead qualificado → Planilha", detail: "Registrar uma oportunidade qualificada em uma planilha escolhida pela empresa.", status: "Aguardando Google Sheets" },
];

function AutomacoesPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-7 p-6 lg:p-8">
      <PageHeader title="Automações" subtitle="Conecte o Advora às ferramentas do seu escritório e deixe as rotinas repetitivas trabalharem por você." />

      <Panel className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.09] via-background to-violet-500/[0.07] p-0">
        <div className="grid gap-6 p-6 md:grid-cols-[1.25fr_0.75fr] md:p-8">
          <div>
            <Badge className="border-primary/20 bg-primary/10 text-primary"><Sparkles className="mr-1 size-3" />Hub de automações</Badge>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">Suas ferramentas, um fluxo de trabalho só.</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">Conecte os canais que já fazem parte do escritório. Cada integração terá permissões isoladas por empresa, histórico de execução e opção de pausar quando quiser.</p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1 rounded-full border bg-background/70 px-3 py-1.5"><ShieldCheck className="size-3.5 text-emerald-500" />Dados separados por escritório</span><span className="inline-flex items-center gap-1 rounded-full border bg-background/70 px-3 py-1.5"><BellRing className="size-3.5 text-primary" />Histórico de execuções</span></div>
          </div>
          <div className="relative grid min-h-48 place-items-center rounded-2xl border bg-background/70 p-6">
            <div className="absolute size-40 rounded-full border border-dashed border-primary/35" /><div className="absolute size-24 rounded-full border border-dashed border-primary/45" />
            <div className="z-10 grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"><PlugZap className="size-8" /></div>
            <IconBubble icon={MessageCircle} className="left-5 top-6 text-emerald-500" /><IconBubble icon={Workflow} className="right-5 top-7 text-pink-500" /><IconBubble icon={FileSpreadsheet} className="bottom-5 left-9 text-emerald-600" /><IconBubble icon={Radio} className="bottom-5 right-8 text-sky-500" />
          </div>
        </div>
      </Panel>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Integrações</h2><p className="mt-1 text-sm text-muted-foreground">Escolha uma ferramenta para ver os requisitos e liberar sua automação.</p></div><Badge variant="outline">0 integrações externas ativas</Badge></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {integrations.map((integration) => <IntegrationCard key={integration.name} {...integration} />)}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <Panel className="p-5"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">Receitas de automação</h2><p className="mt-1 text-sm text-muted-foreground">Fluxos prontos para adaptar à rotina do escritório.</p></div><Workflow className="size-5 text-primary" /></div><div className="mt-5 divide-y">{recipes.map((recipe) => <div key={recipe.title} className="flex gap-3 py-4 first:pt-0 last:pb-0"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><recipe.icon className="size-4" /></div><div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{recipe.title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{recipe.detail}</p><p className="mt-2 text-xs font-medium text-primary">{recipe.status}</p></div><ChevronRight className="mt-2 size-4 text-muted-foreground" /></div>)}</div></Panel>
        <Panel className="border-amber-500/20 bg-amber-500/[0.025] p-5"><div className="flex gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600"><CircleAlert className="size-4" /></div><div><h2 className="text-sm font-semibold">Como vamos liberar</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">As integrações externas entram uma a uma, com OAuth ou chave da própria empresa. Não compartilhamos credenciais entre clientes e não ativamos rotinas sem você saber.</p></div></div><div className="mt-5 rounded-lg border bg-background/70 p-3 text-xs text-muted-foreground"><strong className="text-foreground">Próxima conexão recomendada:</strong><br />WhatsApp Business, porque ele já alimenta atendimento, CRM e alertas.</div></Panel>
      </section>
    </div>
  );
}

function IconBubble({ icon: Icon, className }: { icon: typeof Workflow; className: string }) {
  return <div className={`absolute grid size-10 place-items-center rounded-xl border bg-background shadow-sm ${className}`}><Icon className="size-5" /></div>;
}

function IntegrationCard({ name, description, icon: Icon, tone, status, href }: typeof integrations[number]) {
  const colors: Record<string, string> = { violet: "bg-primary/10 text-primary", sky: "bg-sky-500/10 text-sky-600", pink: "bg-pink-500/10 text-pink-600", indigo: "bg-indigo-500/10 text-indigo-600", orange: "bg-orange-500/10 text-orange-600", emerald: "bg-emerald-500/10 text-emerald-600", blue: "bg-blue-500/10 text-blue-600", slate: "bg-muted text-muted-foreground" };
  const content = <><div className={`grid size-10 place-items-center rounded-xl ${colors[tone]}`}><Icon className="size-5" /></div><h3 className="mt-4 text-sm font-semibold">{name}</h3><p className="mt-1 min-h-10 text-xs leading-relaxed text-muted-foreground">{description}</p><div className="mt-4 flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{status}</span>{href ? <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">Configurar <ExternalLink className="size-3" /></span> : <span className="text-xs text-muted-foreground">Em breve</span>}</div></>;
  return href ? <Link to={href} className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.025]">{content}</Link> : <div className="rounded-xl border bg-card p-4">{content}</div>;
}
