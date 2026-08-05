import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Loader2, ShieldX } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { GlobalFiltersProvider } from "@/lib/global-filters";
import { moduleForPath } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthGate,
});

function AuthGate() {
  const { user, profile, loading, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!profile?.tenant_id) navigate({ to: "/onboarding" });
  }, [user, profile, loading, navigate]);

  if (loading || !user || !profile?.tenant_id) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const requiredModule = moduleForPath(location.pathname);
  if (requiredModule && !can(requiredModule)) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-destructive/10 text-destructive">
            <ShieldX className="size-5" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Seu perfil não possui permissão para acessar este módulo. Fale com o proprietário do escritório se precisar ampliar o acesso.
          </p>
          <Button asChild className="mt-6"><Link to="/dashboard">Voltar ao dashboard</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <GlobalFiltersProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </GlobalFiltersProvider>
  );
}
