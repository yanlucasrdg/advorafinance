import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/auth/recuperar")({ ssr: false, component: Recovery });

function Recovery() {
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSessionReady(!!data.session)).catch(() => setSessionReady(false));
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await supabase.auth.updateUser({ password });
      if (result.error) throw result.error;
      await navigate({ to: "/dashboard", replace: true });
    } catch {
      setError("Não foi possível atualizar sua senha. Confira o link e tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return <main className="mx-auto max-w-md space-y-5 px-6 py-20">
    <h1 className="text-2xl font-semibold">Redefinir senha</h1>
    {sessionReady === null ? <p>Validando link…</p> : !sessionReady ?
      <p>Link inválido ou expirado. <Link className="underline" to="/auth">Solicitar outro link</Link></p> :
      <form className="space-y-4" onSubmit={save}>
        <label htmlFor="new-password">Nova senha (mínimo de 8 caracteres)</label>
        <Input id="new-password" required type="password" minLength={8} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy}>{busy ? "Salvando…" : "Salvar nova senha"}</Button>
      </form>}
  </main>;
}
