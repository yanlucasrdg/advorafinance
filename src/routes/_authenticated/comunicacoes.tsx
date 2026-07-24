import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MessageSquare, Send, Search, Archive, UserPlus, Tag, Phone, Instagram,
  Facebook, CheckCheck, Circle, Filter, Sparkles, Inbox, Clock, X, Loader2,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeTables } from "@/hooks/use-realtime-table";
import { useMetricsComunicacoes } from "@/hooks/use-metrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

type Conversation = {
  id: string;
  tenant_id: string;
  instance_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number | null;
  channel: Channel | null;
  assigned_to: string | null;
  assignment_status: AssignmentStatus | null;
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

const QUICK_TAGS = ["Urgente", "Triagem", "Suporte", "Comercial", "Pós-venda", "Cobrança"];

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

function Comunicacoes() {
  const { profile, user } = useAuth();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [channelFilter, setChannelFilter] = useState<"all" | Channel>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AssignmentStatus>("all");
  const [assignedFilter, setAssignedFilter] = useState<"all" | "me" | "unassigned">("all");
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [newTag, setNewTag] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const [newContact, setNewContact] = useState<{ name: string; phone: string; channel: Channel | null; message: string }>({ name: "", phone: "", channel: null, message: "" });
  const [newErrors, setNewErrors] = useState<{ name?: string; phone?: string; channel?: string; submit?: string }>({});
  const [creating, setCreating] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendMetaWhatsApp = useServerFn(metaWhatsAppSendText);

  useRealtimeTables(["whatsapp_conversations", "whatsapp_messages"], ["comms:convs", "comms:msgs"]);


  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    setConvs((data ?? []) as Conversation[]);
    setLoading(false);
  };
  useEffect(() => { if (profile?.tenant_id) load(); }, [profile?.tenant_id]);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    (async () => {
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("conversation_id", selected)
        .order("created_at", { ascending: true })
        .limit(200);
      setMessages((data ?? []) as Message[]);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
    })();
    // subscribe just for this conversation's messages
    const ch = supabase.channel(`conv:${selected}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: "whatsapp_messages", filter: `conversation_id=eq.${selected}` },
      (payload) => {
        const row = payload.new as Message;
        setMessages((m) => (m.some(x => x.id === row.id) ? m.map(x => x.id === row.id ? row : x) : [...m, row]));
        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current!.scrollHeight, behavior: "smooth" }), 50);
      },
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selected]);

  const [selectedQueue, setSelectedQueue] = useState<LegalQueueId>("todas");

  const queueCounts = useMemo(() => {
    const counts: Record<string, number> = {
      triagem: 0,
      juridico: 0,
      financeiro: 0,
      secretaria: 0,
    };
    convs.forEach((c) => {
      const tags = c.tags || [];
      if (tags.includes("Financeiro") || tags.includes("Cobrança")) {
        counts.financeiro += 1;
      } else if (tags.includes("Secretaria") || tags.includes("Prazos")) {
        counts.secretaria += 1;
      } else if (tags.includes("Jurídico") || c.assignment_status === "assigned") {
        counts.juridico += 1;
      } else {
        counts.triagem += 1;
      }
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
        const tags = c.tags || [];
        if (selectedQueue === "financeiro" && !(tags.includes("Financeiro") || tags.includes("Cobrança"))) return false;
        if (selectedQueue === "secretaria" && !(tags.includes("Secretaria") || tags.includes("Prazos"))) return false;
        if (selectedQueue === "juridico" && !(tags.includes("Jurídico") || c.assignment_status === "assigned")) return false;
        if (selectedQueue === "triagem" && (tags.includes("Financeiro") || tags.includes("Secretaria") || tags.includes("Jurídico"))) return false;
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
    if (!current || !draft.trim() || !profile?.tenant_id) return;
    setSending(true);
    const body = draft.trim();
    try {
      if (current.channel !== "whatsapp") throw new Error("Este canal ainda não está conectado.");
      await sendMetaWhatsApp({ data: { phone: current.contact_phone ?? "", message: body } });
      setDraft("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar a mensagem.");
    } finally {
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
        if (!cli) {
          await supabase.from("clients").insert({
            tenant_id: profile.tenant_id,
            name: newContact.name.trim(),
            phone: identifier,
            type: "pf",
            status: "novo_contato",
            created_by: user?.id ?? null,
          } as never);
        }
      }

      const { data, error } = await supabase.from("whatsapp_conversations").insert({
        tenant_id: profile.tenant_id,
        instance_id: null as unknown as string,
        contact_name: newContact.name.trim(),
        contact_phone: identifier,
        channel,
        assigned_to: user?.id ?? null,
        assignment_status: "assigned" as AssignmentStatus,
        last_message: newContact.message.trim() || null,
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      } as never).select().single();
      if (error) throw new Error(error.message);

      if (newContact.message.trim() && data) {
        if (channel === "instagram" || channel === "messenger") {
          setNewErrors({ submit: `Não foi possível enviar via ${channel === "instagram" ? "Instagram" : "Messenger"}. Verifique a integração.` });
          setCreating(false);
          return;
        }
        // WhatsApp: send via Z-API
        try {
          await sendMetaWhatsApp({ data: { phone: identifier.replace(/\D/g, ""), message: newContact.message.trim() } });
          await supabase.from("whatsapp_messages").insert({
            conversation_id: data.id,
            tenant_id: profile.tenant_id,
            direction: "outbound",
            body: newContact.message.trim(),
            status: "sent",
          } as never);
        } catch (e) {
          setNewErrors({ submit: `Não foi possível enviar via WhatsApp. ${e instanceof Error ? e.message : "Verifique a integração."}` });
          setCreating(false);
          return;
        }
      }

      toast.success("Conversa criada");
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
    <div className="relative h-[calc(100vh-72px)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      {/* Header */}
      <div className="px-6 lg:px-8 pt-6 pb-4 animate-fade-up">
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
      <div className="px-6 lg:px-8 pb-6 grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr_minmax(260px,320px)] gap-4 h-[calc(100%-220px)] min-h-0">
        {/* ---------- Column 1: Conversations list ---------- */}
        <aside className="glass rounded-2xl flex flex-col min-h-0 overflow-hidden animate-fade-up">
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
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada.</div>
            ) : (
              filtered.map((c) => {
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
                      {c.tags && c.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {c.tags.slice(0, 3).map(t => (
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
                  {current.assigned_to !== user?.id && (
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => assignToMe(current.id)}>
                      <UserPlus className="size-3.5 mr-1" /> Atribuir a mim
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => archive(current.id)}>
                    <Archive className="size-3.5 mr-1" /> Arquivar
                  </Button>
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-black/10">
                {messages.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-8">Nenhuma mensagem ainda.</div>
                ) : messages.map(m => {
                  const out = m.direction === "outbound";
                  return (
                    <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${out ? "bg-[image:var(--gradient-brand)] text-white rounded-br-sm" : "bg-white/[0.06] rounded-bl-sm"}`}>
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${out ? "text-white/70" : "text-muted-foreground"}`}>
                          <Clock className="size-2.5" />{timeAgo(m.created_at)}
                          {out && <CheckCheck className="size-3" />}
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

        {/* ---------- Column 3: Contact panel ---------- */}
        <aside className="glass rounded-2xl flex flex-col min-h-0 overflow-hidden animate-fade-up hidden lg:flex">
          {!current ? (
            <div className="flex-1 grid place-items-center text-center px-6 text-xs text-muted-foreground">
              Nenhuma conversa aberta.
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="text-center pt-2">
                <div className={`mx-auto grid place-items-center size-16 rounded-full ${CHANNEL_META[current.channel ?? "whatsapp"].bg} ${CHANNEL_META[current.channel ?? "whatsapp"].color} text-lg font-semibold ring-1 ring-white/10`}>
                  {initials(current.contact_name, current.contact_phone)}
                </div>
                <div className="text-base font-semibold mt-3">{current.contact_name || "Sem nome"}</div>
                {current.contact_phone && <div className="text-xs text-muted-foreground">{current.contact_phone}</div>}
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Canal</div>
                <div className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium ${CHANNEL_META[current.channel ?? "whatsapp"].bg} ${CHANNEL_META[current.channel ?? "whatsapp"].color}`}>
                  {(() => { const I = CHANNEL_META[current.channel ?? "whatsapp"].icon; return <I className="size-3.5" />; })()}
                  {CHANNEL_META[current.channel ?? "whatsapp"].label}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Tag className="size-3" /> Tags</div>
                <div className="flex flex-wrap gap-1">
                  {(current.tags ?? []).map(t => (
                    <span key={t} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06]">
                      {t}
                      <button onClick={() => removeTag(current.id, t)} className="text-muted-foreground hover:text-foreground"><X className="size-2.5" /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1">
                  <Input value={newTag} onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(current.id, newTag); } }}
                    placeholder="Nova tag" className="h-7 text-xs bg-white/[0.02]" />
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addTag(current.id, newTag)}>+</Button>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {QUICK_TAGS.filter(t => !(current.tags ?? []).includes(t)).map(t => (
                    <button key={t} onClick={() => addTag(current.id, t)} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.03] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground transition-colors">
                      + {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Atribuída a</div>
                <div className="text-xs">
                  {current.assigned_to === user?.id ? (
                    <span className="text-emerald-300">Você</span>
                  ) : current.assigned_to ? (
                    <span className="text-muted-foreground">Outro membro</span>
                  ) : (
                    <span className="text-amber-300">Nenhum responsável</span>
                  )}
                </div>
                {current.assigned_to !== user?.id && (
                  <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={() => assignToMe(current.id)}>
                    <UserPlus className="size-3 mr-1" /> Assumir conversa
                  </Button>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Criada em</div>
                <div className="text-xs">{new Date(current.created_at).toLocaleString("pt-BR")}</div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
