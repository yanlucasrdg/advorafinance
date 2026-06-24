import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  QrCode,
  Smartphone,
  PlugZap,
  RefreshCw,
  ArrowLeft,
  Send,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  MessageSquare,
  ShieldCheck,
  Globe,
  ExternalLink,
  Zap,
  Power,
} from "lucide-react";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
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

type InstanceStatus = "disconnected" | "connecting" | "connected" | "error";
type Instance = {
  id: string;
  instance_name: string;
  phone_number: string | null;
  status: InstanceStatus;
  qr_code: string | null;
  last_connected_at: string | null;
};

type Conversation = {
  id: string;
  contact_name: string | null;
  contact_phone: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
};

// =====================  BACKEND HOOKS (stubs ready for real Evolution/Z-API)  =====================
async function fetchInstance(): Promise<Instance | null> {
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("id, instance_name, phone_number, status, qr_code, last_connected_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Instance | null;
}

async function createInstance(): Promise<Instance> {
  const { data: prof } = await supabase.auth.getUser();
  const userId = prof.user?.id;
  const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", userId!).single();
  const tenantId = profile?.tenant_id;
  if (!tenantId || !userId) throw new Error("Tenant não identificado.");
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      instance_name: `advora-${Date.now()}`,
      status: "connecting",
      qr_code: "placeholder",
    })
    .select("id, instance_name, phone_number, status, qr_code, last_connected_at")
    .single();
  if (error) throw error;
  // TODO: dispatch para Evolution API / Z-API para iniciar sessão e gerar QR
  return data as Instance;
}

async function refreshQrCode(id: string) {
  const { error } = await supabase
    .from("whatsapp_instances")
    .update({ qr_code: `r-${Date.now()}`, status: "connecting" })
    .eq("id", id);
  if (error) throw error;
}

async function simulateConnected(id: string) {
  const { error } = await supabase
    .from("whatsapp_instances")
    .update({
      status: "connected",
      phone_number: "+55 11 99876-5432",
      qr_code: null,
      last_connected_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

async function disconnectInstance(id: string) {
  const { error } = await supabase.from("whatsapp_instances").delete().eq("id", id);
  if (error) throw error;
}

// =====================  PAGE  =====================
function IntegracoesPage() {
  const qc = useQueryClient();
  const { data: instance, isLoading } = useQuery({
    queryKey: ["wa-instance"],
    queryFn: fetchInstance,
    refetchInterval: (q) => {
      const s = (q.state.data as Instance | null)?.status;
      return s === "connecting" ? 3000 : false;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wa-instance"] });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader title="Integrações" subtitle="Conecte WhatsApp, tribunais e ferramentas externas" />

      {/* Connector cards row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <ConnectorCard
          active
          icon={<MessageSquare className="h-5 w-5" />}
          title="WhatsApp"
          desc="Multi-instância via QR Code (Evolution / Z-API)"
          status={instance?.status ?? "disconnected"}
        />
        <WhatsAppWebCard />
        <ZApiCard />
        <ConnectorCard icon={<ShieldCheck className="h-5 w-5" />} title="PJe / Projudi" desc="Sincronização de processos" status="disconnected" soon />
      </div>

      <ZApiPanel />

      {/* WhatsApp panel */}
      <Panel className="overflow-hidden">
        {isLoading ? (
          <div className="p-10 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : !instance || instance.status === "disconnected" ? (
          <DisconnectedState
            onConnect={async () => {
              try {
                await createInstance();
                toast.success("Iniciando sessão WhatsApp…");
                invalidate();
              } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : "Falha ao iniciar sessão");
              }
            }}
          />
        ) : instance.status === "connecting" ? (
          <QrCodeState
            instance={instance}
            onCancel={async () => {
              await disconnectInstance(instance.id);
              invalidate();
            }}
            onRefresh={async () => {
              await refreshQrCode(instance.id);
              invalidate();
              toast.success("Novo QR Code gerado");
            }}
            onSimulate={async () => {
              await simulateConnected(instance.id);
              invalidate();
              toast.success("WhatsApp conectado!");
            }}
          />
        ) : (
          <ConnectedState
            instance={instance}
            onDisconnect={async () => {
              await disconnectInstance(instance.id);
              invalidate();
              toast("Instância desconectada");
            }}
          />
        )}
      </Panel>
    </div>
  );
}

// =====================  COMPONENTS  =====================
function ConnectorCard({
  icon,
  title,
  desc,
  status,
  active,
  soon,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  status: InstanceStatus;
  active?: boolean;
  soon?: boolean;
}) {
  const dot =
    status === "connected"
      ? "bg-emerald-500 shadow-[0_0_12px] shadow-emerald-500/60"
      : status === "connecting"
      ? "bg-amber-400 animate-pulse"
      : "bg-muted-foreground/40";
  return (
    <div
      className={`relative rounded-xl border bg-card/40 backdrop-blur p-4 transition hover:bg-card/60 ${
        active ? "border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]" : "border-border/60"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary grid place-items-center">{icon}</div>
          <div>
            <div className="font-medium">{title}</div>
            <div className="text-xs text-muted-foreground">{desc}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {soon ? "Em breve" : status === "connected" ? "Conectado" : status === "connecting" ? "Conectando" : "Desconectado"}
        </div>
      </div>
    </div>
  );
}

// =====================  WHATSAPP WEB (oficial)  =====================
type WebStatus = "disconnected" | "pending" | "connected";
const WA_WEB_KEY = "advora:wa-web:status";
const WA_WEB_TS = "advora:wa-web:opened-at";

function WhatsAppWebCard() {
  const [status, setStatus] = useState<WebStatus>("disconnected");

  // Load persisted status
  useEffect(() => {
    try {
      const s = (localStorage.getItem(WA_WEB_KEY) as WebStatus | null) ?? "disconnected";
      setStatus(s);
    } catch {
      /* ignore */
    }
  }, []);

  // When the tab regains focus after opening WhatsApp Web, ask the user to confirm.
  useEffect(() => {
    function onFocus() {
      const opened = Number(localStorage.getItem(WA_WEB_TS) ?? 0);
      const current = (localStorage.getItem(WA_WEB_KEY) as WebStatus | null) ?? "disconnected";
      if (opened && current === "pending") {
        // Surface a friendly prompt to confirm authentication
        toast("Você concluiu o login no WhatsApp Web?", {
          action: {
            label: "Sim, conectei",
            onClick: () => {
              localStorage.setItem(WA_WEB_KEY, "connected");
              setStatus("connected");
              toast.success("WhatsApp Web conectado");
            },
          },
          cancel: { label: "Ainda não", onClick: () => {} },
          duration: 8000,
        });
      }
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  function handleConnect() {
    const url = "https://web.whatsapp.com";
    // Sem feature string: navegadores tratam como navegação normal de aba (não popup),
    // reduzindo bloqueio. Mantemos rel=noopener via <a> de fallback abaixo.
    const win = window.open(url, "_blank");
    if (!win || win.closed || typeof win.closed === "undefined") {
      toast.error("Seu navegador bloqueou a nova aba.", {
        description: "Permita pop-ups para advora.com.br ou abra manualmente.",
        action: {
          label: "Abrir agora",
          onClick: () => {
            const a = document.createElement("a");
            a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
            document.body.appendChild(a); a.click(); a.remove();
          },
        },
        duration: 10000,
      });
      return;
    }
    localStorage.setItem(WA_WEB_KEY, "pending");
    localStorage.setItem(WA_WEB_TS, String(Date.now()));
    setStatus("pending");
    toast.info("Aguardando autenticação no WhatsApp Web…", {
      description: "Escaneie o QR Code na aba aberta para concluir o login.",
    });
  }

  function handleDisconnect() {
    localStorage.setItem(WA_WEB_KEY, "disconnected");
    localStorage.removeItem(WA_WEB_TS);
    setStatus("disconnected");
    toast("Sessão WhatsApp Web removida do Advora", {
      description: "Para encerrar a sessão no celular, use 'Aparelhos conectados' no WhatsApp.",
    });
  }

  const meta =
    status === "connected"
      ? { dot: "bg-emerald-500 shadow-[0_0_12px] shadow-emerald-500/60", label: "Conectado" }
      : status === "pending"
      ? { dot: "bg-amber-400 animate-pulse", label: "Aguardando autenticação" }
      : { dot: "bg-muted-foreground/40", label: "Desconectado" };

  return (
    <div className="relative rounded-xl border border-emerald-500/30 bg-card/40 backdrop-blur p-4 transition hover:bg-card/60 shadow-[0_0_0_1px_hsl(142_70%_45%/0.10)]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-500 grid place-items-center">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium">WhatsApp Web</div>
            <div className="text-xs text-muted-foreground">Conexão oficial via web.whatsapp.com</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {status === "connected" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => window.open("https://web.whatsapp.com", "_blank")}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Abrir WhatsApp Web
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDisconnect} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-2">
              <XCircle className="h-3.5 w-3.5" /> Desconectar
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={handleConnect} className="gap-2 bg-emerald-600 hover:bg-emerald-600/90 text-white">
            <PlugZap className="h-3.5 w-3.5" /> Conectar WhatsApp
          </Button>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Integração baseada na plataforma oficial do WhatsApp. Em conformidade com os Termos de Serviço da Meta.
      </p>
    </div>
  );
}


function DisconnectedState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="p-10 grid md:grid-cols-2 gap-8 items-center">
      <div className="space-y-4">
        <Badge variant="outline" className="border-primary/30 text-primary">
          WhatsApp Business
        </Badge>
        <h2 className="text-2xl font-semibold tracking-tight">Centralize seus atendimentos no Advora</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Conecte o WhatsApp do seu escritório via QR Code e atenda seus clientes diretamente da plataforma, com
          histórico unificado, IA jurídica e isolamento total por tenant.
        </p>
        <ul className="text-sm space-y-2 text-muted-foreground">
          <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Multi-instância por escritório</li>
          <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Mensagens criptografadas e isoladas por tenant</li>
          <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Compatível com Evolution API / Z-API</li>
        </ul>
        <Button onClick={onConnect} size="lg" className="gap-2">
          <PlugZap className="h-4 w-4" /> Conectar Novo Número
        </Button>
      </div>
      <div className="hidden md:flex justify-center">
        <div className="relative h-64 w-64 rounded-2xl border border-border/60 bg-gradient-to-br from-primary/10 to-transparent grid place-items-center">
          <Smartphone className="h-20 w-20 text-primary/60" />
          <QrCode className="absolute bottom-4 right-4 h-10 w-10 text-primary/80" />
        </div>
      </div>
    </div>
  );
}

function QrCodeState({
  instance,
  onCancel,
  onRefresh,
  onSimulate,
}: {
  instance: Instance;
  onCancel: () => void;
  onRefresh: () => void;
  onSimulate: () => void;
}) {
  const [seconds, setSeconds] = useState(60);
  useEffect(() => {
    setSeconds(60);
    const t = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [instance.qr_code]);

  return (
    <div className="p-10 grid md:grid-cols-2 gap-10 items-center">
      <div className="flex justify-center">
        <div className="relative p-4 rounded-2xl bg-white shadow-[0_0_60px_-15px_hsl(var(--primary)/0.5)]">
          {instance.qr_code ? (
            <FakeQrCode seed={instance.qr_code} />
          ) : (
            <Skeleton className="h-64 w-64" />
          )}
          <div className="absolute -top-3 -right-3 bg-primary text-primary-foreground text-[10px] px-2 py-1 rounded-full">
            {seconds}s
          </div>
        </div>
      </div>
      <div className="space-y-5">
        <Button variant="ghost" size="sm" onClick={onCancel} className="gap-2 -ml-2">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <h2 className="text-2xl font-semibold tracking-tight">Escaneie o QR Code</h2>
        <ol className="space-y-3 text-sm">
          <Step n={1}>Abra o <b>WhatsApp</b> no seu celular</Step>
          <Step n={2}>Toque em <b>Aparelhos conectados</b> nas configurações</Step>
          <Step n={3}>Aponte a câmera e escaneie este código</Step>
        </ol>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={onRefresh} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Atualizar QR Code
          </Button>
          <Button onClick={onSimulate} className="gap-2">
            <CheckCircle2 className="h-4 w-4" /> Simular conexão
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          O código expira em <b>{seconds}s</b>. Após escanear, esta tela será atualizada automaticamente.
        </p>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="h-6 w-6 rounded-full bg-primary/15 text-primary text-xs grid place-items-center font-medium">
        {n}
      </span>
      <span className="text-muted-foreground pt-0.5">{children}</span>
    </li>
  );
}

function FakeQrCode({ seed }: { seed: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("qrcode").then((QR) =>
      QR.toDataURL(`advora-wa://pair?token=${seed}`, {
        margin: 1,
        width: 256,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      }).then((url) => {
        if (!cancelled) setDataUrl(url);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [seed]);
  if (!dataUrl) return <Skeleton className="h-64 w-64" />;
  return <img src={dataUrl} alt="QR Code de pareamento WhatsApp" className="h-64 w-64" />;
}


// =====================  CONNECTED + CHAT  =====================
function ConnectedState({ instance, onDisconnect }: { instance: Instance; onDisconnect: () => void }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 bg-card/30">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_12px] shadow-emerald-500/60" />
          <div>
            <div className="text-sm font-medium">WhatsApp Conectado</div>
            <div className="text-xs text-muted-foreground">
              {instance.phone_number ?? "—"} · {instance.instance_name}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onDisconnect} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-2">
          <XCircle className="h-4 w-4" /> Desconectar
        </Button>
      </div>
      <ChatPanel instance={instance} />
    </div>
  );
}

function ChatPanel({ instance }: { instance: Instance }) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ["wa-convs", instance.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("id, contact_name, contact_phone, last_message, last_message_at, unread_count")
        .eq("instance_id", instance.id)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Conversation[];
    },
  });

  useEffect(() => {
    if (!activeId && conversations.length) setActiveId(conversations[0].id);
  }, [conversations, activeId]);

  const { data: messages = [] } = useQuery({
    queryKey: ["wa-msgs", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("id, direction, body, created_at")
        .eq("conversation_id", activeId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const filtered = conversations.filter((c) =>
    (c.contact_name ?? c.contact_phone).toLowerCase().includes(query.toLowerCase()),
  );
  const active = conversations.find((c) => c.id === activeId);

  async function send() {
    if (!draft.trim() || !activeId) return;
    const body = draft.trim();
    setDraft("");
    const { data: prof } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", prof.user!.id).single();
    const { error } = await supabase.from("whatsapp_messages").insert({
      tenant_id: profile!.tenant_id!,
      conversation_id: activeId,
      direction: "outbound",
      body,
      status: "sent",
    });
    if (error) {
      toast.error("Falha ao enviar");
      return;
    }
    await supabase
      .from("whatsapp_conversations")
      .update({ last_message: body, last_message_at: new Date().toISOString() })
      .eq("id", activeId);
    qc.invalidateQueries({ queryKey: ["wa-msgs", activeId] });
    qc.invalidateQueries({ queryKey: ["wa-convs", instance.id] });
    // TODO: dispatch para backend (Evolution/Z-API) enviar mensagem real
  }

  return (
    <div className="grid grid-cols-[320px_1fr] h-[600px]">
      {/* Sidebar */}
      <div className="border-r border-border/60 flex flex-col bg-card/20">
        <div className="p-3 border-b border-border/60">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar conversa…"
              className="pl-8 h-9 bg-background/50"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Nenhuma conversa ainda. Quando seus clientes mandarem mensagem, elas aparecerão aqui.
            </div>
          ) : (
            <ul>
              {filtered.map((c) => {
                const isActive = c.id === activeId;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setActiveId(c.id)}
                      className={`w-full text-left px-3 py-3 flex gap-3 items-center border-l-2 transition ${
                        isActive ? "bg-primary/10 border-primary" : "border-transparent hover:bg-card/60"
                      }`}
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-primary/20 text-primary text-xs">
                          {(c.contact_name ?? c.contact_phone).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium truncate">{c.contact_name ?? c.contact_phone}</div>
                          {c.unread_count > 0 && (
                            <Badge className="h-5 px-1.5 text-[10px] bg-emerald-500 text-white">{c.unread_count}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{c.last_message ?? "—"}</div>
                      </div>
                    </button>
                    <Separator />
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </div>

      {/* Chat area */}
      <div className="flex flex-col bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.05),transparent_60%)]">
        {active ? (
          <>
            <div className="px-4 py-3 border-b border-border/60 flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/20 text-primary text-xs">
                  {(active.contact_name ?? active.contact_phone).slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="text-sm font-medium">{active.contact_name ?? active.contact_phone}</div>
                <div className="text-[11px] text-muted-foreground">{active.contact_phone}</div>
              </div>
            </div>
            <ScrollArea className="flex-1 px-6 py-4">
              <div className="space-y-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${
                      m.direction === "outbound"
                        ? "ml-auto bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-card border border-border/60 rounded-bl-sm"
                    }`}
                  >
                    {m.body}
                    <div className={`text-[10px] mt-1 opacity-70 ${m.direction === "outbound" ? "text-right" : ""}`}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
            </ScrollArea>
            <div className="p-3 border-t border-border/60 flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Digite uma mensagem…"
                className="bg-background/50"
              />
              <Button onClick={send} disabled={!draft.trim()} className="gap-2">
                <Send className="h-4 w-4" /> Enviar
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
            <div className="text-center space-y-2">
              <MessageSquare className="h-10 w-10 mx-auto text-primary/60" />
              <div>Selecione uma conversa para começar</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================  Z-API (oficial via API Z-API)  =====================
type ZStatus = {
  connected: boolean;
  session: boolean;
  smartphoneConnected: boolean;
  needsQrCode?: boolean;
  error?: string | null;
};

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

function ZApiCard() {
  const { data } = useZapiStatus();
  const status: InstanceStatus = data?.connected
    ? "connected"
    : data?.error
    ? "error"
    : "connecting";
  const dot =
    status === "connected"
      ? "bg-emerald-500 shadow-[0_0_12px] shadow-emerald-500/60"
      : status === "error"
      ? "bg-red-500"
      : "bg-amber-400 animate-pulse";
  const label = data?.connected
    ? "Conectado"
    : data?.error
    ? "Erro"
    : "Aguardando QR Code";
  return (
    <div className="relative rounded-xl border border-amber-500/30 bg-card/40 backdrop-blur p-4 transition hover:bg-card/60 shadow-[0_0_0_1px_hsl(45_90%_55%/0.10)]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-500 grid place-items-center">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium">Z-API</div>
            <div className="text-xs text-muted-foreground">WhatsApp via gateway Z-API</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {label}
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Use o painel abaixo para parear o aparelho e enviar mensagens reais.
      </p>
    </div>
  );
}

function ZApiPanel() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useZapiStatus();
  const getQr = useServerFn(zapiQrCode);
  const getDevice = useServerFn(zapiDevice);
  const disconnect = useServerFn(zapiDisconnect);
  const restart = useServerFn(zapiRestart);
  const sendText = useServerFn(zapiSendText);

  const connected = !!status?.connected;

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
      toast.success("Mensagem enviada via Z-API");
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
      toast("Z-API desconectada");
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reiniciar");
    }
  }

  return (
    <Panel className="overflow-hidden">
      <div className="px-5 py-3 border-b border-border/60 bg-card/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              connected
                ? "bg-emerald-500 shadow-[0_0_12px] shadow-emerald-500/60"
                : status?.error
                ? "bg-red-500"
                : "bg-amber-400 animate-pulse"
            }`}
          />
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" /> Z-API
              {connected && device?.phone ? (
                <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                  {device.phone}
                </Badge>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground">
              {isLoading
                ? "Consultando status…"
                : connected
                ? `Aparelho ${device?.name ?? "conectado"} · sessão ativa`
                : status?.error
                ? status.error
                : "Aguardando pareamento do WhatsApp"}
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
        {/* Pareamento / status */}
        <div className="flex flex-col items-center justify-center">
          {connected ? (
            <div className="text-center space-y-3">
              <div className="h-20 w-20 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 grid place-items-center">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <div className="text-sm font-medium">WhatsApp conectado via Z-API</div>
              <div className="text-xs text-muted-foreground">
                Pronto para enviar e receber mensagens.
              </div>
            </div>
          ) : status?.error ? (
            <div className="text-center space-y-3 max-w-xs">
              <div className="h-20 w-20 mx-auto rounded-full bg-red-500/10 text-red-500 grid place-items-center">
                <XCircle className="h-10 w-10" />
              </div>
              <div className="text-sm font-medium">Não foi possível conectar</div>
              <div className="text-xs text-muted-foreground">{status.error}</div>
              <Button size="sm" variant="outline" onClick={() => refetchQr()} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="text-center space-y-3">
              <div className="relative p-3 rounded-2xl bg-white shadow-[0_0_60px_-15px_hsl(45_90%_55%/0.5)]">
                {qr?.image ? (
                  <img
                    src={qr.image}
                    alt="QR Code Z-API"
                    className="h-56 w-56"
                  />
                ) : qrFetching ? (
                  <Skeleton className="h-56 w-56" />
                ) : (
                  <div className="h-56 w-56 grid place-items-center text-xs text-muted-foreground p-4 text-center">
                    {qr?.error ?? "Gerando QR Code…"}
                  </div>
                )}
              </div>
              <ol className="text-xs text-muted-foreground space-y-1 text-left">
                <li>1. Abra o WhatsApp no seu celular</li>
                <li>2. Vá em <b>Aparelhos conectados → Conectar aparelho</b></li>
                <li>3. Aponte a câmera para o QR Code</li>
              </ol>
              <Button size="sm" variant="outline" onClick={() => refetchQr()} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" /> Atualizar QR
              </Button>
            </div>
          )}
        </div>

        {/* Envio de teste */}
        <div className="space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" /> Enviar mensagem de teste
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
            Enviar via Z-API
          </Button>
          {!connected && (
            <p className="text-[11px] text-muted-foreground">
              Pareie o WhatsApp pelo QR Code para liberar o envio.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

