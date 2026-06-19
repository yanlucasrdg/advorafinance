import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, User } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { askCopilot } from "@/lib/copilot.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/copiloto")({
  head: () => ({ meta: [{ title: "Copiloto IA — Legion AI" }] }),
  component: () => <AppShell><Copiloto /></AppShell>,
});

type Msg = { id: string; role: string; content: string; created_at: string };

const SUGESTOES = [
  "Resuma o status dos meus processos ativos",
  "Liste os prazos críticos dos próximos 7 dias",
  "Sugira modelo de petição inicial de cobrança",
  "Quais clientes têm faturas vencidas?",
];

function Copiloto() {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data } = await supabase.from("ai_messages").select("*").order("created_at", { ascending: true }).limit(50);
    setMessages((data ?? []) as Msg[]);
  };
  useEffect(() => { if (profile?.tenant_id) load(); }, [profile?.tenant_id]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput(""); setBusy(true);
    try {
      const res = await askCopilot({ data: { prompt: q } });
      setMessages(m => [
        ...m,
        { id: crypto.randomUUID(), role: "user", content: q, created_at: new Date().toISOString() },
        { id: crypto.randomUUID(), role: "assistant", content: res.reply, created_at: new Date().toISOString() },
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao consultar copiloto");
    } finally { setBusy(false); }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto h-[calc(100vh-3.5rem)] flex flex-col">
      <PageHeader title="Copiloto Jurídico IA" subtitle="Pergunte sobre processos, prazos, peças e contratos." />

      <Panel className="flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="size-14 rounded-2xl bg-[image:var(--gradient-brand)] grid place-items-center shadow-[var(--shadow-glow)] mb-4">
                <Sparkles className="size-6 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold">Como posso ajudar hoje?</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">Seu copiloto conhece o contexto do seu escritório e responde com base nos seus dados.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-6 w-full max-w-2xl">
                {SUGESTOES.map(s => (
                  <button key={s} onClick={() => send(s)} className="text-left text-sm rounded-xl border border-border/60 bg-card/40 p-3 hover:glow-ring transition">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(m => (
              <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role !== "user" && <div className="size-8 shrink-0 rounded-lg bg-[image:var(--gradient-brand)] grid place-items-center"><Bot className="size-4 text-primary-foreground" /></div>}
                <div className={`rounded-2xl px-4 py-2.5 text-sm max-w-[80%] whitespace-pre-wrap ${m.role === "user" ? "bg-primary/20 border border-primary/30" : "bg-card/60 border border-border/60"}`}>
                  {m.content}
                </div>
                {m.role === "user" && <div className="size-8 shrink-0 rounded-lg bg-card grid place-items-center border border-border/60"><User className="size-4" /></div>}
              </div>
            ))
          )}
          {busy && <div className="text-xs text-muted-foreground pl-11">Copiloto pensando…</div>}
        </div>
        <div className="border-t border-border/60 p-3 flex items-end gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Pergunte algo ao copiloto…"
            rows={1}
            className="resize-none min-h-[44px] max-h-40 bg-card/40"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <Button onClick={() => send()} disabled={busy || !input.trim()} className="bg-[image:var(--gradient-brand)] h-11">
            <Send className="size-4" />
          </Button>
        </div>
      </Panel>
    </div>
  );
}
