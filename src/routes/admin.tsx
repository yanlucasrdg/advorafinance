import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { PlatformAdminShell } from "@/components/platform-admin-shell";

export const Route = createFileRoute("/admin")({
  ssr: false,
  component: PlatformAdminGate,
});

function PlatformAdminGate() {
  const { user, roles, loading } = useAuth();
  const navigate = useNavigate();
  const authorized = roles.includes("master_admin");

  useEffect(() => {
    if (loading) return;
    if (!user) void navigate({ to: "/auth" });
    else if (!authorized) void navigate({ to: "/dashboard" });
  }, [authorized, loading, navigate, user]);

  if (loading || !user || !authorized)
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  return <PlatformAdminShell />;
}
