import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CircleAlert,
  CreditCard,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { BILLING_PLANS, type BillingInterval, type BillingPlanId } from "@/lib/billing";
import { createKirvanoCheckout, getBillingOverview } from "@/lib/billing.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/assinatura")({
  head: () => ({ meta: [{ title: "Plano e cobrança — Advora" }] }),
  component: SubscriptionPage,
});

type BillingOverview = Awaited<ReturnType<typeof getBillingOverview>>;

const STATUS_LABEL: Record<string, string> = {
  trialing: "Período de experiência",
  active: "Assinatura ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelamento agendado",
  expired: "Assinatura expirada",
  refunded: "Pagamento reembolsado",
  chargeback: "Pagamento contestado",
};

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}

function SubscriptionPage() {
  const [interval, setInterval] = useState<BillingInterval>("annual");
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlanId | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setOverview(await getBillingOverview());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar sua assinatura.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const checkout = async (plan: BillingPlanId) => {
    setCheckoutPlan(plan);
    try {
      const { url } = await createKirvanoCheckout({ data: { plan, interval } });
      window.location.assign(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir o checkout.");
      setCheckoutPlan(null);
    }
  };

  if (loading && !overview) {
    return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }

  const renewalDate = formatDate(overview?.currentPeriodEnd ?? overview?.trialEndsAt ?? null);
  const warning = overview && ["past_due", "expired", "refunded", "chargeback"].includes(overview.status);

  return (
    <div className="mx-auto max-w-7xl space-y-7 p-5 sm:p-8">
      <PageHeader title="Plano e cobrança" subtitle="Gerencie a capacidade do seu escritório e sua assinatura Advora." />

      {overview && (
        <Panel className={`overflow-hidden border ${warning ? "border-destructive/30" : "border-primary/20"}`}>
          <div className={`grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6 ${warning ? "bg-destructive/5" : "bg-gradient-to-r from-primary-soft to-card"}`}>
            <div className="flex items-start gap-4">
              <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${warning ? "bg-destructive/10 text-destructive" : "bg-primary text-primary-foreground"}`}>
                {warning ? <CircleAlert className="size-5" /> : <BadgeCheck className="size-5" />}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{overview.plan === "trial" ? "Experiência Advora" : BILLING_PLANS[overview.plan].name}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${warning ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                    {STATUS_LABEL[overview.status] ?? overview.status}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {overview.cancelAtPeriodEnd && renewalDate
                    ? `Seu acesso permanece ativo até ${renewalDate}.`
                    : renewalDate
                      ? `${overview.status === "trialing" ? "Seu teste termina" : "Próxima renovação"} em ${renewalDate}.`
                      : "Acompanhe aqui todas as mudanças da sua assinatura."}
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Atualizar status
            </Button>
          </div>
          <div className="grid gap-4 border-t border-border/70 p-5 sm:grid-cols-2 sm:p-6">
            <Usage label="Usuários" value={overview.usage.users} limit={overview.limits.users} icon={<Users />} />
            <Usage label="Processos ativos" value={overview.usage.cases} limit={overview.limits.cases} icon={<CreditCard />} />
          </div>
        </Panel>
      )}

      <section>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="text-xl font-semibold tracking-tight">Escolha o plano certo para crescer</h2><p className="mt-1 text-sm text-muted-foreground">Segurança, LGPD e exportação dos seus dados estão incluídas em todos os planos.</p></div>
          <div className="relative grid w-fit grid-cols-2 rounded-xl border border-border bg-secondary/70 p-1">
            <button type="button" onClick={() => setInterval("monthly")} className={`relative z-10 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${interval === "monthly" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Mensal</button>
            <button type="button" onClick={() => setInterval("annual")} className={`relative z-10 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${interval === "annual" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Anual <span className="text-success">−20%</span></button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {(Object.keys(BILLING_PLANS) as BillingPlanId[]).map((planId) => {
            const plan = BILLING_PLANS[planId];
            const featured = planId === "performance";
            const current = overview?.plan === planId;
            const price = interval === "annual" ? plan.annualMonthlyPrice : plan.monthlyPrice;
            return (
              <article key={planId} className={`relative flex min-h-[510px] flex-col overflow-hidden rounded-3xl border bg-card p-6 shadow-[var(--shadow-elegant)] transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${featured ? "border-primary/45 ring-1 ring-primary/10" : "border-border"}`}>
                {featured && <div className="absolute inset-x-0 top-0 h-1 bg-[image:var(--gradient-brand)]" />}
                <div className="flex items-center justify-between">
                  <span className={`grid size-10 place-items-center rounded-2xl ${featured ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>{planId === "business" ? <ShieldCheck className="size-5" /> : <Sparkles className="size-5" />}</span>
                  {featured && <span className="rounded-full bg-primary-soft px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">Mais escolhido</span>}
                </div>
                <h3 className="mt-5 text-lg font-semibold">{plan.name}</h3>
                <p className="mt-2 min-h-10 text-xs leading-relaxed text-muted-foreground">{plan.description}</p>
                <div className="mt-6 flex items-end gap-1"><span className="pb-1 text-sm text-muted-foreground">R$</span><strong className="text-4xl font-bold tracking-[-.06em]">{price}</strong><span className="pb-1 text-xs text-muted-foreground">/mês</span></div>
                {interval === "annual" ? <p className="mt-1 text-[10px] text-muted-foreground">Cobrado anualmente · economize R${(plan.monthlyPrice - price) * 12}</p> : <p className="mt-1 text-[10px] text-muted-foreground">Cobrança mensal, cancele quando quiser</p>}
                <div className="my-6 h-px bg-border" />
                <ul className="space-y-3">
                  {plan.features.map((feature) => <li key={feature} className="flex gap-2.5 text-xs leading-relaxed"><span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"><Check className="size-2.5" strokeWidth={3} /></span>{feature}</li>)}
                </ul>
                <Button className="mt-auto w-full" variant={featured ? "default" : "outline"} disabled={current || checkoutPlan !== null} onClick={() => void checkout(planId)}>
                  {checkoutPlan === planId ? <><Loader2 className="size-4 animate-spin" />Abrindo checkout</> : current ? "Seu plano atual" : <>Escolher {plan.name}<ArrowRight className="size-4" /></>}
                </Button>
              </article>
            );
          })}
        </div>
      </section>

      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card/60 px-5 py-4 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
        <LockKeyhole className="size-4 text-primary" /> O pagamento é processado com segurança pela Kirvano. A Advora não armazena os dados do seu cartão.
      </div>
    </div>
  );
}

function Usage({ label, value, limit, icon }: { label: string; value: number; limit: number; icon: React.ReactNode }) {
  const percentage = Math.min(100, Math.round((value / Math.max(limit, 1)) * 100));
  return (
    <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
      <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 font-medium text-foreground">{icon}{label}</span><span className="text-muted-foreground"><strong className="text-foreground">{value}</strong> de {limit.toLocaleString("pt-BR")}</span></div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full transition-all duration-500 ${percentage >= 90 ? "bg-warning" : "bg-primary"}`} style={{ width: `${percentage}%` }} /></div>
    </div>
  );
}

