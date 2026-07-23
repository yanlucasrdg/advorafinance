import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Scale, Mail, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — Advora Legal OS" }, { name: "description", content: "Acesse o Advora Legal OS." }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    if (!loading && user) {
      if (profile?.tenant_id) navigate({ to: "/dashboard" });
      else navigate({ to: "/onboarding" });
    }
  }, [user, profile, loading, navigate]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Bem-vindo de volta");
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/`, data: { full_name: fullName } },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Conta criada — entrando…");
  };

  const google = async () => {
    try {
      setBusy(true);
      const res = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/auth/callback`,
      });
      if (res.error) {
        toast.error("Falha no login com Google");
        return;
      }
      toast.success("Redirecionando para o Google…");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Google sign-in error:", err);
      toast.error("Erro durante o login com Google");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left — brand panel */}
      <div className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 border-r border-border/50">
        <div className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
        <div className="absolute inset-0 grid-bg opacity-50" />
        <Link to="/" className="relative flex items-center gap-2">
          <div className="size-9 rounded-lg bg-[image:var(--gradient-brand)] grid place-items-center shadow-[var(--shadow-glow)]">
            <Scale className="size-4 text-primary-foreground" />
          </div>
          <span className="font-semibold tracking-tight text-lg">Advora</span>
        </Link>
        <div className="relative space-y-4">
          <h2 className="text-4xl font-bold tracking-tight leading-tight">
            O sistema operacional do <span className="gradient-text">escritório moderno</span>.
          </h2>
          <p className="text-muted-foreground max-w-md">
            CRM, processos, financeiro e copiloto IA — uma plataforma, todos os dados conectados.
          </p>
        </div>
        <p className="relative text-xs text-muted-foreground">© 2026 Advora Legal OS</p>
      </div>

      {/* Right — form */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="size-8 rounded-lg bg-[image:var(--gradient-brand)] grid place-items-center">
              <Scale className="size-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">Advora</span>
          </div>

          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid grid-cols-2 w-full mb-6">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <h1 className="text-2xl font-bold tracking-tight">Acesse sua conta</h1>
              <p className="text-sm text-muted-foreground mt-1">Use seu email e senha ou continue com Google.</p>
              <form onSubmit={signIn} className="mt-6 space-y-4">
                <Field label="Email" icon={Mail}>
                  <Input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@escritorio.com" />
                </Field>
                <Field label="Senha" icon={Lock}>
                  <Input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                </Field>
                <Button type="submit" disabled={busy} className="w-full bg-[image:var(--gradient-brand)] hover:opacity-90">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : "Entrar"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <h1 className="text-2xl font-bold tracking-tight">Crie sua conta</h1>
              <p className="text-sm text-muted-foreground mt-1">Comece o trial de 14 dias do seu escritório.</p>
              <form onSubmit={signUp} className="mt-6 space-y-4">
                <Field label="Nome completo"><Input required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Dr. João Silva" /></Field>
                <Field label="Email" icon={Mail}><Input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@escritorio.com" /></Field>
                <Field label="Senha" icon={Lock}><Input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" /></Field>
                <Button type="submit" disabled={busy} className="w-full bg-[image:var(--gradient-brand)] hover:opacity-90">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : "Criar conta"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> OU <div className="h-px flex-1 bg-border" />
          </div>

          <Button onClick={google} disabled={busy} variant="outline" className="w-full border-border/80">
            <svg className="size-4 mr-2" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            Continuar com Google
          </Button>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Ao continuar, você concorda com nossos <a href="#" className="underline hover:text-foreground">Termos</a> e <a href="#" className="underline hover:text-foreground">Privacidade</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, icon: Icon, children }: { label: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground flex items-center gap-1.5">{Icon && <Icon className="size-3" />} {label}</Label>
      {children}
    </div>
  );
}
