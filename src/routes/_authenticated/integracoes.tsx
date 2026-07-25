import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Cloud, ExternalLink, Loader2, LockKeyhole, MessageCircle, ShieldCheck, Zap } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { metaWhatsAppCompleteEmbeddedSignup, metaWhatsAppStatus } from "@/lib/meta-whatsapp.functions";

type SignupDetails = { businessAccountId: string; phoneNumberId: string; displayPhoneNumber?: string };

declare global {
  interface Window {
    FB?: { init: (config: Record<string, unknown>) => void; login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void };
    fbAsyncInit?: () => void;
  }
}

export const Route = createFileRoute("/_authenticated/integracoes")({
  head: () => ({ meta: [{ title: "Integrações — Advora" }] }),
  component: IntegracoesPage,
});

function loadMetaSdk(appId: string) {
  return new Promise<void>((resolve, reject) => {
    let completed = false;
    let timeout: number;
    const finish = (error?: Error) => {
      if (completed) return;
      completed = true;
      window.clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const initialize = () => {
      if (!window.FB) {
        finish(new Error("O SDK da Meta não foi inicializado. Atualize a página e tente novamente."));
        return;
      }
      window.FB.init({ appId, cookie: true, xfbml: false, version: "v25.0" });
      finish();
    };
    timeout = window.setTimeout(() => finish(new Error("O SDK da Meta não respondeu. Atualize a página e tente novamente.")), 12_000);
    if (window.FB) {
      initialize();
      return;
    }
    window.fbAsyncInit = initialize;
    const existing = document.getElementById("meta-facebook-sdk") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("error", () => finish(new Error("Não foi possível carregar a conexão segura da Meta.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "meta-facebook-sdk";
    script.async = true;
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.onload = initialize;
    script.onerror = () => reject(new Error("Não foi possível carregar a conexão segura da Meta."));
    document.head.appendChild(script);
  });
}

function IntegracoesPage() {
  const getStatus = useServerFn(metaWhatsAppStatus);
  const completeSignup = useServerFn(metaWhatsAppCompleteEmbeddedSignup);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getStatus>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const signupDetails = useRef<SignupDetails | null>(null);
  const pendingCode = useRef<string | null>(null);
  const connectionTimeout = useRef<number | null>(null);

  const stopConnecting = () => {
    if (connectionTimeout.current !== null) window.clearTimeout(connectionTimeout.current);
    connectionTimeout.current = null;
    setConnecting(false);
  };

  const refreshStatus = async () => {
    setLoading(true);
    try { setStatus(await getStatus()); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível consultar a conexão WhatsApp."); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void refreshStatus();
    return () => {
      if (connectionTimeout.current !== null) window.clearTimeout(connectionTimeout.current);
    };
  }, []);

  useEffect(() => {
    const appId = status?.embeddedSignup.appId;
    if (!status?.embeddedSignup.ready || !appId) return;
    void loadMetaSdk(appId).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Não foi possível preparar a conexão com a Meta.");
    });
  }, [status?.embeddedSignup.ready, status?.embeddedSignup.appId]);

  const finishSignup = async () => {
    if (!pendingCode.current || !signupDetails.current) return;
    const code = pendingCode.current;
    const details = signupDetails.current;
    pendingCode.current = null;
    signupDetails.current = null;
    try {
      await completeSignup({ data: { code, ...details } });
      toast.success("WhatsApp Business conectado com segurança ao seu escritório.");
      await refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir a conexão com a Meta.");
    } finally { stopConnecting(); }
  };

  useEffect(() => {
    const receiveMetaEvent = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      let payload: unknown = event.data;
      if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return; } }
      const data = payload as { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string; phone_number?: string } };
      if (data.type !== "WA_EMBEDDED_SIGNUP" || data.event !== "FINISH" || !data.data?.waba_id || !data.data.phone_number_id) return;
      signupDetails.current = { businessAccountId: data.data.waba_id, phoneNumberId: data.data.phone_number_id, displayPhoneNumber: data.data.phone_number };
      void finishSignup();
    };
    window.addEventListener("message", receiveMetaEvent);
    return () => window.removeEventListener("message", receiveMetaEvent);
  }, []);

  const connectWhatsApp = () => {
    if (!status?.embeddedSignup.ready || !status.embeddedSignup.appId || !status.embeddedSignup.configId) {
      toast.error("A conexão profissional ainda está sendo preparada pelo administrador do Advora.");
      return;
    }
    if (!window.FB) {
      toast.error("A conexão com a Meta ainda está sendo preparada. Aguarde alguns segundos e tente novamente.");
      return;
    }
    setConnecting(true);
    connectionTimeout.current = window.setTimeout(() => {
      stopConnecting();
      toast.error("A Meta não respondeu a tempo. Feche a janela e tente novamente.");
    }, 120000);
    window.FB.login((response) => {
        const code = response.authResponse?.code;
        if (!code) { stopConnecting(); toast.error("A conexão foi cancelada ou não foi autorizada pela Meta."); return; }
        pendingCode.current = code;
        void finishSignup();
      }, {
        config_id: status.embeddedSignup.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      });
  };

  const connection = status?.connection;
  const isConnected = connection?.status === "connected";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <PageHeader title="Integrações" subtitle="Conecte os canais do seu escritório com segurança e sem configuração técnica." />

      <Panel className="overflow-hidden border-primary/20">
        <div className="border-b bg-primary/[0.035] px-5 py-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground"><MessageCircle className="size-5" /></div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">WhatsApp Business</h2><Badge className={isConnected ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300" : "bg-muted text-muted-foreground hover:bg-muted"}>{isConnected ? "Conectado" : "Não conectado"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Um número do escritório, compartilhado com a sua equipe no Advora.</p></div>
          </div>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[1.15fr_.85fr]">
          <div className="space-y-4">
            <div><h3 className="text-sm font-semibold">Como funciona</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Você autoriza o Advora pela tela oficial da Meta. Nós cuidamos dos detalhes técnicos e separamos suas conversas das demais empresas.</p></div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Step number="1" text="Entrar na Meta" /><Step number="2" text="Escolher o número" /><Step number="3" text="Começar a atender" />
            </div>
            <div className="flex items-start gap-2 rounded-lg border bg-muted/25 p-3 text-xs leading-relaxed text-muted-foreground"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-primary" />O token da empresa é criptografado e nunca aparece no navegador ou para outro escritório.</div>
          </div>

          <aside className="rounded-xl border bg-background p-4">
            {loading ? <div className="grid min-h-36 place-items-center"><Loader2 className="size-5 animate-spin text-primary" /></div> : isConnected ? <><CheckCircle2 className="size-5 text-emerald-500" /><h3 className="mt-3 text-sm font-semibold">WhatsApp conectado</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">O número está pronto para enviar e receber mensagens deste escritório.</p><dl className="mt-4 space-y-2 rounded-lg bg-muted/35 p-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Número</dt><dd className="font-medium">{connection.phone_number_id}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Conectado em</dt><dd className="font-medium">{connection.connected_at ? new Date(connection.connected_at).toLocaleDateString("pt-BR") : "—"}</dd></div></dl></> : <><ShieldCheck className="size-5 text-primary" /><h3 className="mt-3 text-sm font-semibold">Conecte em poucos minutos</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Use a conta Meta da empresa e escolha o número que atenderá seus clientes.</p><Button className="mt-4 w-full" size="sm" onClick={connecting ? stopConnecting : connectWhatsApp}>{connecting ? <><Loader2 className="size-3.5 animate-spin" />Cancelar conexão</> : <><MessageCircle className="size-3.5" />Conectar WhatsApp</>}</Button></>}
          </aside>
        </div>
      </Panel>

      <Panel className="border-amber-500/20 bg-amber-500/[0.025] p-5"><div className="flex gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600"><Zap className="size-4" /></div><div><h2 className="text-sm font-semibold">Z-API permanece como alternativa</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">A conexão oficial da Meta é o caminho padrão. Z-API somente será oferecida a empresas que já tenham esse contrato e precisem dessa alternativa.</p></div></div></Panel>

      <a className="mx-auto flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" href="https://developers.facebook.com/docs/whatsapp/embedded-signup" target="_blank" rel="noreferrer">Como funciona a conexão oficial da Meta <ExternalLink className="size-3.5" /></a>
    </div>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  return <div className="flex items-center gap-2 rounded-lg border bg-muted/20 p-2.5 text-xs font-medium"><span className="grid size-5 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">{number}</span>{text}</div>;
}
