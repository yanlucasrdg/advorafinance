import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Scale, LayoutDashboard, Users, Briefcase, Calendar, DollarSign, Bot, Settings, LogOut, Search, Bell } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/crm", label: "CRM", icon: Users },
  { to: "/processos", label: "Processos", icon: Briefcase },
  { to: "/agenda", label: "Agenda", icon: Calendar },
  { to: "/financeiro", label: "Financeiro", icon: DollarSign },
  { to: "/copiloto", label: "Copiloto IA", icon: Bot },
  { to: "/config", label: "Configurações", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const initials = (profile?.full_name ?? profile?.email ?? "?").split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="px-4 py-5 flex items-center gap-2">
          <div className="size-8 rounded-lg bg-[image:var(--gradient-brand)] grid place-items-center shadow-[var(--shadow-glow)]">
            <Scale className="size-4 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Legion <span className="gradient-text">AI</span></div>
            <div className="text-[10px] text-sidebar-foreground/60">Legal OS</div>
          </div>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5">
          {nav.map(item => {
            const active = location.pathname.startsWith(item.to);
            return (
              <Link key={item.to} to={item.to as never}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}>
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-2 py-2">
            <Avatar className="size-8"><AvatarFallback className="text-xs bg-primary/20 text-primary">{initials}</AvatarFallback></Avatar>
            <div className="flex-1 min-w-0 leading-tight">
              <div className="text-xs font-medium truncate">{profile?.full_name ?? "Usuário"}</div>
              <div className="text-[10px] text-sidebar-foreground/60 truncate">{profile?.email}</div>
            </div>
            <Button size="icon" variant="ghost" className="size-7" onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}>
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border/60 glass flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground max-w-md flex-1">
            <Search className="size-4" />
            <input placeholder="Buscar processos, clientes, documentos…" className="bg-transparent flex-1 outline-none placeholder:text-muted-foreground/60" />
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" className="size-8"><Bell className="size-4" /></Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
