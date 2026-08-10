import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Cloud, ExternalLink, Loader2, LockKeyhole, MessageCircle, QrCode, ShieldCheck, Zap } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { metaWhatsAppCompleteEmbeddedSignup, metaWhatsAppStatus } from "@/lib/meta-whatsapp.functions";
import { wahaWhatsAppConnect, wahaWhatsAppQrCode, wahaWhatsAppStatus } from "@/lib/waha.functions";

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
    const timeout = window.setTimeout(
      () => finish(new Error("O SDK da Meta não respondeu. Atualize a página e tente novamente.")),
      12_000,
    );
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
  const getWahaStatus = useServerFn(wahaWhatsAppStatus);
  const connectWaha = useServerFn(wahaWhatsAppConnect);
  const getWahaQrCode = useServerFn(wahaWhatsAppQrCode);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getStatus>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [waha, setWaha] = useState<Awaited<ReturnType<typeof getWahaStatus>> | null>(null);
  const [wahaLoading, setWahaLoading] = useState(true);
  const [wahaConnecting, setWahaConnecting] = useState(false);
  const [wahaQr, setWahaQr] = useState<string | null>(null);
  const signupDetails = useRef<SignupDetails | null>(null);
  const pendingCode = useRef<string | null>(null);
  const connectionTimeout = useRef<number | null>(null);

  const stopConnecting = useCallback(() => {
    if (connectionTimeout.current !== null) window.clearTimeout(connectionTimeout.current);
    connectionTimeout.current = null;
    setConnecting(false);
  }, []);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try { setStatus(await getStatus()); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível consultar a conexão WhatsApp."); }
    finally { setLoading(false); }
  }, [getStatus]);

  const refreshWahaStatus = useCallback(async () => {
    setWahaLoading(true);
    try {
      const next = await getWahaStatus();
      setWaha(next);
      if (next.connection?.status === "connected") setWahaQr(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível consultar a conexão WAHA.");
    } finally { setWahaLoading(false); }
  }, [getWahaStatus]);

  useEffect(() => {
    void refreshStatus();
    void refreshWahaStatus();
    return () => {
      if (connectionTimeout.current !== null) window.clearTimeout(connectionTimeout.current);
    };
  }, [refreshStatus, refreshWahaStatus]);

  useEffect(() => {
    if (!waha?.connection || waha.connection.status === "connected" || waha.connection.status === "error") return;
    const timer = window.setInterval(() => void refreshWahaStatus(), 5_000);
    return () => window.clearInterval(timer);
  }, [waha?.connection, refreshWahaStatus]);

  const showWahaQr = useCallback(async () => {
    try {
      const result = await getWahaQrCode();
      if (!result.image) throw new Error("O QR Code ainda não está disponível. Aguarde alguns segundos.");
      setWahaQr(result.image);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar o QR Code.");
    }
  }, [getWahaQrCode]);

  const startWaha = useCallback(async () => {
    setWahaConnecting(true);
    try {
      const result = await connectWaha();
      await refreshWahaStatus();
      if (result.status === "connected") toast.success("WhatsApp conectado pelo WAHA.");
      else {
        toast.success("Sessão WAHA iniciada. Leia o QR Code para concluir.");
        await showWahaQr();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível iniciar o WAHA.");
    } finally { setWahaConnecting(false); }
  }, [connectWaha, refreshWahaStatus, showWahaQr]);

  useEffect(() => {
    const appId = status?.embeddedSignup.appId;
    if (!status?.embeddedSignup.ready || !appId) return;
    void loadMetaSdk(appId).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Não foi possível preparar a conexão com a Meta.");
    });
  }, [status?.embeddedSignup.ready, status?.embeddedSignup.appId]);

  const finishSignup = useCallback(async () => {
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
  }, [completeSignup, refreshStatus, stopConnecting]);

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
  }, [finishSignup]);

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

      <Panel className="overflow-hidden border-emerald-500/25">
        <div className="border-b bg-emerald-500/[0.045] px-5 py-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-emerald-600 text-white"><MessageCircle className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">WhatsApp via WAHA</h2><Badge className={waha?.connection?.status === "connected" ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300" : "bg-muted text-muted-foreground hover:bg-muted"}>{waha?.connection?.status === "connected" ? "Conectado" : waha?.connection ? "Aguardando conexão" : "Não conectado"}</Badge></div>
              <p className="mt-1 text-sm text-muted-foreground">Use o número atual do escritório lendo um QR Code, com as conversas centralizadas no CRM.</p>
            </div>
          </div>
        </div>
        <div className="grid gap-6 p-5 lg:grid-cols-[1.15fr_.85fr]">
          <div className="space-y-4">
            <div><h3 className="text-sm font-semibold">Conexão rápida</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">No celular, abra WhatsApp → Aparelhos conectados → Conectar aparelho e leia o código ao lado. A sessão fica isolada por escritório.</p></div>
            <div className="grid gap-2 sm:grid-cols-3"><Step number="1" text="Iniciar sessão" /><Step number="2" text="Ler o QR Code" /><Step number="3" text="Atender no CRM" /></div>
            <div className="flex items-start gap-2 rounded-lg border bg-muted/25 p-3 text-xs leading-relaxed text-muted-foreground"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />A chave administrativa do WAHA fica somente no servidor. Webhooks são validados com HMAC SHA-512 antes de qualquer mensagem ser salva.</div>
          </div>
          <aside className="rounded-xl border bg-background p-4">
            {wahaLoading ? <div className="grid min-h-40 place-items-center"><Loader2 className="size-5 animate-spin text-emerald-600" /></div>
              : !waha?.configured ? <><CircleAlert className="size-5 text-amber-500" /><h3 className="mt-3 text-sm font-semibold">Servidor WAHA pendente</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Configure a URL, a API key e o segredo de webhook no ambiente de produção.</p></>
              : waha.connection?.status === "connected" ? <><CheckCircle2 className="size-5 text-emerald-500" /><h3 className="mt-3 text-sm font-semibold">WAHA conectado</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Mensagens enviadas pelo CRM já usam esta sessão; entradas aparecem em Comunicações.</p><dl className="mt-4 space-y-2 rounded-lg bg-muted/35 p-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Número</dt><dd className="font-medium">{waha.connection.phone || "Conectado"}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Sessão</dt><dd className="max-w-40 truncate font-medium" title={waha.connection.session_name}>{waha.connection.session_name}</dd></div></dl></>
              : <div className="space-y-3">{wahaQr ? <><img src={wahaQr} alt="QR Code para conectar o WhatsApp ao WAHA" className="mx-auto aspect-square w-full max-w-52 rounded-lg bg-white p-2" /><p className="text-center text-[11px] text-muted-foreground">O código expira rapidamente. Gere outro se necessário.</p></> : <div className="grid min-h-28 place-items-center rounded-lg border border-dashed bg-muted/20"><QrCode className="size-8 text-muted-foreground" /></div>}<Button className="w-full" size="sm" onClick={wahaQr ? showWahaQr : startWaha} disabled={wahaConnecting}>{wahaConnecting ? <><Loader2 className="size-3.5 animate-spin" />Iniciando…</> : wahaQr ? <><QrCode className="size-3.5" />Atualizar QR Code</> : <><MessageCircle className="size-3.5" />Conectar com WAHA</>}</Button></div>}
          </aside>
        </div>
      </Panel>

      <Panel className="overflow-hidden border-primary/20">
        <div className="border-b bg-primary/[0.035] px-5 py-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground"><MessageCircle className="size-5" /></div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">WhatsApp Business — API oficial Meta</h2><Badge className={isConnected ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300" : "bg-muted text-muted-foreground hover:bg-muted"}>{isConnected ? "Conectado" : "Alternativa"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Alternativa oficial para números cadastrados na plataforma empresarial da Meta.</p></div>
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
