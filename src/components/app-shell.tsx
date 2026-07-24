import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, Briefcase, Calendar, DollarSign, BarChart3,
  MessageSquare, Zap, Plug, Settings, LogOut, Search, Sparkles,
  Command, Menu, X, ChevronRight, ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import advoraLogo from "@/assets/advora-logo.png.asset.json";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserMenu } from "@/components/user-menu";
import { NotificationsPopover } from "@/components/notifications-popover";


type NavItem = { to: string; label: string; icon: typeof LayoutDashboard };
type NavGroup = { title: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    title: "Gestão",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/crm", label: "CRM", icon: Users },
      { to: "/processos", label: "Processos", icon: Briefcase },
      { to: "/agenda", label: "Agenda", icon: Calendar },
    ],
  },
  {
    title: "Financeiro",
    items: [
      { to: "/financeiro", label: "Financeiro", icon: DollarSign },
      { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
    ],
  },
  {
    title: "Comunicação",
    items: [
      { to: "/comunicacoes", label: "Comunicações", icon: MessageSquare },
      { to: "/automacoes", label: "Automações", icon: Zap },
    ],
  },
  {
    title: "Sistema",
    items: [
      { to: "/integracoes", label: "Integrações", icon: Plug },
      { to: "/config", label: "Configurações", icon: Settings },
    ],
  },
  {
    title: "Administração",
    items: [
      { to: "/admin/usuarios", label: "Usuários", icon: ShieldCheck },
    ],
  },
];

const labelByPath: Record<string, string> = Object.fromEntries(
  navGroups.flatMap(g => g.items.map(i => [i.to, i.label]))
);

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, branding, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  useEffect(() => {
    const root = document.documentElement;
    const variableNames = ["--primary", "--primary-hover", "--primary-soft", "--secondary-brand", "--accent", "--ring", "--gradient-brand"];
    if (!branding) {
      variableNames.forEach((name) => root.style.removeProperty(name));
      return;
    }

    const primary = branding.primary_color;
    const secondary = branding.secondary_color;
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--primary-hover", `color-mix(in oklch, ${primary} 88%, black)`);
    root.style.setProperty("--primary-soft", `color-mix(in oklch, ${primary} 11%, transparent)`);
    root.style.setProperty("--secondary-brand", secondary);
    root.style.setProperty("--accent", `color-mix(in oklch, ${primary} 12%, transparent)`);
    root.style.setProperty("--ring", primary);
    root.style.setProperty("--gradient-brand", `linear-gradient(135deg, ${primary}, ${secondary})`);
  }, [branding]);

  const initials = (profile?.full_name ?? profile?.email ?? "?")
    .split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();

  const crumbs = useMemo(() => {
    const path = location.pathname;
    const root = "/" + (path.split("/")[1] || "");
    const label = labelByPath[root] ?? "Workspace";
    return [{ label: branding?.brand_name ?? "Advora", to: "/dashboard" }, { label, to: root }];
  }, [branding?.brand_name, location.pathname]);

  const isActive = (to: string) =>
    location.pathname === to || location.pathname.startsWith(to + "/");

  const SidebarBody = (
    <>
      {/* Brand */}
      <div className="px-5 h-[72px] flex items-center gap-3 border-b border-sidebar-border">
        <div className="size-9 rounded-xl border border-primary/20 bg-primary-soft grid place-items-center overflow-hidden shrink-0">
          <img
            src={branding?.logo_url ?? advoraLogo.url}
            alt={branding?.brand_name ?? "Advora"}
            className="size-7 object-contain"
          />
        </div>
        <div className="leading-tight min-w-0 flex-1">
          <div className="text-[15px] font-semibold tracking-tight text-foreground truncate">{branding?.brand_name ?? "Advora"}</div>
          <div className="text-[10px] text-muted-foreground font-medium tracking-wider uppercase">Legal OS</div>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary"
          aria-label="Fechar menu"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {navGroups.map(group => (
          <div key={group.title}>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
              {group.title}
            </div>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = isActive(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to as never}
                    className={`group relative flex items-center gap-2.5 rounded-lg px-3 h-9 text-[13.5px] font-medium ${
                      active
                        ? "bg-primary-soft text-primary"
                        : "text-foreground/70 hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    <item.icon className={`size-[16px] shrink-0 ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} strokeWidth={active ? 2.25 : 1.75} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-secondary">
          <Avatar className="size-9 shrink-0 ring-2 ring-primary/15 ring-offset-2 ring-offset-sidebar">
            {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={profile.full_name ?? ""} />}
            <AvatarFallback className="text-xs bg-[image:var(--gradient-brand)] text-white font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-[13px] font-semibold truncate text-foreground">{profile?.full_name ?? "Usuário"}</div>
            <div className="text-[11px] text-muted-foreground truncate">{profile?.email}</div>
          </div>
          <button
            onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
            className="size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
            aria-label="Sair"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[260px] shrink-0 border-r border-sidebar-border bg-sidebar flex-col">
        {SidebarBody}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex animate-fade-in-soft">
          <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="relative w-[82%] max-w-[300px] flex flex-col border-r border-sidebar-border bg-sidebar animate-slide-in-left">
            {SidebarBody}
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[72px] border-b border-border bg-background/85 backdrop-blur-xl flex items-center gap-3 px-4 sm:px-6 sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden size-9 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary shrink-0"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </button>

          {/* Breadcrumb */}
          <nav className="hidden sm:flex items-center gap-1.5 text-[13px] min-w-0 shrink-0">
            {crumbs.map((c, i) => (
              <span key={c.to} className="inline-flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground/60" />}
                <Link
                  to={c.to as never}
                  className={i === crumbs.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
                >
                  {c.label}
                </Link>
              </span>
            ))}
          </nav>

          {/* Search (centered) */}
          <div className="flex items-center gap-2.5 max-w-[480px] flex-1 min-w-0 mx-auto h-10 px-3.5 rounded-xl border border-border bg-card hover:border-foreground/15 focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_oklch(0.555_0.225_280/0.12)]">
            <Search className="size-[15px] text-muted-foreground shrink-0" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar processos, clientes, documentos…"
              className="bg-transparent flex-1 min-w-0 outline-none text-[13.5px] placeholder:text-muted-foreground"
            />
            <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 h-5 rounded border border-border bg-secondary text-[10px] font-mono text-muted-foreground shrink-0">
              <Command className="size-2.5" /> K
            </kbd>
          </div>

          <div className="flex items-center gap-1 ml-auto shrink-0">
            <NotificationsPopover />
            <button
              className="hidden sm:grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Configurações"
              onClick={() => navigate({ to: "/config" })}
            >
              <Settings className="size-[16px]" strokeWidth={1.75} />
            </button>
            <div className="hidden sm:block w-px h-6 bg-border mx-1.5" />
            <Link
              to="/copiloto"
              className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13px] font-semibold text-primary-foreground bg-[image:var(--gradient-brand)] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]"
            >
              <Sparkles className="size-3.5" />
              <span className="hidden sm:inline">Copiloto</span>
            </Link>
            <div className="hidden sm:block w-px h-6 bg-border mx-1.5" />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

