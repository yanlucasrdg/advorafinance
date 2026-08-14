import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MessageSquare, Send, Search, Archive, UserPlus, Tag, Phone, Instagram,
  Facebook, CheckCheck, Circle, Filter, Sparkles, Inbox, Clock, X, Loader2,
  AlertCircle, PanelRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useMetricsComunicacoes } from "@/hooks/use-metrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import { metaWhatsAppSendText } from "@/lib/meta-whatsapp.functions";
import { CrmQueuesBar, type LegalQueueId } from "@/components/crm/crm-queues-bar";


export const Route = createFileRoute("/_authenticated/comunicacoes")({
  component: Comunicacoes,
});

type Channel = "whatsapp" | "instagram" | "messenger";
type AssignmentStatus = "new" | "assigned" | "archived";
type InboxTab = "new" | "mine" | "other";
type ServiceQueue = "triagem" | "juridico" | "financeiro" | "secretaria";

type Conversation = {
  id: string;
  tenant_id: string;
  instance_id: string | null;
  client_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number | null;
  channel: Channel | null;
  assigned_to: string | null;
  assignment_status: AssignmentStatus | null;
  category: ServiceQueue | null;
  tags: string[] | null;
  archived_at: string | null;
  created_at: string;
};

type Message = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  created_at: string;
  status: string | null;
};

const CHANNEL_META: Record<Channel, { label: string; icon: typeof MessageSquare; color: string; bg: string }> = {
  whatsapp:  { label: "WhatsApp",  icon: Phone,     color: "text-emerald-300", bg: "bg-emerald-500/15" },
  instagram: { label: "Instagram", icon: Instagram, color: "text-fuchsia-300", bg: "bg-fuchsia-500/15" },
  messenger: { label: "Messenger", icon: Facebook,  color: "text-blue-300",    bg: "bg-blue-500/15" },
};

const STATUS_META: Record<AssignmentStatus, { label: string; color: string; dot: string }> = {
  new:      { label: "Nova",      color: "text-amber-300",   dot: "bg-amber-400"   },
  assigned: { label: "Atribuída", color: "text-emerald-300", dot: "bg-emerald-400" },
  archived: { label: "Arquivada", color: "text-muted-foreground", dot: "bg-muted-foreground/60" },
};

const QUICK_TAGS = ["Urgente", "Suporte", "Comercial", "Pós-venda", "Cobrança"];

const QUEUE_META: Record<ServiceQueue, { label: string; dot: string; text: string }> = {
  triagem: { label: "Triagem", dot: "bg-violet-400", text: "text-violet-300" },
  juridico: { label: "Jurídico", dot: "bg-blue-400", text: "text-blue-300" },
  financeiro: { label: "Financeiro", dot: "bg-emerald-400", text: "text-emerald-300" },
  secretaria: { label: "Secretaria", dot: "bg-amber-400", text: "text-amber-300" },
};

const LEGACY_QUEUE_TAGS: Record<ServiceQueue, string[]> = {
  triagem: ["Triagem"],
  juridico: ["Jurídico", "Juridico"],
  financeiro: ["Financeiro", "Cobrança"],
  secretaria: ["Secretaria", "Prazos"],
};

function getConversationQueue(conversation: Pick<Conversation, "category" | "tags">): ServiceQueue {
  if (conversation.category && conversation.category in QUEUE_META) return conversation.category;
  for (const queue of Object.keys(LEGACY_QUEUE_TAGS) as ServiceQueue[]) {
    if ((conversation.tags ?? []).some((tag) => LEGACY_QUEUE_TAGS[queue].includes(tag))) return queue;
  }
  return "triagem";
}

function visibleTags(conversation: Pick<Conversation, "tags">) {
  const queueTags = new Set(Object.values(LEGACY_QUEUE_TAGS).flat());
  return (conversation.tags ?? []).filter((tag) => !queueTags.has(tag));
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function initials(name: string | null, phone: string | null): string {
  const src = (name || phone || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function formatContactPhone(phone: string | null): string {
  if (!phone) return "Telefone não informado";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return phone;
}

function Comunicacoes() {
  const { profile, user } = useAuth();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showContactPanel, setShowContactPanel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [channelFilter, setChannelFilter] = useState<"all" | Channel>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AssignmentStatus>("all");
  const [assignedFilter, setAssignedFilter] = useState<"all" | "me" | "unassigned">("all");
  const [inboxTab, setInboxTab] = useState<InboxTab>("new");
  const [quickPhone, setQuickPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [queueUpdating, setQueueUpdating] = useState(false);
  const [draft, setDraft] = useState("");
  const [newTag, setNewTag] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const [newContact, setNewContact] = useState<{ name: string; phone: string; channel: Channel | null; message: string }>({ name: "", phone: "", channel: null, message: "" });
  const [newErrors, setNewErrors] = useState<{ name?: string; phone?: string; channel?: string; submit?: string }>({});
  const [creating, setCreating] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | null>(null);
  const sendLockRef = useRef(false);
  const sendMetaWhatsApp = useServerFn(metaWhatsAppSendText);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    setConvs((data ?? []) as Conversation[]);
    if (showSpinner) setLoading(false);
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      console.error("Não foi possível carregar as mensagens:", error);
      return;
    }
    if (selectedRef.current !== conversationId) return;
    setMessages((data ?? []) as Message[]);
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
  }, []);

  useEffect(() => { if (profile?.tenant_id) void load(); }, [profile?.tenant_id, load]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    void loadMessages(selected);
  }, [selected, loadMessages]);

  useEffect(() => {
    if (!profile?.tenant_id) return;
    const channel = supabase
      .channel(`comms:${profile.tenant_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, () => {
        void load(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, (payload) => {
        void load(false);
        const row = payload.new as Partial<Message>;
        if (selected && row.conversation_id === selected) void loadMessages(selected);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile?.tenant_id, selected, load, loadMessages]);

  useEffect(() => {
    if (!profile?.tenant_id) return;
    const timer = window.setInterval(() => {
      void load(false);
      if (selected) void loadMessages(selected);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [profile?.tenant_id, selected, load, loadMessages]);

  const [selectedQueue, setSelectedQueue] = useState<LegalQueueId>("todas");

  const queueCounts = useMemo(() => {
    const counts: Record<string, number> = {
      triagem: 0,
      juridico: 0,
      financeiro: 0,
      secretaria: 0,
    };
    convs.forEach((c) => {
      if (c.assignment_status === "archived") return;
      counts[getConversationQueue(c)] += 1;
    });
    return counts;
  }, [convs]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return convs.filter((c) => {
      if (channelFilter !== "all" && c.channel !== channelFilter) return false;
      if (statusFilter !== "all" && c.assignment_status !== statusFilter) return false;
      if (assignedFilter === "me" && c.assigned_to !== user?.id) return false;
      if (assignedFilter === "unassigned" && c.assigned_to) return false;

      if (selectedQueue !== "todas") {
        if (getConversationQueue(c) !== selectedQueue) return false;
      }

      if (term) {
        const hay = `${c.contact_name ?? ""} ${c.contact_phone ?? ""} ${c.last_message ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [convs, q, channelFilter, statusFilter, assignedFilter, selectedQueue, user?.id]);

  const { data: metrics } = useMetricsComunicacoes();
  const kpis = {
    total: metrics?.total ?? 0,
    novas: metrics?.novas ?? 0,
    minhas: metrics?.minhas ?? 0,
    naoLidas: metrics?.nao_lidas ?? 0,
  };




  const current = useMemo(() => convs.find(c => c.id === selected) || null, [convs, selected]);
  const displayMessages = useMemo(() => {
    const pending = selected
      ? pendingMessages.filter((message) => message.conversation_id === selected)
      : [];
    return [...messages, ...pending].sort((a, b) => (
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ));
  }, [messages, pendingMessages, selected]);

  const assignToMe = async (id: string) => {
    if (!user?.id) return;
    const { error } = await supabase.from("whatsapp_conversations")
      .update({ assigned_to: user.id, assignment_status: "assigned" as AssignmentStatus }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Conversa atribuída a você");
    load();
  };

  const archive = async (id: string) => {
    const { error } = await supabase.from("whatsapp_conversations")
      .update({ assignment_status: "archived" as AssignmentStatus, archived_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Conversa arquivada");
    if (selected === id) setSelected(null);
    load();
  };

  const inboxCounts = useMemo(() => ({
    new: convs.filter(c => (c.assignment_status ?? "new") === "new").length,
    mine: convs.filter(c => c.assigned_to === user?.id && c.assignment_status !== "archived").length,
    other: convs.filter(c => c.assigned_to && c.assigned_to !== user?.id && c.assignment_status !== "archived").length,
  }), [convs, user?.id]);

  const inboxConversations = useMemo(() => filtered.filter((conversation) => {
    // Arquivadas é um filtro transversal: não pertence às abas de trabalho
    // ativo (Novos, Meus e Outros), mas precisa continuar acessível.
    if (statusFilter === "archived") return conversation.assignment_status === "archived";
    if (inboxTab === "new") return (conversation.assignment_status ?? "new") === "new";
    if (inboxTab === "mine") return conversation.assigned_to === user?.id && conversation.assignment_status !== "archived";
  return conversation.assigned_to !== user?.id &&
    (conversation.assignment_status ?? "new") !== "new" &&
    conversation.assignment_status !== "archived";
  }), [filtered, inboxTab, statusFilter, user?.id]);

  const reopen = async (id: string) => {
    const { error } = await supabase.from("whatsapp_conversations")
      .update({ assignment_status: "assigned" as AssignmentStatus, archived_at: null }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Atendimento reaberto");
    load();
  };

  const moveToQueue = async (id: string, queue: ServiceQueue) => {
    const previous = convs.find((conversation) => conversation.id === id)?.category ?? null;
    if (previous === queue) return;
    setQueueUpdating(true);
    setConvs((existing) => existing.map((conversation) => conversation.id === id
      ? { ...conversation, category: queue, archived_at: null }
      : conversation));
    try {
      const { error } = await supabase.from("whatsapp_conversations")
        .update({ category: queue, archived_at: null })
        .eq("id", id);
      if (error) throw error;
      toast.success(`Atendimento movido para ${QUEUE_META[queue].label}.`);
      void load(false);
    } catch (error) {
      setConvs((existing) => existing.map((conversation) => conversation.id === id
        ? { ...conversation, category: previous }
        : conversation));
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a fila.");
    } finally {
      setQueueUpdating(false);
    }
  };

  const addTag = async (id: string, tag: string) => {
    const t = tag.trim();
    if (!t) return;
    const conv = convs.find(c => c.id === id);
    const next = Array.from(new Set([...(conv?.tags ?? []), t]));
    const { error } = await supabase.from("whatsapp_conversations").update({ tags: next }).eq("id", id);
    if (error) return toast.error(error.message);
    setNewTag("");
    load();
  };

  const removeTag = async (id: string, tag: string) => {
    const conv = convs.find(c => c.id === id);
    const next = (conv?.tags ?? []).filter(x => x !== tag);
    const { error } = await supabase.from("whatsapp_conversations").update({ tags: next }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const send = async () => {
    if (sendLockRef.current || !current || !draft.trim() || !profile?.tenant_id) return;
    sendLockRef.current = true;
    setSending(true);
    const body = draft.trim();
    const conversationId = current.id;
    const phone = current.contact_phone ?? "";
    const channel = current.channel;
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimisticCreatedAt = new Date().toISOString();
    setPendingMessages((existing) => [...existing, {
      id: optimisticId,
      conversation_id: conversationId,
      direction: "outbound",
      body,
      created_at: optimisticCreatedAt,
      status: "sending",
    }]);
    setConvs((existing) => existing.map((conversation) => conversation.id === conversationId
      ? { ...conversation, last_message: body, last_message_at: optimisticCreatedAt }
      : conversation));
    setDraft("");
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 50);
    try {
      if (channel !== "whatsapp") throw new Error("Este canal ainda não está conectado.");
      const result = await sendMetaWhatsApp({ data: { phone, message: body } });
      const persistedMessage = result.message as Message;
      if (selectedRef.current === conversationId) {
        setMessages((existing) => {
          if (existing.some((message) => message.id === persistedMessage.id)) return existing;
          return [...existing, persistedMessage].sort((a, b) => (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          ));
        });
      }
      setPendingMessages((existing) => existing.filter((message) => message.id !== optimisticId));
      void load(false);
    } catch (error) {
      setPendingMessages((existing) => existing.map((message) => message.id === optimisticId
        ? { ...message, status: "failed" }
        : message));
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar a mensagem.");
    } finally {
      sendLockRef.current = false;
      setSending(false);
    }
  };

  const validateNewContact = () => {
    const errs: typeof newErrors = {};
    if (!newContact.name.trim()) errs.name = "Informe o nome do contato.";
    if (!newContact.channel) errs.channel = "Selecione um canal.";
    const raw = newContact.phone.trim();
    if (!raw) errs.phone = "Informe o telefone ou ID.";
    else if (newContact.channel === "whatsapp") {
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) errs.phone = "Telefone inválido. Use DDI+DDD+número (ex: +5511999999999).";
    } else if (newContact.channel === "instagram" || newContact.channel === "messenger") {
      const ok = /^@?[a-zA-Z0-9._]{3,}$/.test(raw) || /^\d{3,}$/.test(raw);
      if (!ok) errs.phone = "Use @usuario ou ID numérico.";
    }
    return errs;
  };

  const closeNewModal = (force = false) => {
    const dirty = newContact.name || newContact.phone || newContact.message || newContact.channel;
    if (!force && dirty) { setConfirmClose(true); return; }
    setOpenNew(false);
    setConfirmClose(false);
    setNewContact({ name: "", phone: "", channel: null, message: "" });
    setNewErrors({});
  };

  const createConversation = async () => {
    setNewErrors({});
    if (!profile?.tenant_id) return;
    const errs = validateNewContact();
    if (Object.keys(errs).length > 0) { setNewErrors(errs); return; }
    setCreating(true);
    try {
      const channel = newContact.channel!;
      const identifier = channel === "whatsapp"
        ? "+" + newContact.phone.replace(/\D/g, "")
        : newContact.phone.trim().replace(/^@/, "");
      let clientId: string | null = null;

      if (channel !== "whatsapp") {
        setNewErrors({ submit: "Este canal ainda não está conectado. Use WhatsApp ou configure a integração antes de iniciar uma conversa." });
        return;
      }

      const { data: activeInstance, error: instanceError } = await supabase
        .from("whatsapp_instances")
        .select("id")
        .eq("tenant_id", profile.tenant_id)
        .eq("status", "connected")
        .order("last_connected_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (instanceError) throw new Error(instanceError.message);
      if (!activeInstance?.id) {
        setNewErrors({ submit: "Conecte o WhatsApp Business deste escritório em Integrações antes de iniciar uma conversa." });
        return;
      }

      // Dedupe check: existing conversation with same channel + identifier
      const { data: existing } = await supabase
        .from("whatsapp_conversations")
        .select("id")
        .eq("channel", channel)
        .eq("contact_phone", identifier)
        .maybeSingle();
      if (existing?.id) {
        const ok = window.confirm("Este contato já existe. Deseja abrir a conversa existente?");
        if (ok) { setSelected(existing.id); closeNewModal(true); }
        setCreating(false);
        return;
      }

      // Also link/create a client record by phone (WhatsApp only)
      if (channel === "whatsapp") {
        const { data: cli } = await supabase.from("clients").select("id").eq("phone", identifier).maybeSingle();
        if (cli) {
          clientId = cli.id;
        } else {
          const { data: createdClient, error: clientError } = await supabase.from("clients").insert({
            tenant_id: profile.tenant_id,
            name: newContact.name.trim(),
            phone: identifier,
            type: "pf",
            status: "novo_contato",
            created_by: user?.id ?? null,
          } as never).select("id").single();
          if (clientError) throw new Error(clientError.message);
          clientId = createdClient?.id ?? null;
        }
      }

      const { data, error } = await supabase.from("whatsapp_conversations").insert({
        tenant_id: profile.tenant_id,
        instance_id: activeInstance.id,
        contact_name: newContact.name.trim(),
        contact_phone: identifier,
        client_id: clientId,
        channel,
        assigned_to: null,
        assignment_status: "new" as AssignmentStatus,
        category: "triagem" as ServiceQueue,
        tags: ["Triagem"],
        last_message: newContact.message.trim() || null,
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      } as never).select().single();
      if (error) throw new Error(error.message);

      // Primeiro atendimento: uma pendência de SLA é criada junto com o lead.
      // Isso dá visibilidade na Agenda sem precisar depender de memória ou planilhas.
      if (clientId) {
        const { error: followupError } = await supabase.rpc("create_intake_followup", {
          p_client_id: clientId,
          p_contact_name: newContact.name.trim(),
        });
        if (followupError) throw new Error(`Contato criado, mas o SLA não pôde ser registrado: ${followupError.message}`);
      }

      if (newContact.message.trim() && data) {
        try {
          await sendMetaWhatsApp({ data: { phone: identifier.replace(/\D/g, ""), message: newContact.message.trim() } });
        } catch (e) {
          setNewErrors({ submit: `Não foi possível enviar via WhatsApp. ${e instanceof Error ? e.message : "Verifique a integração."}` });
          setCreating(false);
          return;
        }
      }

      toast.success("Conversa criada e enviada para Triagem", { description: "Uma pendência de primeira resposta foi criada para os próximos 15 minutos." });
      if (data?.id) setSelected(data.id);
      closeNewModal(true);
      load();
    } catch (e) {
      setNewErrors({ submit: e instanceof Error ? e.message : "Erro ao criar conversa." });
    } finally {
      setCreating(false);
    }
  };


  return (
    <div className="relative flex h-[calc(100vh-72px)] flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      {/* Header */}
      <div className="shrink-0 px-6 lg:px-8 pt-6 pb-4 animate-fade-up">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-medium mb-1.5">Módulo · Atendimento</p>
            <h1 className="text-3xl font-bold tracking-tight">Central de Atendimento</h1>
            <p className="text-sm text-muted-foreground mt-1.5 mb-3">Omnichannel — WhatsApp, Instagram e Messenger em um só lugar.</p>
          </div>

          <div className="flex items-center gap-2">
            <Dialog open={openNew} onOpenChange={(o) => { if (!o) closeNewModal(); else setOpenNew(true); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-9 bg-[image:var(--gradient-brand)]" onClick={() => setOpenNew(true)}>
                  <MessageSquare className="size-3.5 mr-1.5" /> Nova conversa
                </Button>
              </DialogTrigger>
              <DialogContent className="glass" onEscapeKeyDown={(e) => { e.preventDefault(); closeNewModal(); }} onPointerDownOutside={(e) => { e.preventDefault(); closeNewModal(); }}>
                <DialogHeader><DialogTitle>Iniciar nova conversa</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <div>
                    <Label>Nome do contato</Label>
                    <Input value={newContact.name} onChange={e => setNewContact(v => ({ ...v, name: e.target.value }))} className={newErrors.name ? "border-destructive" : ""} />
                    {newErrors.name && <p className="text-[11px] text-destructive mt-1">{newErrors.name}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{newContact.channel === "whatsapp" ? "Telefone" : "Telefone / ID"}</Label>
                      <Input
                        value={newContact.phone}
                        onChange={e => setNewContact(v => ({ ...v, phone: e.target.value }))}
                        placeholder={newContact.channel === "whatsapp" ? "+55 11 99999-9999" : newContact.channel ? "@usuario ou ID" : ""}
                        className={newErrors.phone ? "border-destructive" : ""}
                      />
                      {newErrors.phone && <p className="text-[11px] text-destructive mt-1">{newErrors.phone}</p>}
                    </div>
                    <div>
                      <Label>Canal</Label>
                      <div className="flex gap-1 mt-1">
                        {(["whatsapp", "instagram", "messenger"] as Channel[]).map(ch => {
                          const M = CHANNEL_META[ch];
                          const active = newContact.channel === ch;
                          return (
                            <button key={ch} type="button" onClick={() => setNewContact(v => ({ ...v, channel: ch }))}
                              className={`flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-2 rounded-md text-xs font-medium transition-all ${active ? `${M.bg} ${M.color} ring-1 ring-current/30` : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"}`}>
                              <M.icon className="size-3.5" />{M.label}
                            </button>
                          );
                        })}
                      </div>
                      {newErrors.channel && <p className="text-[11px] text-destructive mt-1">{newErrors.channel}</p>}
                    </div>
                  </div>
                  <div>
                    <Label>Mensagem inicial (opcional)</Label>
                    <Textarea rows={3} value={newContact.message} onChange={e => setNewContact(v => ({ ...v, message: e.target.value }))} />
                  </div>
                  {newErrors.submit && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                      <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                      <span>{newErrors.submit}</span>
                    </div>
                  )}
                  <Button onClick={createConversation} disabled={creating} className="mt-1 bg-[image:var(--gradient-brand)]">
                    {creating ? <><Loader2 className="size-4 mr-2 animate-spin" />Criando…</> : "Criar conversa"}
                  </Button>
                  {confirmClose && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500 flex items-center justify-between gap-2">
                      <span>Descartar nova conversa?</span>
                      <div className="flex gap-1">
                        <button className="h-7 px-2 rounded-md hover:bg-amber-500/20" onClick={() => setConfirmClose(false)}>Voltar</button>
                        <button className="h-7 px-2 rounded-md bg-amber-500 text-white" onClick={() => closeNewModal(true)}>Descartar</button>
                      </div>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Legal Service Queues Bar */}
        <div className="mt-3">
          <CrmQueuesBar
            selectedQueue={selectedQueue}
            onSelectQueue={setSelectedQueue}
            queueCounts={queueCounts}
          />
        </div>

        {/* KPIs */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: Inbox,     label: "Total",       value: kpis.total,    color: "text-violet-300",  bg: "bg-violet-500/10" },
            { icon: Sparkles,  label: "Novas",       value: kpis.novas,    color: "text-amber-300",   bg: "bg-amber-500/10" },
            { icon: UserPlus,  label: "Minhas",      value: kpis.minhas,   color: "text-emerald-300", bg: "bg-emerald-500/10" },
            { icon: Circle,    label: "Não lidas",   value: kpis.naoLidas, color: "text-rose-300",    bg: "bg-rose-500/10" },
          ].map((k, i) => (
            <div key={i} className="glass rounded-xl p-3 flex items-center gap-3 hover-lift">
              <div className={`grid place-items-center size-9 rounded-lg ${k.bg}`}><k.icon className={`size-4 ${k.color}`} /></div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
                <div className="text-lg font-semibold tabular-nums">{k.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Split view */}
      <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-4 px-6 pb-6 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:px-8 2xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)_minmax(260px,320px)]">
        {/* ---------- Column 1: Conversations list ---------- */}
        <aside className="glass rounded-2xl flex flex-col min-h-0 overflow-hidden animate-fade-up">
          <div className="grid grid-cols-3 gap-1 border-b border-border/40 p-2">
            {([
              ["new", "Novos", inboxCounts.new],
              ["mine", "Meus", inboxCounts.mine],
              ["other", "Outros", inboxCounts.other],
            ] as const).map(([tab, label, count]) => (
              <button key={tab} onClick={() => setInboxTab(tab)} className={`flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${inboxTab === tab ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-white/[0.04]"}`}>
                {label}<span className={`grid size-5 place-items-center rounded-full text-[10px] font-bold ${inboxTab === tab ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{count}</span>
              </button>
            ))}
          </div>
          <div className="p-3 border-b border-border/40 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar conversas..." className="h-9 pl-8 text-sm bg-white/[0.02]" />
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setChannelFilter("all")} className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium transition-all ${channelFilter === "all" ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-white/[0.04]"}`}>Todos</button>
              {(["whatsapp", "instagram", "messenger"] as Channel[]).map(ch => {
                const M = CHANNEL_META[ch];
                const active = channelFilter === ch;
                return (
                  <button key={ch} onClick={() => setChannelFilter(ch)} className={`inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium transition-all ${active ? `${M.bg} ${M.color}` : "text-muted-foreground hover:bg-white/[0.04]"}`}>
                    <M.icon className="size-3" />
                  </button>
                );
              })}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-white/[0.04]">
                    <Filter className="size-3" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-52 glass p-3 space-y-3 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Status</div>
                    <div className="grid grid-cols-2 gap-1">
                      {(["all", "new", "assigned", "archived"] as const).map(s => (
                        <button key={s} onClick={() => setStatusFilter(s)} className={`h-7 px-2 rounded-md text-[11px] font-medium ${statusFilter === s ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-white/[0.04]"}`}>
                          {s === "all" ? "Todas" : STATUS_META[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Atribuição</div>
                    <div className="grid grid-cols-3 gap-1">
                      {(["all", "me", "unassigned"] as const).map(a => (
                        <button key={a} onClick={() => setAssignedFilter(a)} className={`h-7 px-2 rounded-md text-[11px] font-medium ${assignedFilter === a ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-white/[0.04]"}`}>
                          {a === "all" ? "Todas" : a === "me" ? "Minhas" : "Sem"}
                        </button>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 grid place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
            ) : inboxConversations.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada.</div>
            ) : (
              inboxConversations.map((c) => {
                const M = c.channel ? CHANNEL_META[c.channel] : CHANNEL_META.whatsapp;
                const active = c.id === selected;
                const st = c.assignment_status ?? "new";
                return (
                  <button key={c.id} onClick={() => setSelected(c.id)}
                    className={`w-full text-left px-3 py-3 flex items-start gap-3 border-b border-border/30 transition-colors row-hover ${active ? "bg-white/[0.05]" : ""}`}>
                    <div className="relative shrink-0">
                      <div className={`grid place-items-center size-10 rounded-full ${M.bg} ${M.color} text-xs font-semibold ring-1 ring-white/10`}>
                        {initials(c.contact_name, c.contact_phone)}
                      </div>
                      <div className={`absolute -bottom-0.5 -right-0.5 grid place-items-center size-4 rounded-full ${M.bg} ring-2 ring-background`}>
                        <M.icon className={`size-2.5 ${M.color}`} />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium truncate">{c.contact_name || c.contact_phone || "Sem nome"}</div>
                        <div className="ml-auto text-[10px] text-muted-foreground shrink-0">{timeAgo(c.last_message_at)}</div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] ${STATUS_META[st].color}`}>
                          <span className={`size-1.5 rounded-full ${STATUS_META[st].dot}`} />{STATUS_META[st].label}
                        </span>
                        {(c.unread_count ?? 0) > 0 && (
                          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-1">{c.last_message || "—"}</div>
                      {visibleTags(c).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {visibleTags(c).slice(0, 3).map(t => (
                            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-muted-foreground">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-border/40 p-3">
            <div className="flex gap-2">
              <Input value={quickPhone} onChange={event => setQuickPhone(event.target.value)} placeholder="Telefone para nova conversa" className="h-9 bg-white/[0.02] text-xs" />
              <Button size="sm" className="h-9 shrink-0 bg-[image:var(--gradient-brand)]" onClick={() => {
                setNewContact(current => ({ ...current, phone: quickPhone.replace(/\D/g, ""), channel: "whatsapp" }));
                setOpenNew(true);
              }}>Conversar</Button>
            </div>
          </div>
        </aside>

        {/* ---------- Column 2: Chat ---------- */}
        <section className="glass rounded-2xl flex flex-col min-h-0 overflow-hidden animate-fade-up">
          {!current ? (
            <div className="flex-1 grid place-items-center text-center px-8">
              <div>
                <div className="mx-auto grid place-items-center size-16 rounded-2xl bg-primary/10 mb-4">
                  <MessageSquare className="size-7 text-primary" />
                </div>
                <div className="text-lg font-semibold">Selecione uma conversa</div>
                <div className="text-sm text-muted-foreground mt-1">Escolha uma conversa na lista à esquerda para começar.</div>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border/40 flex items-center gap-3">
                <div className={`grid place-items-center size-10 rounded-full ${CHANNEL_META[current.channel ?? "whatsapp"].bg} ${CHANNEL_META[current.channel ?? "whatsapp"].color} text-xs font-semibold ring-1 ring-white/10`}>
                  {initials(current.contact_name, current.contact_phone)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{current.contact_name || current.contact_phone || "Sem nome"}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                    {current.contact_phone && <span>{current.contact_phone}</span>}
                    <span className="inline-flex items-center gap-1">
                      <span className={`size-1.5 rounded-full ${STATUS_META[current.assignment_status ?? "new"].dot}`} />
                      {STATUS_META[current.assignment_status ?? "new"].label}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs 2xl:hidden"
                    onClick={() => setShowContactPanel(true)}
                    aria-label="Abrir detalhes do contato"
                  >
                    <PanelRight className="size-3.5 xl:mr-1" />
                    <span className="hidden xl:inline">Detalhes</span>
                  </Button>
                  {current.assigned_to !== user?.id && (
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => assignToMe(current.id)}>
                      <UserPlus className="size-3.5 mr-1" /> Atribuir a mim
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => current.assignment_status === "archived" ? reopen(current.id) : archive(current.id)}>
                    <Archive className="size-3.5 mr-1" /> {current.assignment_status === "archived" ? "Reabrir atendimento" : "Arquivar"}
                  </Button>
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-black/10">
                {displayMessages.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-8">Nenhuma mensagem ainda.</div>
                ) : displayMessages.map(m => {
                  const out = m.direction === "outbound";
                  return (
                    <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${out ? "bg-[image:var(--gradient-brand)] text-white rounded-br-sm" : "bg-white/[0.06] rounded-bl-sm"}`}>
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${out ? "text-white/70" : "text-muted-foreground"}`}>
                          {m.status === "sending" ? (
                            <><Loader2 className="size-2.5 animate-spin" />Enviando…</>
                          ) : m.status === "failed" ? (
                            <><AlertCircle className="size-2.5" />Não enviada</>
                          ) : (
                            <><Clock className="size-2.5" />{timeAgo(m.created_at)}{out && <CheckCheck className="size-3" />}</>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 border-t border-border/40 flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Digite uma mensagem..."
                  rows={1}
                  className="min-h-[40px] max-h-32 resize-none bg-white/[0.02] text-sm"
                />
                <Button onClick={send} disabled={!draft.trim() || sending} className="h-10 bg-[image:var(--gradient-brand)]">
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>
            </>
          )}
        </section>

        {showContactPanel && (
          <button
            type="button"
            aria-label="Fechar detalhes do contato"
            className="absolute inset-0 z-20 bg-black/50 backdrop-blur-sm 2xl:hidden"
            onClick={() => setShowContactPanel(false)}
          />
        )}

        {/* ---------- Column 3: Contact panel ---------- */}
        <aside className={`glass min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-2xl animate-fade-up ${showContactPanel ? "absolute inset-y-0 right-4 z-30 flex w-[min(360px,calc(100%-2rem))] 2xl:static 2xl:w-auto" : "hidden 2xl:flex"}`}>
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-background/35 px-4">
            <div>
              <div className="text-sm font-semibold text-foreground">Detalhes do contato</div>
              <div className="text-[10px] text-muted-foreground">Perfil e organização do atendimento</div>
            </div>
            <button
              type="button"
              onClick={() => setShowContactPanel(false)}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground 2xl:hidden"
              aria-label="Fechar detalhes"
            >
              <X className="size-4" />
            </button>
          </div>
          {!current ? (
            <div className="flex-1 grid place-items-center text-center px-6 text-xs text-muted-foreground">
              Nenhuma conversa aberta.
            </div>
          ) : (
            <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
              <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/15 via-background/45 to-emerald-500/[0.06] p-4 text-center shadow-sm">
                <div aria-hidden className="absolute -right-10 -top-10 size-28 rounded-full bg-primary/10 blur-2xl" />
                <div className="relative mx-auto w-fit">
                  <div className={`grid size-18 place-items-center rounded-full ${CHANNEL_META[current.channel ?? "whatsapp"].bg} ${CHANNEL_META[current.channel ?? "whatsapp"].color} text-xl font-bold ring-4 ring-background/70 shadow-lg`}>
                    {initials(current.contact_name, current.contact_phone)}
                  </div>
                  <div className={`absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full border-2 border-card ${CHANNEL_META[current.channel ?? "whatsapp"].bg} ${CHANNEL_META[current.channel ?? "whatsapp"].color}`}>
                    {(() => { const I = CHANNEL_META[current.channel ?? "whatsapp"].icon; return <I className="size-3.5" />; })()}
                  </div>
                </div>
                <div className="relative mt-3 text-base font-semibold text-foreground">{current.contact_name || "Contato sem nome"}</div>
                <div className="relative mt-0.5 font-mono text-[11px] text-muted-foreground">{formatContactPhone(current.contact_phone)}</div>
                <div className={`relative mx-auto mt-3 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${CHANNEL_META[current.channel ?? "whatsapp"].bg} ${CHANNEL_META[current.channel ?? "whatsapp"].color}`}>
                  <span className={`size-1.5 rounded-full ${(current.channel ?? "whatsapp") === "whatsapp" ? "bg-emerald-400" : "bg-current"}`} />
                  {CHANNEL_META[current.channel ?? "whatsapp"].label} conectado
                </div>
              </section>

              <section className="space-y-3.5 rounded-2xl border border-border/60 bg-background/30 p-3.5">
                <div className="flex items-center gap-2">
                  <div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Inbox className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-foreground">Atendimento</div>
                    <div className="text-[10px] text-muted-foreground">Canal e roteamento da conversa</div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`contact-queue-${current.id}`} className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Fila de atendimento
                  </Label>
                  <Select
                    value={getConversationQueue(current)}
                    onValueChange={(value) => void moveToQueue(current.id, value as ServiceQueue)}
                    disabled={queueUpdating}
                  >
                    <SelectTrigger
                      id={`contact-queue-${current.id}`}
                      aria-label="Fila de atendimento"
                      className="h-10 rounded-xl border-border/70 bg-background/70 px-3 text-sm text-foreground shadow-inner transition-colors hover:border-primary/50 focus:ring-2 focus:ring-primary/30"
                    >
                      <SelectValue>
                        <span className="flex items-center gap-2">
                          <span aria-hidden className={`size-2 rounded-full ${QUEUE_META[getConversationQueue(current)].dot}`} />
                          {QUEUE_META[getConversationQueue(current)].label}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent position="popper" className="z-[70] border-border/70 bg-popover text-popover-foreground shadow-2xl">
                      {(Object.entries(QUEUE_META) as Array<[ServiceQueue, typeof QUEUE_META[ServiceQueue]]>).map(([queue, meta]) => (
                        <SelectItem key={queue} value={queue} className="h-9 cursor-pointer text-foreground focus:bg-primary/15 focus:text-foreground">
                          <span className="flex items-center gap-2">
                            <span aria-hidden className={`size-2 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-start gap-2 rounded-xl border border-border/40 bg-muted/25 px-3 py-2.5">
                  {queueUpdating ? (
                    <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
                  ) : (
                    <span className={`mt-1 size-2 shrink-0 rounded-full ${QUEUE_META[getConversationQueue(current)].dot}`} />
                  )}
                  <div>
                    <div className="text-[11px] font-medium text-foreground">
                      {queueUpdating ? "Atualizando fila…" : QUEUE_META[getConversationQueue(current)].label}
                    </div>
                    <div className="text-[10px] leading-relaxed text-muted-foreground">
                      {queueUpdating ? "Salvando a nova organização." : "As novas mensagens serão organizadas nesta fila."}
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border border-border/60 bg-background/30 p-3.5">
                <div className="flex items-center gap-2">
                  <div className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-300">
                    <Tag className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-foreground">Tags</div>
                    <div className="text-[10px] text-muted-foreground">Identifique o assunto rapidamente</div>
                  </div>
                </div>
                {visibleTags(current).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {visibleTags(current).map(t => (
                      <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-foreground">
                        {t}
                        <button type="button" aria-label={`Remover tag ${t}`} onClick={() => removeTag(current.id, t)} className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"><X className="size-2.5" /></button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border/60 px-3 py-2 text-center text-[10px] text-muted-foreground">Nenhuma tag adicionada</div>
                )}
                <div className="flex gap-1.5">
                  <Input value={newTag} onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(current.id, newTag); } }}
                    placeholder="Adicionar tag" className="h-9 rounded-xl bg-background/60 text-xs" />
                  <Button type="button" size="sm" variant="outline" aria-label="Adicionar tag" className="size-9 shrink-0 rounded-xl p-0 text-base" onClick={() => addTag(current.id, newTag)}>+</Button>
                </div>
                <div>
                  <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sugestões</div>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_TAGS.filter(t => !visibleTags(current).includes(t)).map(t => (
                      <button type="button" key={t} onClick={() => addTag(current.id, t)} className="rounded-full border border-dashed border-border/70 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-foreground">
                        + {t}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border border-border/60 bg-background/30 p-3.5">
                <div className="flex items-center gap-2">
                  <div className="grid size-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                    <UserPlus className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-foreground">Responsável</div>
                    <div className="text-[10px] text-muted-foreground">Pessoa atendendo esta conversa</div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-xl bg-muted/25 px-3 py-2.5">
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-[11px] font-bold text-foreground ring-1 ring-border/70">
                    {current.assigned_to === user?.id ? "EU" : current.assigned_to ? "EQ" : "—"}
                  </div>
                  <div className="min-w-0">
                    {current.assigned_to === user?.id ? (
                      <><div className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">Você</div><div className="text-[10px] text-muted-foreground">Atendimento assumido</div></>
                    ) : current.assigned_to ? (
                      <><div className="text-xs font-semibold text-foreground">Outro membro</div><div className="text-[10px] text-muted-foreground">Atribuído à equipe</div></>
                    ) : (
                      <><div className="text-xs font-semibold text-amber-600 dark:text-amber-300">Nenhum responsável</div><div className="text-[10px] text-muted-foreground">Disponível para assumir</div></>
                    )}
                  </div>
                </div>
                {current.assigned_to !== user?.id && (
                  <Button size="sm" variant="outline" className="h-9 w-full rounded-xl text-xs" onClick={() => assignToMe(current.id)}>
                    <UserPlus className="mr-1.5 size-3.5" /> Assumir conversa
                  </Button>
                )}
              </section>

              <div className="flex items-center gap-2 px-1 pb-1 pt-0.5 text-[10px] text-muted-foreground">
                <Clock className="size-3.5" />
                <span>Conversa iniciada em</span>
                <time dateTime={current.created_at} className="font-medium text-foreground">{new Date(current.created_at).toLocaleString("pt-BR")}</time>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
