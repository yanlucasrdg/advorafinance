import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { BarChart3, ExternalLink, LogOut, Scale, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

const links = [
  { to: "/admin", label: "Dashboard", icon: BarChart3, exact: true },
  { to: "/admin/users", label: "Usuários", icon: Users, exact: false },
] as const;

export function PlatformAdminShell() {
  const { pathname } = useLocation();
  const { profile, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_30%),hsl(var(--background))] text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border/70 bg-card/85 p-5 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-2 py-2">
          <span className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/15">
            <Scale className="size-5" />
          </span>
          <div>
            <p className="font-semibold tracking-tight">Advora</p>
            <p className="text-xs text-muted-foreground">Administração</p>
          </div>
        </div>
        <nav className="mt-10 space-y-1.5">
          {links.map(({ to, label, icon: Icon, exact }) => {
            const active = exact ? pathname === to : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-all duration-200",
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/15"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2 border-t border-border/70 pt-5">
          <Button asChild variant="ghost" className="w-full justify-start">
            <Link to="/dashboard">
              <ExternalLink className="size-4" />
              Abrir o CRM
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" />
            Sair
          </Button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-2 lg:hidden">
            <Scale className="size-5 text-primary" />
            <span className="font-semibold">Advora Admin</span>
          </div>
          <nav className="flex gap-1 lg:hidden">
            {links.map(({ to, label }) => (
              <Button
                key={to}
                asChild
                size="sm"
                variant={
                  pathname === to || (to !== "/admin" && pathname.startsWith(to))
                    ? "secondary"
                    : "ghost"
                }
              >
                <Link to={to}>{label}</Link>
              </Button>
            ))}
          </nav>
          <div className="ml-auto hidden text-right sm:block">
            <p className="text-sm font-medium">{profile?.full_name || "Administrador"}</p>
            <p className="text-xs text-muted-foreground">Acesso global protegido</p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] p-4 sm:p-8 lg:p-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
