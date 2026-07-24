import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, CircleAlert, Cloud, ExternalLink, Loader2, MessageCircle, ShieldCheck, Zap } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { metaWhatsAppConnect } from "@/lib/meta-whatsapp.functions";

export const Route = createFileRoute("/_authenticated/integracoes")({
  head: () => ({ meta: [{ title: "Integrações — Advora" }] }),
  component: IntegracoesPage,
});

function IntegracoesPage() {
  const connectMeta = useServerFn(metaWhatsAppConnect);
  const [connecting, setConnecting] = useState(false);

  const activateMeta = async () => {
    setConnecting(true);
    try {
      await connectMeta();
      toast.success("WhatsApp Business conectado ao escritório. As mensagens recebidas aparecerão em Comunicações.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível conectar o WhatsApp Business.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <PageHeader
        title="Integrações"
        subtitle="Conecte somente os canais que fazem sentido para o seu escritório."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <IntegrationCard
          icon={<Cloud className="h-5 w-5" />}
          title="WhatsApp Business Platform"
          description="Canal oficial da Meta para mensagens e atendimento dentro do Advora."
          badge="Recomendado"
          tone="primary"
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            A Meta hospeda a Cloud API. Não há QR Code, sessão de WhatsApp Web nem multi-instância simulada.
          </p>
        </IntegrationCard>

        <IntegrationCard
          icon={<Zap className="h-5 w-5" />}
          title="Z-API"
          description="Gateway opcional para quem já possui uma conta Z-API."
          badge="Pré-funcional"
          tone="amber"
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            A interface e a segurança do Advora estão preparadas, mas o pareamento e o envio só serão liberados após a configuração das credenciais reais.
          </p>
        </IntegrationCard>
      </div>

      <Panel className="overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Configurar WhatsApp oficial</h2>
              <p className="text-xs text-muted-foreground">Meta Cloud API — caminho principal para o atendimento do Advora.</p>
            </div>
            <Badge className="ml-auto bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300">Sem QR Code</Badge>
          </div>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[1.3fr_.7fr]">
          <div>
            <h3 className="text-sm font-semibold text-foreground">O que será necessário</h3>
            <ol className="mt-4 space-y-3">
              <SetupStep number="1" title="Criar o app no Meta for Developers" description="Adicione o produto WhatsApp ao app da empresa." />
              <SetupStep number="2" title="Vincular sua conta e o número comercial" description="A Meta cria a conta WhatsApp Business e fornece o identificador do número." />
              <SetupStep number="3" title="Cadastrar as credenciais no Worker" description="Token, Phone Number ID e Verify Token ficam como secrets; nunca no navegador." />
              <SetupStep number="4" title="Ativar o webhook" description="As mensagens recebidas passarão a alimentar a caixa de entrada do Advora." />
            </ol>
          </div>

          <aside className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">Pronto para configuração guiada</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Quando você criar o app da Meta, faremos o vínculo no Worker sem expor credenciais e sem depender de WhatsApp Web.
            </p>
            <Button className="mt-4 w-full" size="sm" onClick={activateMeta} disabled={connecting}>
              {connecting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Ativar WhatsApp Business
            </Button>
            <a
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
              target="_blank"
              rel="noreferrer"
            >
              Abrir guia da Meta <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </aside>
        </div>
      </Panel>

      <Panel className="border-amber-500/20 bg-amber-500/[0.025] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <CircleAlert className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Z-API — pré-funcional</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Mantivemos este conector como alternativa. Ele não cria sessões, QR Codes ou mensagens de teste enquanto não houver uma conta Z-API configurada para o escritório.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" disabled className="h-8 shrink-0 text-xs">Configurar em breve</Button>
        </div>
      </Panel>

      <p className="text-center text-xs text-muted-foreground">
        PJe, Projudi e novos canais serão adicionados quando houver uma integração real para ativar.
      </p>
    </div>
  );
}

function IntegrationCard({ icon, title, description, badge, tone, children }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
  tone: "primary" | "amber";
  children: React.ReactNode;
}) {
  const colors = tone === "primary"
    ? "border-primary/30 bg-primary/[0.03] text-primary"
    : "border-amber-500/30 bg-amber-500/[0.03] text-amber-600 dark:text-amber-400";

  return (
    <section className={`rounded-xl border p-5 ${colors}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-background/70">{icon}</div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 border-current/25 text-[10px] text-current">{badge}</Badge>
      </div>
      <div className="mt-4 border-t border-current/10 pt-4">{children}</div>
    </section>
  );
}

function SetupStep({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{number}</span>
      <div>
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </li>
  );
}
