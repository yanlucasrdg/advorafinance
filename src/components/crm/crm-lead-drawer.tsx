import React, { useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  MessageCircle, Send, Sparkles, Phone, Mail, FileText, Calendar, Clock,
  UserCheck, CheckCircle2, Flame, Zap, Paperclip, Bot, AlertTriangle, Shield,
  ArrowUpRight, RefreshCw,
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

const TEMPLATES = [
  { label: "👋 Boas-vindas", text: "Olá! Obrigado por entrar em contato com nosso escritório. Como podemos lhe auxiliar em sua demanda jurídica hoje?" },
  { label: "📅 Agendar Consulta", text: "Gostaríamos de agendar uma reunião de consulta para analisar os detalhes do seu caso. Qual melhor horário para você nesta semana?" },
  { label: "📄 Envio de Proposta", text: "Conforme conversamos, elaboramos a proposta de honorários advocatícios para o seu caso. Posso lhe enviar em PDF por aqui?" },
  { label: "📌 Solicitar Documentos", text: "Para darmos andamento ao seu contrato, precisamos dos seguintes documentos: RG, CPF e Comprovante de Residência atualizado." },
];

export function CrmLeadDrawer({
  client,
  open,
  onOpenChange,
  meta,
  stages,
  onUpdateStage,
  onSaveNotes,
}: CrmLeadDrawerProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "ficha" | "ia" | "docs" | "tarefas">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const { profile } = useAuth();

  const [clientDocs, setClientDocs] = useState<{
    id: string; file_name: string; file_path: string; document_type: string; created_at: string;
  }[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docType, setDocType] = useState("other");
  const [docDescription, setDocDescription] = useState("");
  const [officeNotes, setOfficeNotes] = useState("");
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const formatChatTime = (value: string) => new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const loadMessages = async (id: string) => {
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("id, direction, body, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw error;
    setMessages((data ?? []).map((message: any) => ({
      id: message.id,
      sender: message.direction === "inbound" ? "client" : "lawyer",
      text: message.body,
      time: formatChatTime(message.created_at),
    })));
  };

  React.useEffect(() => {
    let active = true;
    const loadConversation = async () => {
      setMessages([]);
      setConversationId(null);
      if (!client?.id) return;
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("id")
        .eq("client_id", client.id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error || !data || !active) return;
      setConversationId(data.id);
      try { await loadMessages(data.id); } catch (err) { console.error(err); }
    };
    void loadConversation();
    return () => { active = false; };
  }, [client?.id]);

  React.useEffect(() => {
    if (!conversationId) return;
    const channel = supabase.channel(`crm-client-conversation:${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages", filter: `conversation_id=eq.${conversationId}` }, () => {
        void loadMessages(conversationId);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  React.useEffect(() => {
    if (!client) { setOfficeNotes(""); return; }
    try {
      const parsed = client.notes ? JSON.parse(client.notes) : {};
      setOfficeNotes(typeof parsed.office_notes === "string" ? parsed.office_notes : "");
    } catch {
      setOfficeNotes(client.notes ?? "");
    }
  }, [client?.id, client?.notes]);

  async function loadClientDocuments(clientId: string) {
    setDocsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("documents")
        .select("id, file_name, file_path, document_type, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setClientDocs((data ?? []) as any);
    } catch (err) {
      console.error(err);
    } finally {
      setDocsLoading(false);
    }
  }

  React.useEffect(() => {
    if (!client) return;
    loadClientDocuments(client.id);
  }, [client?.id]);

  async function uploadClientDocument(file: File) {
    if (!profile?.tenant_id || !client) return;
    setUploadingDoc(true);
    try {
      const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
      const filePath = `${profile.tenant_id}/clients/${client.id}/${fileName}`;
      const { error: uploadError } = await supabase.storage.from("documents").upload(filePath, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await (supabase as any).from("documents").insert({
        tenant_id: profile.tenant_id,
        client_id: client.id,
        uploaded_by: profile.id,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        file_type: file.type || "application/octet-stream",
        document_type: docType,
        description: docDescription || null,
      });
      if (insertError) throw insertError;
      setDocDescription("");
      setDocType("other");
      await loadClientDocuments(client.id);
      toast.success("Documento enviado");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar documento");
    } finally {
      setUploadingDoc(false);
    }
  }

  async function downloadDoc(docPath: string) {
    try {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(docPath, 60);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao baixar documento");
    }
  }

  const sendTextFn = useServerFn(metaWhatsAppSendText);

  if (!client) return null;

  const saveOfficeNotes = async () => {
    let current: Record<string, unknown> = {};
    try { current = client.notes ? JSON.parse(client.notes) : {}; } catch { current = {}; }
    await onSaveNotes(client.id, JSON.stringify({ ...current, office_notes: officeNotes }));
  };

  const transferQueue = async (queue: string) => {
    if (!conversationId) {
      toast.error("Inicie uma conversa no WhatsApp antes de transferir o atendimento.");
      return;
    }
    const { error } = await supabase.from("whatsapp_conversations")
      .update({ category: queue })
      .eq("id", conversationId);
    if (error) { toast.error(error.message); return; }
    const queueLabels: Record<string, string> = { triagem: "Triagem", juridico: "Jurídico", financeiro: "Financeiro", secretaria: "Secretaria" };
    toast.success(`Atendimento transferido para ${queueLabels[queue] ?? queue}.`);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const msg = textToSend || inputText;
    if (!msg.trim()) return;
    setSending(true);

    try {
      if (!client.phone) throw new Error("Telefone não cadastrado para este cliente.");
      const result = await sendTextFn({ data: { phone: client.phone, message: msg, clientId: client.id } });
      setInputText("");
      setConversationId(result.conversationId);
      await loadMessages(result.conversationId);
      toast.success("Mensagem enviada no WhatsApp.");
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível enviar a mensagem pelo WhatsApp.");
    } finally {
      setSending(false);
    }
  };

  const handleRunAiAnalysis = async () => {
    setAiAnalyzing(true);
    try {
      const result = await askCopilot({ data: { prompt: `Faça uma triagem jurídica inicial do cliente ${client.name}. Área provável: ${meta.area}. Dados disponíveis: e-mail ${client.email ?? "não informado"}; telefone ${client.phone ?? "não informado"}. Responda em tópicos com urgência, próximos passos, informações faltantes e uma abordagem profissional. Não invente fatos.` } });
      setAiAnalysis(result.reply);
      toast.success("Triagem por IA concluída.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível executar a triagem por IA.");
    } finally {
      setAiAnalyzing(false);
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
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs font-medium gap-1 text-primary border-primary/30 bg-primary/5 hover:bg-primary/10">
                  <ArrowUpRight className="h-3 w-3" />
                  <span>Transferir Fila</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[300px] p-3 space-y-3 bg-card border border-border shadow-xl">
                <div className="flex items-center gap-1.5 border-b border-border pb-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <h4 className="text-xs font-bold text-foreground">Transferir Fila do Atendimento</h4>
                </div>
                <div className="space-y-2">
                  <Label className="text-[11px] text-muted-foreground">Nova Fila Jurídica</Label>
                  <Select
                    defaultValue="juridico"
                    onValueChange={(queue) => { void transferQueue(queue); }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione a fila" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="triagem" className="text-xs">📥 Triagem & Recepção</SelectItem>
                      <SelectItem value="juridico" className="text-xs">⚖️ Atendimento Jurídico</SelectItem>
                      <SelectItem value="financeiro" className="text-xs">💳 Financeiro & Honorários</SelectItem>
                      <SelectItem value="secretaria" className="text-xs">🏛️ Secretaria & Prazos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </PopoverContent>
            </Popover>

            <Select
              value={client.status}
              onValueChange={(val) => onUpdateStage(client.id, val)}
            >
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
        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 sm:px-4 border-b border-border bg-card overflow-x-auto no-scrollbar">
            <TabsList className="bg-transparent h-11 min-w-max space-x-1.5">
              <TabsTrigger value="chat" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs gap-1.5 font-medium">
                <MessageCircle className="h-3.5 w-3.5" />
                <span>WhatsApp Chat</span>
              </TabsTrigger>

              <TabsTrigger value="ficha" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs gap-1.5 font-medium">
                <FileText className="h-3.5 w-3.5" />
                <span>Ficha do Cliente</span>
              </TabsTrigger>

              <TabsTrigger value="ia" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs gap-1.5 font-medium">
                <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                <span>Triagem IA</span>
              </TabsTrigger>

              <TabsTrigger value="docs" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs gap-1.5 font-medium">
                <FileText className="h-3.5 w-3.5" />
                <span>Documentos</span>
              </TabsTrigger>

              <TabsTrigger value="tarefas" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs gap-1.5 font-medium">
                <Clock className="h-3.5 w-3.5" />
                <span>Prazos & SLA</span>
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
                  onClick={() => handleSendMessage(tmpl.text)}
                  className="shrink-0 text-[11px] font-medium bg-card hover:bg-primary/10 hover:text-primary border border-border px-2.5 py-1 rounded-full transition-colors"
                >
                  {tmpl.label}
                </button>
              ))}
            </div>

            {/* Chat Messages List */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-muted/10">
              {messages.length === 0 && (
                <div className="h-full min-h-40 grid place-items-center text-center px-6">
                  <div>
                    <MessageCircle className="size-8 text-primary/50 mx-auto mb-2" />
                    <p className="text-sm font-medium">Nenhuma conversa vinculada</p>
                    <p className="text-xs text-muted-foreground mt-1">Envie uma mensagem para iniciar o atendimento oficial por WhatsApp.</p>
                  </div>
                </div>
              )}
              {messages.map((msg) => (
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
                          msg.sender === "lawyer" ? "text-primary-foreground/70" : "text-muted-foreground"
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
                placeholder="Digite sua mensagem do WhatsApp..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                className="text-xs h-9 focus-visible:ring-1"
              />
              <Button
                size="sm"
                className="h-9 px-3 gap-1.5 font-medium"
                disabled={sending || !inputText.trim()}
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
                <div className="text-sm font-semibold text-foreground mt-1">{client.type === "PJ" ? "Pessoa Jurídica" : "Pessoa Física"}</div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Telefone / WhatsApp</Label>
                <div className="text-sm font-semibold text-foreground mt-1">{client.phone || "Não cadastrado"}</div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">E-mail</Label>
                <div className="text-sm font-semibold text-foreground mt-1">{client.email || "Não cadastrado"}</div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Área do Direito</Label>
                <Badge variant="outline" className="mt-1 font-semibold">{meta.area}</Badge>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Honorário Estimado</Label>
                <div className="text-sm font-bold text-foreground mt-1">
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(meta.value)}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-border">
              <Label className="text-xs text-muted-foreground">Anotações do Escritório</Label>
              <Textarea
                className="mt-1 text-xs min-h-[120px]"
                value={officeNotes}
                placeholder="Insira observações relevantes sobre a negociação..."
                onChange={(e) => setOfficeNotes(e.target.value)}
                onBlur={() => void saveOfficeNotes()}
              />
              <span className="text-[10px] text-muted-foreground mt-1 block">Salva automaticamente sem apagar área, valor ou partes vinculadas.</span>
            </div>

            <div className="pt-3 border-t border-border">
              <Label className="text-xs text-muted-foreground">Partes vinculadas</Label>
              <PartiesEditor client={client} onSave={(txt) => onSaveNotes(client.id, txt)} />
              <span className="text-[10px] text-muted-foreground mt-1 block">Liste nomes de partes separadas por vírgula. Salva no campo de notas como JSON.</span>
            </div>
          </TabsContent>

          {/* TAB 3: Triagem IA */}
          <TabsContent value="ia" className="flex-1 p-4 overflow-y-auto space-y-4">
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                <h4 className="text-sm font-bold text-foreground">IA Jurídica de Triagem</h4>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Utilize o motor de IA para realizar o enquadramento jurídico inicial, calcular a probabilidade de vitória e gerar sugestões de honorários.
              </p>

              <Button
                size="sm"
                onClick={handleRunAiAnalysis}
                disabled={aiAnalyzing}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5"
              >
                {aiAnalyzing ? (
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

            {aiAnalysis && (
              <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-2 whitespace-pre-wrap font-sans text-foreground leading-relaxed shadow-xs">
                {aiAnalysis}
              </div>
            )}
          </TabsContent>

          {/* TAB: Documents */}
          <TabsContent value="docs" className="flex-1 p-4 overflow-y-auto space-y-4">
            <div className="glass rounded-xl p-3 grid gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Documentos do cliente</p>
                  <p className="text-xs text-muted-foreground">Uploads privados no bucket <span className="font-medium">documents</span>.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={docType} onValueChange={(v) => setDocType(v)}>
                    <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['other', 'contrato', 'procuracao', 'rg', 'cpf', 'certidao'].map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploadingDoc}>{uploadingDoc ? 'Enviando...' : 'Upload'}</Button>
                </div>
              </div>
              <Input placeholder="Descrição opcional" value={docDescription} onChange={(e) => setDocDescription(e.target.value)} />
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadClientDocument(f); e.currentTarget.value = ''; }} />
            </div>

            {docsLoading ? (
              <div className="text-sm text-muted-foreground">Carregando documentos...</div>
            ) : clientDocs.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nenhum documento cadastrado.</div>
            ) : (
              <div className="space-y-2">
                {clientDocs.map(d => (
                  <div key={d.id} className="glass rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm truncate">{d.file_name}</p>
                      <p className="text-xs text-muted-foreground">{d.document_type} • {new Date(d.created_at).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="icon" variant="outline" onClick={() => downloadDoc(d.file_path)}><ArrowUpRight className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 4: Prazos & SLA */}
          <TabsContent value="tarefas" className="flex-1 p-4 overflow-y-auto space-y-3">
            <div className="rounded-xl border border-border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-amber-500" /> SLA na Etapa Atual
                </span>
                <Badge variant="outline" className="text-[10px]">Alerta em 48h</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Cadastrado em: {new Date(client.created_at).toLocaleDateString("pt-BR")}
              </p>
              <p className="text-xs text-muted-foreground">
                Última movimentação: {new Date(client.updated_at).toLocaleDateString("pt-BR")}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-3 space-y-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Próximos Passos Sugeridos
              </span>
              <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
                <li>Realizar ligação de confirmação da reunião de consulta.</li>
                <li>Enviar contrato de prestação de serviços advocatícios via WhatsApp.</li>
                <li>Solicitar documentos comprobatórios para elaboração da petição inicial.</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function PartiesEditor({ client, onSave }: { client: ClientCardData; onSave: (notesJson: string) => void }) {
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    try {
      const m = client.notes ? JSON.parse(client.notes) : {};
      const parties = Array.isArray(m.parties) ? m.parties.map((p: any) => p.name).join(", ") : "";
      setText(parties);
    } catch {
      setText("");
    }
  }, [client.notes]);

  const handleBlur = () => {
    try {
      const m = client.notes ? JSON.parse(client.notes) : {};
      const arr = text.split(",").map(s => ({ name: s.trim() })).filter((p) => p.name);
      m.parties = arr;
      onSave(JSON.stringify(m));
    } catch {
      onSave(JSON.stringify({ parties: text.split(",").map(s => ({ name: s.trim() })).filter(p => p.name) }));
    }
  };

  return (
    <div className="mt-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={handleBlur} rows={2} placeholder="Nome1, Nome2, Empresa X" />
    </div>
  );
}
