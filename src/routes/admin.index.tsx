import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  CircleCheck,
  CircleOff,
  Clock3,
  Loader2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPlatformAdminDashboard } from "@/lib/platform-admin.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Administração — Advora" }] }),
  component: PlatformDashboard,
});

type Stats = Awaited<ReturnType<typeof getPlatformAdminDashboard>>;

function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: number;
  helper: string;
  icon: typeof Users;
  accent?: boolean;
}) {
  return (
    <article
      className={`rounded-3xl border p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${accent ? "border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card" : "border-border/70 bg-card/90"}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight">
            {value.toLocaleString("pt-BR")}
          </p>
        </div>
        <span
          className={`grid size-11 place-items-center rounded-2xl ${accent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >
          <Icon className="size-5" />
        </span>
      </div>
      <p className="mt-5 text-xs text-muted-foreground">{helper}</p>
    </article>
  );
}

function PlatformDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    getPlatformAdminDashboard()
      .then(setStats)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Falha ao carregar o painel."),
      );
  }, []);

  if (!stats)
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );

  const plans = [
    ["Free", stats.freeUsers, "bg-slate-400"],
    ["Starter", stats.starterUsers, "bg-indigo-400"],
    ["Pro", stats.proUsers, "bg-violet-500"],
    ["Enterprise", stats.enterpriseUsers, "bg-fuchsia-500"],
  ] as const;

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Visão da plataforma
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Painel administrativo
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Usuários, planos e disponibilidade da operação em uma visão segura.
          </p>
        </div>
        <Button asChild className="rounded-xl">
          <Link to="/admin/users">
            Gerenciar usuários <ArrowRight className="size-4" />
          </Link>
        </Button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Usuários cadastrados"
          value={stats.totalUsers}
          helper="Todos os perfis da plataforma"
          icon={Users}
          accent
        />
        <MetricCard
          label="Acessos ativos"
          value={stats.activeUsers}
          helper="Assinaturas e contas disponíveis"
          icon={CircleCheck}
        />
        <MetricCard
          label="Suspensos"
          value={stats.suspendedUsers}
          helper="Acesso interrompido manualmente"
          icon={CircleOff}
        />
        <MetricCard
          label="Expirados"
          value={stats.expiredUsers}
          helper="Rebaixados ao acesso Free"
          icon={Clock3}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-3xl border border-border/70 bg-card/90 p-6 shadow-sm sm:p-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Distribuição por plano</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Quantidade de usuários vinculados a cada modalidade.
              </p>
            </div>
            <Building2 className="size-5 text-muted-foreground" />
          </div>
          <div className="mt-8 space-y-5">
            {plans.map(([name, value, color]) => {
              const percentage = stats.totalUsers
                ? Math.round((value / stats.totalUsers) * 100)
                : 0;
              return (
                <div key={name}>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground">
                      {value.toLocaleString("pt-BR")} · {percentage}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${color}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-6 shadow-sm sm:p-8">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <h2 className="mt-6 text-lg font-semibold">Controle protegido</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Alterações passam por autorização global no servidor, são aplicadas por escritório e
            registradas em trilha de auditoria.
          </p>
        </div>
      </section>
    </div>
  );
}
