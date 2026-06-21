import { useMemo, useState } from "react";
import { Bell, Check, CheckCheck, Calendar, Briefcase, DollarSign, Users, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";

type Notif = {
  id: string;
  title: string;
  body: string;
  time: string;
  type: "agenda" | "processo" | "financeiro" | "cliente" | "ia";
  read: boolean;
};

const seed: Notif[] = [
  { id: "1", type: "agenda",     title: "Audiência amanhã",          body: "Caso Silva vs. Banco — 14:00 no TJ-SP.",      time: "agora",     read: false },
  { id: "2", type: "processo",   title: "Novo andamento",            body: "Processo 0001234-56 recebeu despacho.",       time: "12 min",    read: false },
  { id: "3", type: "financeiro", title: "Honorário recebido",        body: "R$ 8.500,00 — Cliente Construtora Alvo.",     time: "1 h",       read: false },
  { id: "4", type: "ia",         title: "Copiloto sugeriu petição",  body: "Modelo de contestação pronto para revisão.",  time: "3 h",       read: true  },
  { id: "5", type: "cliente",    title: "Novo lead no CRM",          body: "Mariana Costa — origem: site.",               time: "ontem",     read: true  },
];

const iconFor: Record<Notif["type"], React.ComponentType<{ className?: string }>> = {
  agenda: Calendar, processo: Briefcase, financeiro: DollarSign, cliente: Users, ia: Sparkles,
};
const tintFor: Record<Notif["type"], string> = {
  agenda: "text-sky-300 bg-sky-500/10",
  processo: "text-violet-300 bg-violet-500/10",
  financeiro: "text-emerald-300 bg-emerald-500/10",
  cliente: "text-amber-300 bg-amber-500/10",
  ia: "text-fuchsia-300 bg-fuchsia-500/10",
};

export function NotificationsPopover() {
  const [items, setItems] = useState<Notif[]>(seed);
  const unread = useMemo(() => items.filter(i => !i.read).length, [items]);

  const markAll = () => {
    setItems(prev => prev.map(i => ({ ...i, read: true })));
    toast.success("Todas as notificações marcadas como lidas");
  };
  const markOne = (id: string) => setItems(prev => prev.map(i => i.id === id ? { ...i, read: true } : i));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="size-9 grid place-items-center rounded-lg text-muted-foreground hover:bg-white/[0.04] hover:text-foreground relative transition-colors"
          aria-label="Notificações"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 flex items-center justify-center">
              <span className="absolute inline-flex size-3.5 rounded-full bg-rose-500/40 animate-ping" />
              <span className="relative inline-flex min-w-[14px] h-[14px] px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-background">
                {unread}
              </span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-[360px] sm:w-[400px] p-0 border-border/60 bg-[oklch(0.16_0.014_265)]/95 backdrop-blur-xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div>
            <div className="text-sm font-semibold tracking-tight">Notificações</div>
            <div className="text-[11px] text-muted-foreground">
              {unread > 0 ? `${unread} não lidas` : "Tudo em dia"}
            </div>
          </div>
          <button
            onClick={markAll}
            disabled={unread === 0}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCheck className="size-3.5" /> Marcar todas
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto divide-y divide-border/40">
          {items.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">Nenhuma notificação</div>
          )}
          {items.map(n => {
            const Icon = iconFor[n.type];
            return (
              <button
                key={n.id}
                onClick={() => markOne(n.id)}
                className={`w-full text-left flex gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03] ${!n.read ? "bg-white/[0.015]" : ""}`}
              >
                <div className={`size-9 shrink-0 rounded-lg grid place-items-center ${tintFor[n.type]}`}>
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-semibold truncate">{n.title}</div>
                    {!n.read && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
                  </div>
                  <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>
                  <div className="text-[10px] text-muted-foreground/70 mt-1 font-mono uppercase tracking-wider">{n.time}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/70 font-mono uppercase tracking-wider">Atualizado agora</span>
          <button
            onClick={() => { setItems([]); toast("Notificações limpas"); }}
            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <Check className="size-3" /> Limpar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
