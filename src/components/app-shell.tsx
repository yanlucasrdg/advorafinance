import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, Briefcase, Calendar, DollarSign, BarChart3,
  MessageSquare, Zap, Plug, Settings, LogOut, Search, Bell, Sparkles, Command,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import advoraLogo from "@/assets/advora-logo.png.asset.json";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/crm", label: "CRM", icon: Users },
  { to: "/processos", label: "Processos", icon: Briefcase },
  { to: "/agenda", label: "Agenda", icon: Calendar },
  { to: "/financeiro", label: "Financeiro", icon: DollarSign },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/comunicacoes", label: "Comunicações", icon: MessageSquare },
  { to: "/automacoes", label: "Automações", icon: Zap },
  { to: "/integracoes", label: "Integrações", icon: Plug },
  { to: "/config", label: "Configurações", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const initials = (profile?.full_name ?? profile?.email ?? "?")
    .split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-border/40 flex flex-col relative">
        <div className="absolute inset-0 bg-gradient-to-b from-[oklch(0.18_0.02_270)] to-[oklch(0.14_0.012_265)] -z-10" />

        {/* Brand */}
        <div className="px-5 py-5 flex items-center gap-3">
          <div className="size-9 rounded-xl bg-black grid place-items-center ring-1 ring-white/10 shadow-[var(--shadow-glow)] overflow-hidden">
            <img src={advoraLogo.url} alt="Advora" className="size-7 object-contain" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight gradient-text">Advora</div>
            <div className="text-[10px] text-muted-foreground/80 font-mono">Legal OS · v2.3.0</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          <div className="px-3 mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 font-medium">Workspace</div>
          {nav.map(item => {
            const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to as never}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all ${
                  active
                    ? "bg-primary/12 text-foreground shadow-[inset_0_0_0_1px_oklch(0.70_0.18_285/0.25)]"
                    : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-r-full bg-primary shadow-[0_0_12px_oklch(0.70_0.18_285/0.7)]" />
                )}
                <item.icon className={`size-[16px] ${active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"}`} />
                <span className="font-medium tracking-tight">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-border/40">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/[0.03] transition-colors">
            <Avatar className="size-9 ring-2 ring-primary/30">
              <AvatarFallback className="text-xs bg-[image:var(--gradient-brand)] text-white font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 leading-tight">
              <div className="text-xs font-medium truncate">{profile?.full_name ?? "Usuário"}</div>
              <div className="text-[10px] text-muted-foreground truncate">{profile?.email}</div>
            </div>
            <button
              onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
              className="size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              aria-label="Sair"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border/40 backdrop-blur-xl bg-background/60 flex items-center gap-3 px-6 sticky top-0 z-30">
          {/* Search */}
          <div className="flex items-center gap-2.5 max-w-xl flex-1 h-10 px-3.5 rounded-lg border border-border/60 bg-white/[0.02] hover:bg-white/[0.04] focus-within:bg-white/[0.05] focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_oklch(0.70_0.18_285/0.12)]">
            <Search className="size-4 text-muted-foreground/70" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar processos, clientes, documentos..."
              className="bg-transparent flex-1 outline-none text-sm placeholder:text-muted-foreground/60"
            />
            <kbd className="hidden md:inline-flex items-center gap-1 px-1.5 h-5 rounded border border-border/60 bg-white/[0.04] text-[10px] font-mono text-muted-foreground">
              <Command className="size-2.5" /> K
            </kbd>
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <button className="size-9 grid place-items-center rounded-lg text-muted-foreground hover:bg-white/[0.04] hover:text-foreground relative" aria-label="Notificações">
              <Bell className="size-4" />
              <span className="absolute top-2 right-2 size-1.5 rounded-full bg-destructive ring-2 ring-background" />
            </button>
            <button className="size-9 grid place-items-center rounded-lg text-muted-foreground hover:bg-white/[0.04] hover:text-foreground" aria-label="Configurações" onClick={() => navigate({ to: "/config" })}>
              <Settings className="size-4" />
            </button>
            <div className="w-px h-6 bg-border/60 mx-1" />
            <Link
              to="/copiloto"
              className="group relative inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium text-white bg-[image:var(--gradient-brand)] shadow-[0_4px_20px_-4px_oklch(0.70_0.18_285/0.55)] hover:shadow-[0_6px_28px_-4px_oklch(0.70_0.18_285/0.75)] hover:-translate-y-px"
            >
              <Sparkles className="size-3.5" />
              Perguntar ao Copiloto
            </Link>
          </div>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
