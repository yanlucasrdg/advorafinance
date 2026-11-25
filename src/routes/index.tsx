import { createFileRoute, Link } from "@tanstack/react-router";
import { Scale } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { BILLING_PLANS } from "@/lib/billing";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Advora — Gestão para escritórios jurídicos" }] }),
  component: Landing,
});

function Landing() {
  const { user } = useAuth();
  return <main className="mx-auto max-w-6xl px-6 pb-16">
    <header className="flex items-center justify-between border-b py-5">
      <span className="flex items-center gap-2 font-semibold"><Scale className="size-5 text-primary" /> Advora</span>
      <Button asChild variant="outline"><Link to={user ? "/dashboard" : "/auth"}>{user ? "Abrir escritório" : "Entrar"}</Link></Button>
    </header>
    <section className="max-w-3xl py-16 md:py-24">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">Do primeiro contato ao recebimento dos honorários.</h1>
      <p className="my-6 max-w-xl text-lg text-muted-foreground">Acompanhe clientes, processos, prazos e financeiro em um único espaço de trabalho para seu escritório jurídico.</p>
      <Button asChild size="lg"><Link to="/auth" search={{ cadastro: true }}>Testar o Business por 7 dias</Link></Button>
    </section>
    <section aria-label="Planos mensais" className="grid gap-4 md:grid-cols-3">
      {Object.values(BILLING_PLANS).map(plan => <article key={plan.id} className="rounded-xl border bg-card p-6">
        <h2 className="text-xl font-semibold">{plan.name}</h2>
        <p className="my-3 text-2xl font-semibold">R$ {plan.monthlyPrice}<small className="text-sm font-normal"> / mês</small></p>
        <p className="text-sm text-muted-foreground">Até {plan.limits.users} usuários e {plan.limits.cases.toLocaleString("pt-BR")} processos.</p>
      </article>)}
    </section>
  </main>;
}
