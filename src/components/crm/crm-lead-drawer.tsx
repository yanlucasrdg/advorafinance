import React, { useCallback, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  MessageCircle,
  Send,
  Sparkles,
  Phone,
  Mail,
  FileText,
  Calendar,
  Clock,
  UserCheck,
  Flame,
  Zap,
  Paperclip,
  Bot,
  AlertTriangle,
  Shield,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { metaWhatsAppSendText } from "@/lib/meta-whatsapp.functions";
import { askCopilot } from "@/lib/copilot.functions";
import type { ClientCardData } from "./crm-kanban-card";

type CrmLeadDrawerProps = {
  client: ClientCardData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: {
    area: string;
    value: number;
    owner: string;
    hot: boolean;
  };
  stages: readonly { id: string; label: string }[];
  onUpdateStage: (clientId: string, newStage: string) => Promise<void>;
  onSaveNotes: (clientId: string, notes: string) => Promise<void>;
};

type ChatMessage = {
  id: string;
  sender: "client" | "lawyer" | "system";
  text: string;
  time: string;
};

type LeadTab = "chat" | "ficha" | "ia" | "docs" | "tarefas";
type LoadState = "idle" | "loading" | "success" | "error";

type DrawerSession = {
  clientId: string | null;
  version: number;
};

// Exported only for the focused session-isolation regression test.
// eslint-disable-next-line react-refresh/only-export-components
export function isDrawerSessionCurrent(requested: DrawerSession, current: DrawerSession) {
  return (
    requested.clientId !== null &&
    requested.clientId === current.clientId &&
    requested.version === current.version
  );
}

function isLeadTab(value: string): value is LeadTab {
  return ["chat", "ficha", "ia", "docs", "tarefas"].includes(value);
}

function errorMessage(error: unknown, fallback: string) {
  if (
    error instanceof Error &&
    /^(Telefone não cadastrado|Inicie uma conversa)/.test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}

function formatChatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElapsedSince(value: string) {
  const milliseconds = Math.max(0, Date.now() - new Date(value).getTime());
  const hours = Math.floor(milliseconds / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} dia${days === 1 ? "" : "s"}`;
  if (hours > 0) return `${hours} hora${hours === 1 ? "" : "s"}`;
  return "menos de uma hora";
}

const TEMPLATES = [
  {
    label: "👋 Boas-vindas",
    text: "Olá! Obrigado por entrar em contato com nosso escritório. Como podemos lhe auxiliar em sua demanda jurídica hoje?",
  },
  {
    label: "📅 Agendar Consulta",
    text: "Gostaríamos de agendar uma reunião de consulta para analisar os detalhes do seu caso. Qual melhor horário para você nesta semana?",
  },
  {
    label: "📄 Envio de Proposta",
    text: "Conforme conversamos, elaboramos a proposta de honorários advocatícios para o seu caso. Posso lhe enviar em PDF por aqui?",
  },
  {
    label: "📌 Solicitar Documentos",
    text: "Para darmos andamento ao seu contrato, precisamos dos seguintes documentos: RG, CPF e Comprovante de Residência atualizado.",
  },
];

const DOCUMENT_TYPES = [
  { value: "other", label: "Outro" },
  { value: "contrato", label: "Contrato" },
  { value: "procuracao", label: "Procuração" },
  { value: "rg", label: "RG" },
  { value: "cpf", label: "CPF" },
  { value: "certidao", label: "Certidão" },
] as const;

function documentTypeLabel(value: string) {
  return DOCUMENT_TYPES.find((type) => type.value === value)?.label ?? "Documento";
}

export function CrmLeadDrawer({
  client,
  open,
  onOpenChange,
  meta,
  stages,
  onUpdateStage,
  onSaveNotes,
}: CrmLeadDrawerProps) {
  const [activeTab, setActiveTab] = useState<LeadTab>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [chatState, setChatState] = useState<LoadState>("idle");
  const [chatError, setChatError] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const { profile } = useAuth();

  const [clientDocs, setClientDocs] = useState<
    {
      id: string;
      file_name: string;
      file_path: string;
      document_type: string;
      created_at: string;
    }[]
  >([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docType, setDocType] = useState("other");
  const [docDescription, setDocDescription] = useState("");
  const [officeNotes, setOfficeNotes] = useState("");
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const messageInputRef = React.useRef<HTMLInputElement | null>(null);
  const clientId = client?.id ?? null;
  const clientNotes = client?.notes ?? null;
  const [stateClientId, setStateClientId] = useState<string | null>(clientId);
  const activeClientIdRef = React.useRef<string | null>(clientId);
  const sessionVersionRef = React.useRef(0);
  activeClientIdRef.current = clientId;

  const getCurrentSession = useCallback(
    (): DrawerSession => ({
      clientId: activeClientIdRef.current,
      version: sessionVersionRef.current,
    }),
    [],
  );

  React.useEffect(() => {
    sessionVersionRef.current += 1;
    setStateClientId(open ? clientId : null);
    setActiveTab("chat");
    setMessages([]);
    setConversationId(null);
    setInputText("");
    setSending(false);
    setChatState(clientId && open ? "loading" : "idle");
    setChatError(null);
    setAiAnalysis(null);
    setAiAnalyzing(false);
    setClientDocs([]);
    setDocsLoading(Boolean(clientId && open));
    setDocsError(null);
    setUploadingDoc(false);
    setDocType("other");
    setDocDescription("");
    setOfficeNotes("");
    if (fileRef.current) fileRef.current.value = "";
  }, [clientId, open]);

  const sessionReady = stateClientId === clientId;

  const loadMessages = useCallback(async (id: string): Promise<ChatMessage[]> => {
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("id, direction, body, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw error;
    return (data ?? []).map((message) => ({
      id: message.id,
      sender: message.direction === "inbound" ? "client" : "lawyer",
      text: message.body,
      time: formatChatTime(message.created_at),
    }));
  }, []);

  const loadConversation = useCallback(
    async (targetClientId: string, requestedSession: DrawerSession) => {
      if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
      setChatState("loading");
      setChatError(null);
      setMessages([]);
      setConversationId(null);

      try {
        const { data, error } = await supabase
          .from("whatsapp_conversations")
          .select("id")
          .eq("client_id", targetClientId)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
        if (!data) {
          setChatState("success");
          return;
        }

        const loadedMessages = await loadMessages(data.id);
        if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
        setConversationId(data.id);
        setMessages(loadedMessages);
        setChatState("success");
      } catch (error) {
        if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
        setMessages([]);
        setConversationId(null);
        setChatState("error");
        setChatError(errorMessage(error, "Não foi possível carregar a conversa."));
      }
    },
    [getCurrentSession, loadMessages],
  );

  React.useEffect(() => {
    if (!clientId || !open) return;
    const requestedSession = getCurrentSession();
    void loadConversation(clientId, requestedSession);
  }, [clientId, getCurrentSession, loadConversation, open]);

  React.useEffect(() => {
    if (!conversationId) return;
    let active = true;
    const subscriptionSession = getCurrentSession();
    const channel = supabase
      .channel(`crm-client-conversation:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void loadMessages(conversationId)
            .then((loadedMessages) => {
              if (active && isDrawerSessionCurrent(subscriptionSession, getCurrentSession())) {
                setMessages(loadedMessages);
                setChatState("success");
                setChatError(null);
              }
            })
            .catch((error) => {
              if (!active) return;
              setChatError(errorMessage(error, "Não foi possível atualizar a conversa."));
            });
        },
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [clientId, conversationId, getCurrentSession, loadMessages]);

  React.useEffect(() => {
    if (!clientId || !open) {
      setOfficeNotes("");
      return;
    }
    try {
      const parsed = clientNotes ? JSON.parse(clientNotes) : {};
      const legacyNote =
        typeof parsed.office_notes === "string"
          ? parsed.office_notes
          : typeof parsed.notes === "string"
            ? parsed.notes
            : typeof parsed.body === "string"
              ? parsed.body
              : clientNotes ?? "";
      setOfficeNotes(legacyNote);
    } catch {
      setOfficeNotes(clientNotes ?? "");
    }
  }, [clientId, clientNotes, open]);

  const loadClientDocuments = useCallback(
    async (targetClientId: string, requestedSession: DrawerSession = getCurrentSession()) => {
      if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
      setDocsLoading(true);
      setDocsError(null);
      try {
        const { data, error } = await supabase
          .from("documents")
          .select("id, file_name, file_path, document_type, created_at")
          .eq("client_id", targetClientId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
        setClientDocs(data ?? []);
      } catch (error) {
        if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
        setClientDocs([]);
        setDocsError(errorMessage(error, "Não foi possível carregar os documentos."));
      } finally {
        if (isDrawerSessionCurrent(requestedSession, getCurrentSession())) {
          setDocsLoading(false);
        }
      }
    },
    [getCurrentSession],
  );

  React.useEffect(() => {
    if (!clientId || !open) return;
    void loadClientDocuments(clientId, getCurrentSession());
  }, [clientId, getCurrentSession, loadClientDocuments, open]);

  async function uploadClientDocument(file: File) {
    if (!profile?.tenant_id || !client) return;
    const targetClient = client;
    const requestedSession = getCurrentSession();
    setUploadingDoc(true);
    try {
      const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
      const filePath = `${profile.tenant_id}/clients/${targetClient.id}/${fileName}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("documents").insert({
        tenant_id: profile.tenant_id,
        client_id: targetClient.id,
        uploaded_by: profile.id,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        file_type: file.type || "application/octet-stream",
        document_type: docType,
        description: docDescription || null,
      });
      if (insertError) throw insertError;
      if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
      setDocDescription("");
      setDocType("other");
      await loadClientDocuments(targetClient.id, requestedSession);
      toast.success("Documento enviado");
    } catch (err: unknown) {
      if (isDrawerSessionCurrent(requestedSession, getCurrentSession())) {
        toast.error("Não foi possível enviar o documento.");
      }
    } finally {
      if (isDrawerSessionCurrent(requestedSession, getCurrentSession())) {
        setUploadingDoc(false);
      }
    }
  }

  async function downloadDoc(docPath: string) {
    try {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(docPath, 60);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    } catch {
      toast.error("Não foi possível baixar o documento.");
    }
  }

  const sendTextFn = useServerFn(metaWhatsAppSendText);

  if (!client) return null;

  const visibleMessages = sessionReady ? messages : [];
  const visibleClientDocs = sessionReady ? clientDocs : [];
  const visibleInputText = sessionReady ? inputText : "";
  const visibleOfficeNotes = sessionReady ? officeNotes : "";
  const visibleAiAnalysis = sessionReady ? aiAnalysis : null;
  const visibleAiAnalyzing = sessionReady && aiAnalyzing;
  const visibleChatState: LoadState = sessionReady ? chatState : "loading";
  const visibleDocsLoading = sessionReady ? docsLoading : true;
  const visibleDocsError = sessionReady ? docsError : null;
  const visibleDocType = sessionReady ? docType : "other";
  const visibleDocDescription = sessionReady ? docDescription : "";

  const saveOfficeNotes = async () => {
    if (!sessionReady) return;
    const requestedSession = getCurrentSession();
    const targetClient = client;
    if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
    await onSaveNotes(targetClient.id, officeNotes);
  };

  const transferQueue = async (queue: string) => {
    if (!sessionReady) return;
    if (!conversationId) {
      toast.error("Inicie uma conversa no WhatsApp antes de transferir o atendimento.");
      return;
    }
    const { error } = await supabase
      .from("whatsapp_conversations")
      .update({ category: queue })
      .eq("id", conversationId);
    if (error) {
      toast.error("Não foi possível transferir o atendimento.");
      return;
    }
    const queueLabels: Record<string, string> = {
      triagem: "Triagem",
      juridico: "Jurídico",
      financeiro: "Financeiro",
      secretaria: "Secretaria",
    };
    toast.success(`Atendimento transferido para ${queueLabels[queue] ?? queue}.`);
  };

  const handleSendMessage = async () => {
    const msg = inputText;
    if (!msg.trim()) return;
    const targetClient = client;
    const requestedSession = getCurrentSession();
    setSending(true);

    try {
      if (!targetClient.phone) throw new Error("Telefone não cadastrado para este cliente.");
      const result = await sendTextFn({
        data: {
          phone: targetClient.phone,
          message: msg,
          clientId: targetClient.id,
        },
      });
      if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
      const loadedMessages = await loadMessages(result.conversationId);
      if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
      setInputText("");
      setConversationId(result.conversationId);
      setMessages(loadedMessages);
      setChatState("success");
      setChatError(null);
      toast.success("Mensagem enviada no WhatsApp.");
    } catch (error: unknown) {
      if (isDrawerSessionCurrent(requestedSession, getCurrentSession())) {
        toast.error(errorMessage(error, "Não foi possível enviar a mensagem pelo WhatsApp."));
      }
    } finally {
      if (isDrawerSessionCurrent(requestedSession, getCurrentSession())) {
        setSending(false);
      }
    }
  };

  const handleRunAiAnalysis = async () => {
    const targetClient = client;
    const targetMeta = meta;
    const requestedSession = getCurrentSession();
    setAiAnalyzing(true);
    try {
      const result = await askCopilot({
        data: {
          prompt: `Faça uma triagem jurídica inicial do cliente ${targetClient.name}. Área provável: ${targetMeta.area}. Dados disponíveis: e-mail ${targetClient.email ?? "não informado"}; telefone ${targetClient.phone ?? "não informado"}. Responda em tópicos com urgência, próximos passos, informações faltantes e uma abordagem profissional. Não invente fatos.`,
        },
      });
      if (!isDrawerSessionCurrent(requestedSession, getCurrentSession())) return;
      setAiAnalysis(result.reply);
      toast.success("Triagem por IA concluída.");
    } catch {
      if (isDrawerSessionCurrent(requestedSession, getCurrentSession())) {
        toast.error("Não foi possível executar a triagem por IA.");
      }
    } finally {
      if (isDrawerSessionCurrent(requestedSession, getCurrentSession())) {
        setAiAnalyzing(false);
      }
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col h-full bg-card border-l border-border shadow-2xl">
        {/* Drawer header */}
        <div className="p-4 border-b border-border/80 bg-muted/20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar className="h-10 w-10 ring-2 ring-primary/20">
              <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                {client.name.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SheetTitle className="text-base font-bold text-foreground truncate">
                  {client.name}
                </SheetTitle>
                {meta.hot && (
                  <Badge className="bg-rose-500 text-white text-[10px] px-1.5 py-0">
                    <Flame className="h-3 w-3 mr-0.5 fill-current" /> Quente
                  </Badge>
                )}
              </div>
              <SheetDescription className="text-xs text-muted-foreground truncate">
                {client.email || client.phone || "Sem contato cadastrado"}
              </SheetDescription>
            </div>
          </div>

          {/* Quick Stage Change & Queue Transfer */}
          <div className="flex items-center gap-2">
            {/* Queue Transfer Popover */}
            <Popover key={client.id}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!sessionReady}
                  className="h-8 text-xs font-medium gap-1 text-primary border-primary/30 bg-primary/5 hover:bg-primary/10"
                >
                  <ArrowUpRight className="h-3 w-3" />
                  <span>Transferir Fila</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[300px] p-3 space-y-3 bg-card border border-border shadow-xl"
              >
                <div className="flex items-center gap-1.5 border-b border-border pb-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <h4 className="text-xs font-bold text-foreground">
                    Transferir Fila do Atendimento
                  </h4>
                </div>
                <div className="space-y-2">
                  <Label className="text-[11px] text-muted-foreground">Nova Fila Jurídica</Label>
                  <Select
                    defaultValue="juridico"
                    onValueChange={(queue) => {
                      void transferQueue(queue);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione a fila" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="triagem" className="text-xs">
                        📥 Triagem & Recepção
                      </SelectItem>
                      <SelectItem value="juridico" className="text-xs">
                        ⚖️ Atendimento Jurídico
                      </SelectItem>
                      <SelectItem value="financeiro" className="text-xs">
                        💳 Financeiro & Honorários
                      </SelectItem>
                      <SelectItem value="secretaria" className="text-xs">
                        🏛️ Secretaria & Prazos
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </PopoverContent>
            </Popover>

            <Select value={client.status} onValueChange={(val) => onUpdateStage(client.id, val)}>
              <SelectTrigger className="h-8 text-xs font-medium w-[140px]">
                <SelectValue placeholder="Estágio do Funil" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((st) => (
                  <SelectItem key={st.id} value={st.id} className="text-xs">
                    {st.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabs header */}
        <Tabs
          value={sessionReady ? activeTab : "chat"}
          onValueChange={(value) => {
            if (isLeadTab(value)) setActiveTab(value);
          }}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="px-3 sm:px-4 border-b border-border bg-card overflow-x-auto no-scrollbar">
            <TabsList className="bg-transparent h-11 min-w-max space-x-1.5">
              <TabsTrigger
                value="chat"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs gap-1.5 font-medium"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>WhatsApp Chat</span>
              </TabsTrigger>

              <TabsTrigger
                value="ficha"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs gap-1.5 font-medium"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Ficha do Cliente</span>
              </TabsTrigger>

              <TabsTrigger
                value="ia"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs gap-1.5 font-medium"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Triagem IA</span>
              </TabsTrigger>

              <TabsTrigger
                value="docs"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs gap-1.5 font-medium"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Documentos</span>
              </TabsTrigger>

              <TabsTrigger
                value="tarefas"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs gap-1.5 font-medium"
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Acompanhamento</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* TAB 1: Conversational WhatsApp chat */}
          <TabsContent value="chat" className="flex-1 flex flex-col p-0 m-0 overflow-hidden">
            {/* Quick Templates Bar */}
            <div className="p-2.5 bg-muted/30 border-b border-border flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <span className="text-[11px] font-semibold text-muted-foreground shrink-0 ml-1">
                Modelos Rápidos:
              </span>
              {TEMPLATES.map((tmpl, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={!sessionReady}
                  onClick={() => {
                    setInputText(tmpl.text);
                    requestAnimationFrame(() => messageInputRef.current?.focus());
                  }}
                  className="shrink-0 text-[11px] font-medium bg-card hover:bg-primary/10 hover:text-primary border border-border px-2.5 py-1 rounded-full transition-colors"
                  aria-label={`Usar o modelo ${tmpl.label} como rascunho`}
                >
                  {tmpl.label}
                </button>
              ))}
            </div>

            {/* Chat Messages List */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-muted/10">
              {visibleChatState === "loading" && (
                <div
                  className="h-full min-h-40 grid place-items-center text-center px-6"
                  role="status"
                >
                  <div>
                    <RefreshCw className="size-7 text-primary/60 mx-auto mb-2 animate-spin" />
                    <p className="text-sm font-medium">Carregando conversa...</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Buscando o histórico deste cliente.
                    </p>
                  </div>
                </div>
              )}
              {visibleChatState === "error" && (
                <div
                  className="h-full min-h-40 grid place-items-center text-center px-6"
                  role="alert"
                >
                  <div className="max-w-sm">
                    <AlertTriangle className="size-8 text-destructive mx-auto mb-2" />
                    <p className="text-sm font-medium">Não foi possível carregar a conversa</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {sessionReady ? chatError : "Tente novamente em instantes."}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 gap-1.5"
                      onClick={() => {
                        void loadConversation(client.id, getCurrentSession());
                      }}
                    >
                      <RefreshCw className="size-3.5" />
                      Tentar novamente
                    </Button>
                  </div>
                </div>
              )}
              {visibleChatState === "success" && visibleMessages.length === 0 && (
                <div className="h-full min-h-40 grid place-items-center text-center px-6">
                  <div>
                    <MessageCircle className="size-8 text-primary/50 mx-auto mb-2" />
                    <p className="text-sm font-medium">Nenhuma conversa vinculada</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Envie uma mensagem para iniciar o atendimento oficial por WhatsApp.
                    </p>
                  </div>
                </div>
              )}
              {visibleChatState === "success" &&
                visibleMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.sender === "lawyer"
                        ? "justify-end"
                        : msg.sender === "system"
                          ? "justify-center"
                          : "justify-start"
                    }`}
                  >
                    {msg.sender === "system" ? (
                      <div className="bg-primary/5 text-primary border border-primary/20 px-3 py-1 rounded-full text-[11px] font-medium flex items-center gap-1.5">
                        <Bot className="h-3 w-3" />
                        <span>{msg.text}</span>
                      </div>
                    ) : (
                      <div
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs shadow-xs ${
                          msg.sender === "lawyer"
                            ? "bg-primary text-primary-foreground rounded-br-xs"
                            : "bg-card border border-border text-foreground rounded-bl-xs"
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                        <span
                          className={`block text-[9px] mt-1 text-right ${
                            msg.sender === "lawyer"
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {msg.time}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
            </div>

            {/* Message Input Bar */}
            <div className="p-3 border-t border-border bg-card flex items-center gap-2">
              <Input
                ref={messageInputRef}
                placeholder="Digite sua mensagem do WhatsApp..."
                value={visibleInputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                className="text-xs h-9 focus-visible:ring-1"
                disabled={!sessionReady || sending}
              />
              <Button
                size="sm"
                className="h-9 px-3 gap-1.5 font-medium"
                disabled={!sessionReady || sending || !visibleInputText.trim()}
                onClick={() => handleSendMessage()}
              >
                <Send className="h-3.5 w-3.5" />
                <span>Enviar</span>
              </Button>
            </div>
          </TabsContent>

          {/* TAB 2: Ficha do Cliente */}
          <TabsContent value="ficha" className="flex-1 p-4 overflow-y-auto space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Nome Completo</Label>
                <div className="text-sm font-semibold text-foreground mt-1">{client.name}</div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Tipo de Pessoa</Label>
                <div className="text-sm font-semibold text-foreground mt-1">
                  {client.type === "PJ" ? "Pessoa Jurídica" : "Pessoa Física"}
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Telefone / WhatsApp</Label>
                <div className="text-sm font-semibold text-foreground mt-1">
                  {client.phone || "Não cadastrado"}
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">E-mail</Label>
                <div className="text-sm font-semibold text-foreground mt-1">
                  {client.email || "Não cadastrado"}
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Área do Direito</Label>
                <Badge variant="outline" className="mt-1 font-semibold">
                  {meta.area}
                </Badge>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Honorário Estimado</Label>
                <div className="text-sm font-bold text-foreground mt-1">
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                    meta.value,
                  )}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-border">
              <Label className="text-xs text-muted-foreground">Anotações do Escritório</Label>
              <Textarea
                className="mt-1 text-xs min-h-[120px]"
                value={visibleOfficeNotes}
                placeholder="Insira observações relevantes sobre a negociação..."
                onChange={(e) => setOfficeNotes(e.target.value)}
                onBlur={() => void saveOfficeNotes()}
                disabled={!sessionReady}
              />
              <span className="text-[10px] text-muted-foreground mt-1 block">
                Salva automaticamente sem apagar área, valor ou partes vinculadas.
              </span>
            </div>

          </TabsContent>

          {/* TAB 3: Triagem IA */}
          <TabsContent value="ia" className="flex-1 p-4 overflow-y-auto space-y-4">
            <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h4 className="text-sm font-bold text-foreground">IA Jurídica de Triagem</h4>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Gere um resumo inicial, identifique informações faltantes e organize próximos
                passos. O conteúdo é assistivo e deve ser revisado por um profissional.
              </p>

              <Button
                size="sm"
                onClick={handleRunAiAnalysis}
                disabled={!sessionReady || visibleAiAnalyzing}
                className="gap-1.5 text-xs"
              >
                {visibleAiAnalyzing ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Analisando demanda...</span>
                  </>
                ) : (
                  <>
                    <Bot className="h-3.5 w-3.5" />
                    <span>Executar Triagem por IA</span>
                  </>
                )}
              </Button>
            </div>

            {visibleAiAnalysis && (
              <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-2 whitespace-pre-wrap font-sans text-foreground leading-relaxed shadow-xs">
                {visibleAiAnalysis}
              </div>
            )}
          </TabsContent>

          {/* TAB: Documents */}
          <TabsContent value="docs" className="flex-1 p-4 overflow-y-auto space-y-4">
            <div className="glass rounded-xl p-3 grid gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Documentos do cliente</p>
                  <p className="text-xs text-muted-foreground">
                    Arquivos privados, visíveis apenas para usuários autorizados do escritório.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={visibleDocType}
                    onValueChange={(v) => setDocType(v)}
                    disabled={!sessionReady}
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={!sessionReady || uploadingDoc}
                  >
                    {uploadingDoc ? "Enviando..." : "Upload"}
                  </Button>
                </div>
              </div>
              <Input
                placeholder="Descrição opcional"
                value={visibleDocDescription}
                onChange={(e) => setDocDescription(e.target.value)}
                disabled={!sessionReady}
              />
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadClientDocument(f);
                  e.currentTarget.value = "";
                }}
              />
            </div>

            {visibleDocsLoading ? (
              <div className="rounded-lg border border-border p-4" role="status">
                <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                <div className="h-3 w-56 rounded bg-muted animate-pulse mt-2" />
                <span className="sr-only">Carregando documentos...</span>
              </div>
            ) : visibleDocsError ? (
              <div
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center"
                role="alert"
              >
                <AlertTriangle className="size-6 text-destructive mx-auto" />
                <p className="text-sm font-medium mt-2">Não foi possível carregar os documentos</p>
                <p className="text-xs text-muted-foreground mt-1">{visibleDocsError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-1.5"
                  onClick={() => {
                    void loadClientDocuments(client.id, getCurrentSession());
                  }}
                >
                  <RefreshCw className="size-3.5" />
                  Tentar novamente
                </Button>
              </div>
            ) : visibleClientDocs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <FileText className="size-7 text-muted-foreground/60 mx-auto" />
                <p className="text-sm font-medium mt-2">Nenhum documento cadastrado</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Envie o primeiro documento deste cliente usando o botão acima.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleClientDocs.map((d) => (
                  <div
                    key={d.id}
                    className="glass rounded-lg p-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-semibold text-sm truncate">{d.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {documentTypeLabel(d.document_type)} •{" "}
                        {new Date(d.created_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => downloadDoc(d.file_path)}
                        aria-label={`Baixar ${d.file_name}`}
                        title={`Baixar ${d.file_name}`}
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 4: acompanhamento real da etapa */}
          <TabsContent value="tarefas" className="flex-1 p-4 overflow-y-auto space-y-3">
            <div className="rounded-xl border border-border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-primary" /> Tempo na etapa atual
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {stages.find((stage) => stage.id === client.status)?.label ?? "Etapa atual"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Cadastrado em: {new Date(client.created_at).toLocaleDateString("pt-BR")}
              </p>
              <p className="text-xs text-muted-foreground">
                Entrou nesta etapa há{" "}
                {formatElapsedSince(
                  client.stage_entered_at || client.updated_at || client.created_at,
                )}
                .
              </p>
            </div>

            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
              <Calendar className="mx-auto h-7 w-7 text-muted-foreground/70" />
              <p className="mt-2 text-sm font-medium text-foreground">
                Nenhum prazo exibido nesta ficha
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Prazos reais devem ser cadastrados e acompanhados pelo módulo Agenda.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
