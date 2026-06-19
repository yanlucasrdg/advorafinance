import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Briefcase, Users, DollarSign, Clock, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Legion AI" }] }),
  component: Dashboard,
});

const kpis = [
  { label: "Receita do mês", value: "R$ 184.250", delta: "+12,4%", icon: DollarSign, tone: "text-success" },
  { label: "Processos ativos", value: "127", delta: "+8", icon: Briefcase, tone: "text-primary" },
  { label: "Clientes", value: "342", delta: "+24", icon: Users, tone: "text-primary" },
  { label: "Prazos a vencer (7d)", value: "9", delta: "2 críticos", icon: Clock, tone: "text-warning" },
];

function Dashboard() {
  const { profile } = useAuth();
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "advogado(a)";

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Dashboard executivo</p>
          <h1 className="text-3xl font-bold tracking-tight mt-1">Olá, {firstName} 👋</h1>
          <p className="text-sm text-muted-foreground mt-1">Visão geral do escritório hoje, {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}.</p>
        </div>
        <button className="glass rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 hover:glow-ring transition-all">
          <Sparkles className="size-4 text-primary" /> Perguntar ao copiloto
        </button>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <div key={k.label} className="glass rounded-2xl p-5 hover:glow-ring transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-2xl font-bold tracking-tight">{k.value}</p>
              </div>
              <div className="size-9 rounded-lg bg-primary/10 grid place-items-center">
                <k.icon className={`size-4 ${k.tone}`} />
              </div>
            </div>
            <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
              <ArrowUpRight className="size-3 text-success" /> {k.delta}
            </div>
          </div>
        ))}
      </section>

      {/* Two-column */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-semibold">Receita dos últimos 6 meses</h2>
              <p className="text-xs text-muted-foreground">Honorários + mensalidades</p>
            </div>
            <span className="text-xs text-muted-foreground">R$ em milhares</span>
          </div>
          <div className="h-56 flex items-end gap-2">
            {[42, 58, 51, 73, 89, 96].map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full rounded-md bg-[image:var(--gradient-brand)] opacity-90 hover:opacity-100 transition" style={{ height: `${v}%` }} />
                <span className="text-[10px] text-muted-foreground">{["Jan","Fev","Mar","Abr","Mai","Jun"][i]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-2xl p-6">
          <h2 className="font-semibold">Próximos prazos</h2>
          <p className="text-xs text-muted-foreground mb-4">Audiências e protocolos</p>
          <ul className="space-y-3">
            {[
              { t: "Contestação - Proc. 0023145-22", d: "Hoje, 17h00", c: "destructive" },
              { t: "Audiência - Caso Ribeiro", d: "Amanhã, 09h30", c: "warning" },
              { t: "Recurso - Proc. 0098712-11", d: "Sex, 14h00", c: "muted" },
              { t: "Reunião cliente Tech Corp", d: "Seg, 10h00", c: "muted" },
            ].map((p, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className={`mt-1.5 size-2 rounded-full ${p.c === "destructive" ? "bg-destructive" : p.c === "warning" ? "bg-warning" : "bg-muted-foreground/40"}`} />
                <div className="flex-1">
                  <div className="font-medium leading-tight">{p.t}</div>
                  <div className="text-xs text-muted-foreground">{p.d}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass rounded-2xl p-6">
          <h2 className="font-semibold mb-1">Pipeline comercial</h2>
          <p className="text-xs text-muted-foreground mb-4">Leads por estágio</p>
          <div className="space-y-3">
            {[
              { s: "Novos leads", n: 18, p: 100 },
              { s: "Qualificados", n: 11, p: 61 },
              { s: "Proposta enviada", n: 6, p: 33 },
              { s: "Fechados (mês)", n: 4, p: 22 },
            ].map(s => (
              <div key={s.s}>
                <div className="flex justify-between text-xs mb-1"><span>{s.s}</span><span className="text-muted-foreground">{s.n}</span></div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-[image:var(--gradient-brand)]" style={{ width: `${s.p}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-2xl p-6">
          <h2 className="font-semibold mb-1">Atividade da equipe</h2>
          <p className="text-xs text-muted-foreground mb-4">Últimas ações</p>
          <ul className="space-y-3 text-sm">
            {[
              { u: "MA", n: "Maria A.", a: "anexou parecer em Caso Ribeiro", t: "há 12min" },
              { u: "JS", n: "João S.", a: "criou tarefa para estagiário", t: "há 1h" },
              { u: "CB", n: "Camila B.", a: "respondeu cliente Tech Corp", t: "há 3h" },
              { u: "RP", n: "Ricardo P.", a: "fechou proposta de R$ 24.000", t: "ontem" },
            ].map((x, i) => (
              <li key={i} className="flex items-center gap-3">
                <div className="size-7 rounded-full bg-primary/15 text-primary text-[10px] grid place-items-center font-semibold">{x.u}</div>
                <div className="flex-1 leading-tight">
                  <span className="font-medium">{x.n}</span> <span className="text-muted-foreground">{x.a}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">{x.t}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
