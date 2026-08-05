import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  Eye,
  EyeOff,
  HeartHandshake,
  Loader2,
  LockKeyhole,
  Mail,
  Moon,
  Scale,
  Sun,
  TrendingUp,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/auth/")({
  head: () => ({
    meta: [
      { title: "Acesse sua conta — Advora" },
      { name: "description", content: "Entre no sistema operacional do seu escritório jurídico." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [darkCard, setDarkCard] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: profile?.tenant_id ? "/dashboard" : "/onboarding" });
  }, [user, profile, loading, navigate]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error("Não foi possível entrar. Confira seus dados e tente novamente.");
    else toast.success("Bem-vindo de volta à Advora.");
  };

  const socialLogin = async (provider: "google" | "azure") => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: new URL("/auth/callback", window.location.origin).toString(),
        ...(provider === "azure" ? { scopes: "email" } : {}),
      },
    });
    if (error) {
      toast.error(`Não foi possível continuar com ${provider === "google" ? "Google" : "Microsoft"}.`);
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email) {
      toast.info("Digite seu e-mail para receber o link de recuperação.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setBusy(false);
    if (error) toast.error("Não foi possível enviar o link agora. Tente novamente.");
    else toast.success("As instruções foram enviadas para o seu e-mail.");
  };

  return (
    <main className={`auth-ref-page${darkCard ? " auth-ref-dark" : ""}`}>
      <section className="auth-ref-story" aria-label="Sobre a plataforma Advora">
        <div className="auth-ref-veil" />
        <div className="auth-ref-wave auth-ref-wave-a" />
        <div className="auth-ref-wave auth-ref-wave-b" />
        <div className="auth-ref-wave auth-ref-wave-c" />

        <Link to="/" className="auth-ref-logo" aria-label="Advora — página inicial">
          <Scale aria-hidden="true" />
          <span><strong>ADVORA</strong><small>LEGAL OS</small></span>
        </Link>

        <div className="auth-ref-message">
          <h1>Mais controle.<br />Mais estratégia.<br />Mais <em>resultados.</em></h1>
          <p>O sistema jurídico tudo-em-um que reúne tecnologia, automação e inteligência para advogados que pensam à frente.</p>
        </div>

        <div className="auth-ref-results">
          <strong>Resultados que falam por si</strong>
          <Metric icon={<Users />} value="+12K" label="Advogados ativos" />
          <Metric icon={<BriefcaseBusiness />} value="+1.8M" label="Processos gerenciados" />
          <Metric icon={<HeartHandshake />} value="98,6%" label="Satisfação dos clientes" accent />
        </div>

        <span className="auth-ref-copyright">© 2026 Advora Legal OS</span>
      </section>

      <section className="auth-ref-panel">
        <div className="auth-ref-mobile-logo"><Scale /><strong>ADVORA</strong></div>

        <button type="button" className="auth-ref-theme" onClick={() => setDarkCard((value) => !value)} aria-label={darkCard ? "Ativar tema claro" : "Ativar tema escuro"}>
          <span>Tema</span>{darkCard ? <Sun /> : <Moon />}
        </button>

        <div className="auth-ref-form-wrap">
          <header className="auth-ref-heading">
            <h2>Acesse sua conta</h2>
            <p>Entre com seus dados para continuar</p>
          </header>

          <form className="auth-ref-form" onSubmit={signIn}>
            <FormField label="E-mail">
              <div className="auth-ref-input"><Mail /><input aria-label="E-mail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="seu@email.com" autoComplete="email" required disabled={busy} /></div>
            </FormField>

            <FormField label="Senha">
              <div className="auth-ref-input"><LockKeyhole /><input aria-label="Senha" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" autoComplete="current-password" required disabled={busy} /><button type="button" onClick={() => setShowPassword((value) => !value)} disabled={busy} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff /> : <Eye />}</button></div>
            </FormField>

            <div className="auth-ref-options">
              <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={busy} /><span><Check /></span>Manter conectado</label>
              <button type="button" onClick={resetPassword} disabled={busy}>Esqueci minha senha?</button>
            </div>

            <button type="submit" className="auth-ref-submit" disabled={busy}>
              {busy ? <><Loader2 className="auth-ref-spin" />Aguarde</> : <>Acessar<ArrowRight /></>}
            </button>
          </form>

          <div className="auth-ref-divider"><span>ou acesse com</span></div>

          <div className="auth-ref-socials">
            <button type="button" onClick={() => socialLogin("google")} disabled={busy}><b className="auth-ref-google">G</b>Google</button>
            <button type="button" onClick={() => socialLogin("azure")} disabled={busy}><b className="auth-ref-microsoft"><i /><i /><i /><i /></b>Microsoft</button>
          </div>

          <aside className="auth-ref-help">
            <img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&q=85" alt="Especialista de implantação Advora" />
            <div><strong>Precisa de ajuda para começar?</strong><span>Fale com um especialista e veja como a Advora pode transformar seu escritório.</span><a href="mailto:suporte@advora.com.br">Falar com especialista <ArrowRight /></a></div>
          </aside>
        </div>

        <footer className="auth-ref-footer"><a href="#termos">Termos de uso</a><i /> <a href="#privacidade">Privacidade</a><i /> <a href="mailto:suporte@advora.com.br">Suporte</a></footer>
      </section>
    </main>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="auth-ref-field"><span>{label}</span>{children}</label>;
}

function Metric({ icon, value, label, accent = false }: { icon: ReactNode; value: string; label: string; accent?: boolean }) {
  return (
    <div className="auth-ref-metric">
      <span className="auth-ref-metric-icon">{icon}</span>
      <span><b className={accent ? "auth-ref-accent" : ""}>{value}</b><small>{label}</small></span>
      <TrendingUp aria-hidden="true" />
    </div>
  );
}
