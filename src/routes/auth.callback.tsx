import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'

export const Route = createFileRoute('/auth/callback')({
  ssr: false,
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const completeSignIn = async () => {
      // With an implicit OAuth response, supabase-js may consume the URL hash
      // before this component runs. In that case the session is already stored
      // and there is no PKCE `code` left in the address bar.
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        navigate({ to: '/dashboard', replace: true })
        return
      }

      const code = new URLSearchParams(window.location.search).get('code')

      if (!code) {
        if (active) setError('O retorno do Google não contém um código de autenticação.')
        return
      }

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
      if (exchangeError) {
        if (active) setError('Não foi possível concluir o login com Google. Tente novamente.')
        return
      }

      navigate({ to: '/dashboard', replace: true })
    }

    void completeSignIn()
    return () => {
      active = false
    }
  }, [navigate])

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold">Não foi possível entrar</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <a className="mt-5 inline-block text-sm underline" href="/auth">Voltar ao login</a>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto size-6 animate-spin text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">Concluindo login com Google…</p>
          </>
        )}
      </div>
    </main>
  )
}
