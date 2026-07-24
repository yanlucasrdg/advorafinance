import React from "react";
import { AlertTriangle, Calendar, Clock, FileEdit, Flame, MessageCircle, PhoneCall, UserCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export type ClientCardData = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  doc: string | null;
  type: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type CrmKanbanCardProps = {
  client: ClientCardData;
  meta: { area: string; value: number; owner: string; hot: boolean };
  onClick: (client: ClientCardData) => void;
  onOpenWhatsapp: (phone: string | null, clientName: string) => void;
  onQuickAction?: (action: string, client: ClientCardData) => void;
  onDragStart?: (client: ClientCardData) => void;
  onDragEnd?: () => void;
};

function formatBRL(amount: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

function getSlaInfo(updatedAtIso: string, stageId: string) {
  const diffHours = Math.floor((Date.now() - new Date(updatedAtIso).getTime()) / 3_600_000);
  const diffDays = Math.floor(diffHours / 24);
  const label = diffDays >= 1 ? `${diffDays}d na etapa` : diffHours >= 1 ? `${diffHours}h na etapa` : "Hoje";
  const isOverdue = (stageId === "novo_contato" || stageId === "triagem") ? diffHours >= 24 : diffHours >= 48;
  return { label, isOverdue };
}

export function CrmKanbanCard({ client, meta, onClick, onOpenWhatsapp, onQuickAction, onDragStart, onDragEnd }: CrmKanbanCardProps) {
  const sla = getSlaInfo(client.updated_at || client.created_at, client.status);
  const reference = client.id.slice(0, 8).toUpperCase();

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        onDragStart?.(client);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onClick(client)}
      className={`group cursor-grab active:cursor-grabbing rounded-lg border bg-card p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
        sla.isOverdue ? "border-rose-300/80 bg-rose-500/[0.03]" : "border-border/80 hover:border-primary/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{reference}</p>
          <h4 className="mt-0.5 truncate text-sm font-bold text-foreground group-hover:text-primary">{client.name}</h4>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
          <UserCheck className="h-3 w-3" />
          <span className="max-w-[76px] truncate">{meta.owner}</span>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">{meta.area}</span>
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          meta.hot ? "bg-rose-500 text-white" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
        }`}>
          {meta.hot ? <Flame className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
          {meta.hot ? "Quente" : "Morno"}
        </span>
      </div>

      <p className="mt-3 text-sm font-extrabold tabular-nums text-foreground">{formatBRL(meta.value)}</p>

      <div className={`mt-3 flex items-center justify-between text-[11px] ${sla.isOverdue ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>
        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {sla.label}</span>
        {sla.isOverdue && <AlertTriangle className="h-3.5 w-3.5" />}
      </div>

      <div className="mt-0 max-h-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:mt-3 group-hover:max-h-10 group-hover:opacity-100 focus-within:mt-3 focus-within:max-h-10 focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-end gap-1 border-t border-border/60 pt-2">
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-md text-emerald-600 hover:bg-emerald-500/10" title="Abrir WhatsApp" onClick={() => onOpenWhatsapp(client.phone, client.name)}>
            <MessageCircle className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-md text-blue-600 hover:bg-blue-500/10" title="Ligar para cliente" onClick={() => client.phone ? window.open(`tel:${client.phone}`) : toast.error("Telefone não cadastrado")}>
            <PhoneCall className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-md text-purple-600 hover:bg-purple-500/10" title="Agendar tarefa" onClick={() => onQuickAction?.("schedule", client)}>
            <Calendar className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-md text-amber-600 hover:bg-amber-500/10" title="Adicionar anotação" onClick={() => onQuickAction?.("note", client)}>
            <FileEdit className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}
