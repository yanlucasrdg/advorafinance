import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  RefreshCw,
  Send,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  Zap,
  Power,
  MessageSquare,
  Scale,
  Instagram,
  ArrowRight,
} from "lucide-react";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  zapiStatus,
  zapiQrCode,
  zapiDevice,
  zapiDisconnect,
  zapiRestart,
  zapiSendText,
} from "@/lib/zapi.functions";

export const Route = createFileRoute("/_authenticated/integracoes")({
  head: () => ({ meta: [{ title: "Integrações — Advora" }] }),
  component: IntegracoesPage,
});

type ZStatus = {
  connected: boolean;
  session: boolean;
  smartphoneConnected: boolean;
  needsQrCode?: boolean;
  error?: string | null;
};

type ConnState = "connected" | "connecting" | "disconnected" | "error";

function useZapiStatus() {
  const fn = useServerFn(zapiStatus);
  return useQuery({
    queryKey: ["zapi-status"],
    queryFn: () => fn(),
    refetchInterval: (q) => {
      const s = q.state.data as ZStatus | undefined;
      return s?.connected ? 15000 : 5000;
    },
    staleTime: 2000,
  });
}

function connState(status: ZStatus | undefined): ConnState {
  if (!status) return "connecting";
  if (status.connected) return "connected";
  if (status.error) return "error";
  return "connecting";
}

function statusMeta(state: ConnState) {
  switch (state) {
    case "connected":
      return { dot: "bg-emerald-500 shadow-[0_0_12px] shadow-emerald-500/60", label: "Conectado" };
    case "error":
      return { dot: "bg-red-500", label: "Erro" };
    case "connecting":
      return { dot: "bg-amber-400 animate-pulse", label: "Aguardando pareamento" };
    default:
      return { dot: "bg-muted-foreground/40", label: "Desconectado" };
  }
}

function IntegracoesPage() {
  const { data: status, isLoading } = useZapiStatus();
  const zapiState = connState(status);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Integrações"
        subtitle="Conecte canais externos ao Advora. Mensagens atendidas em Comunicações."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <IntegrationCard
          active
          icon={<Zap className="h-5 w-5" />}
          title="WhatsApp"
          desc="Gateway Z-API com QR Code"
          state={zapiState}
        />
        <IntegrationCard
          icon={<Scale className="h-5 w-5" />}
          title="DataJud"
          desc="Consulta de processos CNJ"
          state="connected"
          note="Integrado em Processos"
        />
        <IntegrationCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title="PJe / Projudi"
          desc="Sincronização de andamentos"
          soon
        />
        <IntegrationCard
          icon={<Instagram className="h-5 w-5" />}
          title="Instagram & Messenger"
          desc="Atendimento omnichannel"
          soon
        />
      </div>

      <ZApiPanel status={status} state={zapiState} isLoading={isLoading} />

      <Panel className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">Central de Comunicações</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Após conectar o WhatsApp, gerencie conversas, fila e tags em Comunicações.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2 shrink-0">
          <Link to="/comunicacoes">
            Abrir Comunicações
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </Panel>
    </div>
  );
}

function IntegrationCard({
  icon,
  title,
  desc,
  state,
  active,
  soon,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  state?: ConnState;
  active?: boolean;
  soon?: boolean;
  note?: string;
}) {
  const meta = soon
    ? { dot: "bg-muted-foreground/30", label: "Em breve" }
    : state
    ? statusMeta(state)
    : statusMeta("disconnected");

  return (
    <div
      className={`rounded-xl border bg-card/40 backdrop-blur p-4 transition hover:bg-card/60 ${
        active ? "border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]" : "border-border/60"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{title}</div>
            <div className="text-xs text-muted-foreground">{desc}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </div>
      </div>
      {note && <p className="mt-3 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function ZApiPanel({
  status,
  state,
  isLoading,
}: {
  status: ZStatus | undefined;
  state: ConnState;
  isLoading: boolean;
}) {
  const qc = useQueryClient();
  const getQr = useServerFn(zapiQrCode);
  const getDevice = useServerFn(zapiDevice);
  const disconnect = useServerFn(zapiDisconnect);
  const restart = useServerFn(zapiRestart);
  const sendText = useServerFn(zapiSendText);

  const connected = state === "connected";

  const { data: qr, isFetching: qrFetching, refetch: refetchQr } = useQuery({
    queryKey: ["zapi-qr"],
    queryFn: () => getQr(),
    enabled: !!status && !connected && !status.error,
    refetchInterval: !connected ? 20000 : false,
  });

  const { data: device } = useQuery({
    queryKey: ["zapi-device"],
    queryFn: () => getDevice(),
    enabled: connected,
    refetchInterval: connected ? 60000 : false,
  });

  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!phone.trim() || !message.trim()) return;
    setSending(true);
    try {
      await sendText({ data: { phone, message } });
      toast.success("Mensagem enviada");
      setMessage("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar");
    } finally {
      setSending(false);
    }
  }

  async function handleDisconnect() {
    try {
      await disconnect();
      toast("WhatsApp desconectado");
      qc.invalidateQueries({ queryKey: ["zapi-status"] });
      qc.invalidateQueries({ queryKey: ["zapi-qr"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao desconectar");
    }
  }

  async function handleRestart() {
    try {
      await restart();
      toast("Sessão reiniciada");
      qc.invalidateQueries({ queryKey: ["zapi-status"] });
      qc.invalidateQueries({ queryKey: ["zapi-qr"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reiniciar");
    }
  }

  return (
    <Panel className="overflow-hidden">
      <div className="px-5 py-3 border-b border-border/60 bg-card/30 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${statusMeta(state).dot}`} />
          <div className="min-w-0">
            <div className="text-sm font-medium flex flex-wrap items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500 shrink-0" />
              WhatsApp via Z-API
              {connected && device?.phone ? (
                <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                  {device.phone}
                </Badge>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {isLoading
                ? "Consultando status…"
                : connected
                ? `Aparelho ${device?.name ?? "conectado"} · pronto para enviar mensagens`
                : status?.error
                ? status.error
                : "Escaneie o QR Code abaixo para conectar o número do escritório"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleRestart} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> Reiniciar
          </Button>
          {connected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-2"
            >
              <Power className="h-3.5 w-3.5" /> Desconectar
            </Button>
          )}
        </div>
      </div>

      <div className="p-6 grid md:grid-cols-2 gap-8">
        <div className="flex flex-col items-center justify-center">
          {connected ? (
            <div className="text-center space-y-3">
              <div className="h-20 w-20 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 grid place-items-center">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <div className="text-sm font-medium">WhatsApp conectado</div>
              <p className="text-xs text-muted-foreground max-w-xs">
                O número está pareado. Use Comunicações para atender clientes ou envie um teste ao lado.
              </p>
            </div>
          ) : state === "error" ? (
            <div className="text-center space-y-3 max-w-xs">
              <div className="h-20 w-20 mx-auto rounded-full bg-red-500/10 text-red-500 grid place-items-center">
                <XCircle className="h-10 w-10" />
              </div>
              <div className="text-sm font-medium">Não foi possível conectar</div>
              <p className="text-xs text-muted-foreground">{status?.error}</p>
              <Button size="sm" variant="outline" onClick={() => refetchQr()} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="text-center space-y-3 w-full max-w-xs">
              <div className="relative p-3 rounded-2xl bg-white shadow-[0_0_60px_-15px_hsl(45_90%_55%/0.5)] mx-auto w-fit">
                {qr?.image ? (
                  <img src={qr.image} alt="QR Code para parear WhatsApp" className="h-56 w-56" />
                ) : qrFetching ? (
                  <Skeleton className="h-56 w-56" />
                ) : (
                  <div className="h-56 w-56 grid place-items-center text-xs text-muted-foreground p-4 text-center">
                    {qr?.error ?? "Gerando QR Code…"}
                  </div>
                )}
              </div>
              <ol className="text-xs text-muted-foreground space-y-1 text-left">
                <li>1. Abra o WhatsApp no celular</li>
                <li>2. Vá em <b>Aparelhos conectados → Conectar aparelho</b></li>
                <li>3. Aponte a câmera para o QR Code</li>
              </ol>
              <Button size="sm" variant="outline" onClick={() => refetchQr()} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" /> Atualizar QR
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" /> Mensagem de teste
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Telefone (DDI + DDD + número)</label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="5511999999999"
              className="bg-background/50"
              disabled={!connected}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Mensagem</label>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Olá, esta é uma mensagem do Advora"
              className="bg-background/50"
              disabled={!connected}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={!connected || sending || !phone.trim() || !message.trim()}
            className="gap-2 w-full"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar teste
          </Button>
          {!connected && (
            <p className="text-[11px] text-muted-foreground">
              Conecte o WhatsApp pelo QR Code para liberar o envio.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
