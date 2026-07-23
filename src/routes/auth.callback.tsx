import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const res = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/auth/callback`,
      });

      if (res.error) {
        setError(res.error.message ?? "Falha ao concluir login com Google.");
        toast.error("Não foi possível concluir o login com Google.");
        setTimeout(() => navigate({ to: "/auth" }), 1500);
        return;
      }

      // Sessão criada com sucesso — o _authenticated/route.tsx vai decidir
      // entre /dashboard e /onboarding a partir daqui.
      navigate({ to: "/dashboard" });
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen grid place-items-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">{error ?? "Concluindo login…"}</p>
      </div>
    </div>
  );
}