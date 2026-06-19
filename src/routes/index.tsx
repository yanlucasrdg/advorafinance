import { createFileRoute, Link } from "@tanstack/react-router";
import { Scale, Sparkles, Shield, Bot, Workflow, BarChart3, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Legion AI Legal OS — Sistema operacional jurídico com IA" },
      { name: "description", content: "Gestão de processos, CRM, financeiro e copiloto IA para escritórios de advocacia. Multi-tenant, seguro, com RAG e agentes autônomos." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen grid-bg">
      {/* Nav */}
      <header className="sticky top-0 z-40 glass border-b border-border/50">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-[image:var(--gradient-brand)] grid place-items-center shadow-[var(--shadow-glow)]">
              <Scale className="size-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight">Legion <span className="gradient-text">AI</span></span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition">Recursos</a>
            <a href="#ia" className="hover:text-foreground transition">Inteligência Artificial</a>
            <a href="#planos" className="hover:text-foreground transition">Planos</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/auth"><Button variant="ghost" size="sm">Entrar</Button></Link>
            <Link to="/auth"><Button size="sm" className="bg-[image:var(--gradient-brand)] hover:opacity-90">Começar grátis</Button></Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
        <div className="relative mx-auto max-w-7xl px-6 pt-24 pb-32 text-center">
          <div className="inline-flex items-center gap-2 rounded-full glass px-3 py-1 text-xs text-muted-foreground mb-6">
            <Sparkles className="size-3 text-primary" /> Copiloto jurídico com IA em todos os módulos
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight max-w-4xl mx-auto leading-[1.05]">
            O sistema operacional <span className="gradient-text">do escritório jurídico moderno</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            CRM, processos, prazos, financeiro, portal do cliente e um copiloto de IA treinado nos seus documentos. Tudo em uma plataforma multi-tenant segura.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth">
              <Button size="lg" className="bg-[image:var(--gradient-brand)] hover:opacity-90 shadow-[var(--shadow-glow)]">
                Iniciar trial de 14 dias <ArrowRight className="ml-1 size-4" />
              </Button>
            </Link>
            <a href="#features">
              <Button size="lg" variant="outline" className="border-border/80">Ver recursos</Button>
            </a>
          </div>
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto text-sm text-muted-foreground">
            {["Multi-tenant", "RLS por escritório", "RAG + pgvector", "Auditoria completa"].map(t => (
              <div key={t} className="flex items-center justify-center gap-2"><Check className="size-4 text-primary" /> {t}</div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-6 py-24">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Tudo que seu escritório precisa, conectado</h2>
          <p className="mt-3 text-muted-foreground">Compete com Clio, MyCase, ADVBOX e Astrea — com IA nativa em cada workflow.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Bot, title: "Copiloto IA Jurídico", desc: "Resumo de processos, geração de petições, pareceres e contratos." },
            { icon: Workflow, title: "CRM com Kanban", desc: "Funis, lead scoring, WhatsApp e automações." },
            { icon: Scale, title: "Gestão Processual", desc: "Processos, prazos, audiências, timeline e alertas." },
            { icon: BarChart3, title: "Financeiro completo", desc: "Honorários, mensalidades, PIX, boletos, DRE." },
            { icon: Shield, title: "Multi-tenant seguro", desc: "Cada escritório isolado por RLS e papéis granulares." },
            { icon: Sparkles, title: "RAG + Base privada", desc: "Suba PDFs e DOCX — IA responde com base no seu acervo." },
          ].map(f => (
            <div key={f.title} className="glass rounded-2xl p-6 hover:glow-ring transition-all">
              <f.icon className="size-6 text-primary mb-4" />
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="glass rounded-3xl p-12 text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-40" style={{ background: "var(--gradient-hero)" }} />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Pronto para escalar seu escritório?</h2>
            <p className="mt-3 text-muted-foreground">Crie sua conta e configure seu workspace em menos de 2 minutos.</p>
            <Link to="/auth" className="inline-block mt-8">
              <Button size="lg" className="bg-[image:var(--gradient-brand)] shadow-[var(--shadow-glow)]">
                Começar agora <ArrowRight className="ml-1 size-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/50 py-8 text-center text-xs text-muted-foreground">
        © 2026 Legion AI Legal OS. Todos os direitos reservados.
      </footer>
    </div>
  );
}
