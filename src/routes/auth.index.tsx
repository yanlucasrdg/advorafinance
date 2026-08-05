import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  Loader2,
  LockKeyhole,
  Mail,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/auth/")({
  head: () => ({
    meta: [
      { title: "Entrar — Advora" },
      { name: "description", content: "Acesse o sistema operacional do seu escritório jurídico." },
    ],
  }),
  component: AuthPage,
});

type AuthMode = "signin" | "signup";

function AuthPage() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: profile?.tenant_id ? "/dashboard" : "/onboarding" });
    }
  }, [user, profile, loading, navigate]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error("Não foi possível entrar. Confira seus dados e tente novamente.");
    else toast.success("Bem-vindo de volta à Advora.");
  };

  const signUp = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Conta criada. Verifique seu e-mail para continuar.");
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
      toast.info("Digite seu e-mail primeiro para recuperar a senha.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setBusy(false);
    if (error) toast.error("Não foi possível enviar o link agora. Tente novamente.");
    else toast.success("Enviamos as instruções de recuperação para o seu e-mail.");
  };

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Visão geral da plataforma Advora">
        <div className="auth-orb auth-orb-one" />
        <div className="auth-orb auth-orb-two" />
        <div className="auth-grid" />

        <Link to="/" className="auth-brand" aria-label="Advora — página inicial">
          <span className="auth-brand-mark"><Scale aria-hidden="true" /></span>
          <span>Advora</span>
          <span className="auth-brand-badge">LEGAL OS</span>
        </Link>

        <div className="auth-story-content">
          <span className="auth-eyebrow"><Sparkles aria-hidden="true" /> Inteligência para a prática jurídica</span>
          <h1>Decisões melhores.<br /><em>Uma operação extraordinária.</em></h1>
          <p>Transforme processos, clientes e finanças em uma única fonte de verdade — segura, inteligente e pronta para crescer.</p>

          <div className="auth-proof" aria-label="Indicadores da plataforma">
            <article>
              <span className="auth-proof-icon"><BarChart3 aria-hidden="true" /></span>
              <strong>3,2×</strong>
              <small>mais produtividade operacional</small>
            </article>
            <article>
              <span className="auth-proof-icon"><ShieldCheck aria-hidden="true" /></span>
              <strong>99,98%</strong>
              <small>de disponibilidade da plataforma</small>
            </article>
            <article>
              <span className="auth-proof-icon"><Fingerprint aria-hidden="true" /></span>
              <strong>LGPD</strong>
              <small>segurança em cada acesso</small>
            </article>
          </div>
        </div>

        <div className="auth-activity-card" aria-hidden="true">
          <div className="auth-activity-head">
            <span><i /> Operação em tempo real</span>
            <small>AGORA</small>
          </div>
          <div className="auth-chart">
            {[35, 54, 42, 67, 58, 83, 72, 92, 78, 100, 88, 108].map((height, index) => (
              <i key={index} style={{ height }} />
            ))}
          </div>
          <div className="auth-activity-foot"><span>Performance do escritório</span><strong>+24,8%</strong></div>
        </div>

        <footer className="auth-story-footer">
          <span>© 2026 Advora Tecnologia</span>
          <span><ShieldCheck aria-hidden="true" /> Ambiente protegido</span>
        </footer>
      </section>

      <section className="auth-entry">
        <div className="auth-mobile-brand">
          <span className="auth-brand-mark"><Scale aria-hidden="true" /></span>
          <strong>Advora</strong>
        </div>

        <div className="auth-entry-inner">
          <div className="auth-card">
            <div className="auth-tabs" role="tablist" aria-label="Tipo de acesso">
              <button type="button" role="tab" aria-selected={mode === "signin"} onClick={() => setMode("signin")}>Entrar</button>
              <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => setMode("signup")}>Criar conta</button>
              <span className={mode === "signup" ? "is-right" : ""} />
            </div>

            <div className="auth-heading">
              <span className="auth-kicker">{mode === "signin" ? "BEM-VINDO DE VOLTA" : "COMECE AGORA"}</span>
              <h2>{mode === "signin" ? "Acesse seu escritório" : "Crie seu espaço Advora"}</h2>
              <p>{mode === "signin" ? "Entre para continuar de onde parou." : "14 dias para conhecer uma operação jurídica melhor."}</p>
            </div>

            <form onSubmit={mode === "signin" ? signIn : signUp} className="auth-form">
              {mode === "signup" && (
                <AuthField label="Nome completo" icon={<Fingerprint />}>
                  <input aria-label="Nome completo" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Como devemos chamar você?" autoComplete="name" required disabled={busy} />
                </AuthField>
              )}

              <AuthField label="E-mail profissional" icon={<Mail />}>
                <input aria-label="E-mail profissional" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@escritorio.com.br" autoComplete="email" required disabled={busy} />
              </AuthField>

              <AuthField label="Senha" icon={<LockKeyhole />} action={
                mode === "signin" ? <button type="button" onClick={resetPassword} disabled={busy}>Esqueci minha senha</button> : undefined
              }>
                <div className="auth-password">
                  <input aria-label="Senha" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "Mínimo de 8 caracteres" : "Sua senha"} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={mode === "signup" ? 8 : undefined} required disabled={busy} />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} disabled={busy}>
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </AuthField>

              {mode === "signin" && (
                <label className="auth-remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={busy} />
                  <span><Check /></span>
                  Manter minha sessão ativa
                </label>
              )}

              <button type="submit" className="auth-submit" disabled={busy}>
                <span>{busy ? "Aguarde" : mode === "signin" ? "Entrar na Advora" : "Criar minha conta"}</span>
                {busy ? <Loader2 className="auth-spin" /> : <ArrowRight />}
              </button>
            </form>

            <div className="auth-divider"><span>ou continue com</span></div>

            <div className="auth-socials">
              <button type="button" onClick={() => socialLogin("google")} disabled={busy}>
                <span className="google-mark">G</span><span>Google</span>
              </button>
              <button type="button" onClick={() => socialLogin("azure")} disabled={busy}>
                <span className="microsoft-mark"><i /><i /><i /><i /></span><span>Microsoft</span>
              </button>
            </div>

            <p className="auth-legal">Ao continuar, você aceita os <a href="#termos">Termos de Uso</a> e a <a href="#privacidade">Política de Privacidade</a>.</p>
          </div>

          <aside className="auth-support">
            <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=160&q=85" alt="Marina, especialista de implantação Advora" />
            <div><strong>Precisa de ajuda para acessar?</strong><span>Marina, nossa especialista de implantação, responde em poucos minutos.</span></div>
            <a href="mailto:suporte@advora.com.br" aria-label="Falar com o suporte Advora"><ArrowRight /></a>
          </aside>
        </div>

        <footer className="auth-entry-footer"><a href="#seguranca">Segurança</a><a href="#privacidade">Privacidade</a><a href="mailto:suporte@advora.com.br">Suporte</a><span>Português (BR)</span></footer>
      </section>
    </main>
  );
}

function AuthField({ label, icon, action, children }: { label: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-field">
      <div className="auth-field-label"><span className="auth-field-title">{icon}{label}</span>{action}</div>
      <div className="auth-control" onClick={(event) => event.currentTarget.querySelector("input")?.focus()}>{children}</div>
    </div>
  );
}
