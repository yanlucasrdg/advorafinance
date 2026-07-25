import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Bot, MoreVertical, Send, Sparkles, ThumbsDown, ThumbsUp, User } from "lucide-react";
import { Panel } from "@/components/data-table-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { askCopilot } from "@/lib/copilot.functions";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { clearCopilotHistory } from "@/lib/copilot.functions";

export const Route = createFileRoute("/_authenticated/copiloto")({
  head: () => ({ meta: [{ title: "Pergunte à IA — Advora" }] }),
  component: Copiloto,
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
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
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
    setInput("");
    setBusy(true);
    try {
      const res = await askCopilot({ data: { prompt: q } });
      setMessages(m => [
        ...m,
        { id: crypto.randomUUID(), role: "user", content: q, created_at: new Date().toISOString() },
        { id: crypto.randomUUID(), role: "assistant", content: res.reply, created_at: new Date().toISOString() },
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao consultar a IA");
    } finally {
      setBusy(false);
    }
  };

  const clearHistory = async () => {
    setClearing(true);
    try {
      await clearCopilotHistory();
      setMessages([]);
      setConfirmClear(false);
      toast.success("Histórico de conversas limpo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível limpar o histórico.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="p-5 sm:p-8 max-w-5xl mx-auto h-[calc(100vh-3.5rem)] flex flex-col">
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
      <Panel className="flex-1 flex flex-col overflow-hidden border-border bg-card shadow-[var(--shadow-md)]">
        <div className="h-16 shrink-0 px-5 flex items-center justify-between border-b border-border/70 bg-background/70">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">Advora IA</h1>
              <p className="text-xs text-muted-foreground">Assistente jurídico do seu escritório</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Mais opções"
                className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setConfirmClear(true)} className="cursor-pointer">
                Limpar histórico de conversas
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-auto p-5 sm:p-7 space-y-6 bg-background/40">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-10">
              <div className="size-14 rounded-2xl bg-primary/10 text-primary grid place-items-center mb-4">
                <Sparkles className="size-6" />
              </div>
              <h2 className="text-lg font-semibold">Como posso ajudar?</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">Pergunte sobre processos, prazos, peças e contratos do escritório.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-6 w-full max-w-2xl">
                {SUGESTOES.map(s => (
                  <button key={s} onClick={() => send(s)} className="text-left text-sm rounded-lg border border-border bg-card p-3.5 hover:border-primary/40 hover:bg-primary/5 transition">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(m => (
              <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "items-start"}`}>
                {m.role !== "user" && <div className="size-8 shrink-0 rounded-lg bg-primary/10 text-primary grid place-items-center"><Bot className="size-4" /></div>}
                <div className="max-w-[88%] sm:max-w-[82%]">
                  <div className={`rounded-xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${m.role === "user" ? "bg-foreground text-background shadow-sm" : "bg-muted/70 border border-border/60"}`}>
                    {m.content}
                  </div>
                  {m.role !== "user" && (
                    <div className="flex items-center gap-1 mt-1.5 ml-1 text-muted-foreground">
                      <button type="button" aria-label="Resposta útil" className="size-7 grid place-items-center rounded-md hover:bg-secondary hover:text-foreground"><ThumbsUp className="size-3.5" /></button>
                      <button type="button" aria-label="Resposta não útil" className="size-7 grid place-items-center rounded-md hover:bg-secondary hover:text-foreground"><ThumbsDown className="size-3.5" /></button>
                    </div>
                  )}
                </div>
                {m.role === "user" && <div className="size-8 shrink-0 rounded-lg bg-card grid place-items-center border border-border/60"><User className="size-4" /></div>}
              </div>
            ))
          )}
          {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Bot className="size-4 text-primary" /> IA pensando…</div>}
        </div>

        <div className="border-t border-border/70 bg-background p-3 sm:p-4 flex items-end gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Faça uma pergunta sobre o seu escritório..."
            rows={1}
            className="resize-none min-h-[46px] max-h-40 bg-muted/30 border-border focus-visible:ring-primary/30"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <Button onClick={() => send()} disabled={busy || !input.trim()} className="h-[46px] px-4 bg-primary hover:bg-primary/90">
            <Send className="size-4" />
          </Button>
        </div>
      </Panel>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Limpar histórico de conversas?</AlertDialogTitle>
          <AlertDialogDescription>
            O histórico de conversas deste escritório será excluído permanentemente e não poderá ser recuperado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={clearing}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={clearHistory} disabled={clearing} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {clearing ? "Limpando..." : "Limpar histórico"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
