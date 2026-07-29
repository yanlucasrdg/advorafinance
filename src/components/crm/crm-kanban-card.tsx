import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, Clock, FileEdit, Flame, GripVertical, MessageCircle, PhoneCall, UserCheck, Zap } from "lucide-react";
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
  stage_entered_at?: string;
  created_at: string;
  updated_at: string;
};

type CrmKanbanCardProps = {
  client: ClientCardData;
  meta: { area: string; value: number; owner: string; hot: boolean };
  onClick: (client: ClientCardData) => void;
  onOpenWhatsapp: (phone: string | null, clientName: string) => void;
  onQuickAction?: (action: string, client: ClientCardData) => void;
  disabled?: boolean;
};

function formatBRL(amount: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

function getStageElapsedLabel(stageEnteredAt: string) {
  const diffHours = Math.max(
    0,
    Math.floor((Date.now() - new Date(stageEnteredAt).getTime()) / 3_600_000),
  );
  const diffDays = Math.floor(diffHours / 24);
  return diffDays >= 1
    ? `${diffDays}d na etapa`
    : diffHours >= 1
      ? `${diffHours}h na etapa`
      : "Entrou agora";
}

export function CrmKanbanCard({ client, meta, onClick, onOpenWhatsapp, onQuickAction, disabled = false }: CrmKanbanCardProps) {
  const stageElapsedLabel = getStageElapsedLabel(
    client.stage_entered_at || client.updated_at || client.created_at,
  );
  const reference = client.id.slice(0, 8).toUpperCase();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: client.id,
    data: { type: "crm-client", stageId: client.status },
    disabled,
  });

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={() => onClick(client)}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(client);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Abrir cliente ${client.name}`}
      aria-busy={disabled}
      className={`group rounded-lg border bg-card p-3 shadow-sm transition-[border-color,box-shadow,opacity] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        isDragging ? "z-20 opacity-40" : ""
      } border-border/80 hover:border-primary/40`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{reference}</p>
          <h4 className="mt-0.5 truncate text-sm font-bold text-foreground group-hover:text-primary">{client.name}</h4>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
            <UserCheck className="h-3 w-3" />
            <span className="max-w-[76px] truncate" title={meta.owner}>{meta.owner}</span>
          </span>
          <button
            type="button"
            className="inline-flex h-7 w-7 touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Mover ${client.name} para outra etapa`}
            title="Arraste ou use o teclado para mover"
            disabled={disabled}
            onClick={(event) => event.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-md bg-primary/12 px-2 py-0.5 text-xs font-semibold text-primary">{meta.area}</span>
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${
          meta.hot ? "bg-rose-500 text-white" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
        }`}>
          {meta.hot ? <Flame className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
          {meta.hot ? "Quente" : "Morno"}
        </span>
      </div>

      <p className="mt-3 text-sm font-extrabold tabular-nums text-foreground">{formatBRL(meta.value)}</p>

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> {stageElapsedLabel}
        </span>
      </div>

      <div className="mt-3 max-h-10 overflow-hidden opacity-100 transition-all duration-200 sm:mt-0 sm:max-h-0 sm:opacity-0 sm:group-hover:mt-3 sm:group-hover:max-h-10 sm:group-hover:opacity-100 sm:focus-within:mt-3 sm:focus-within:max-h-10 sm:focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-end gap-1 border-t border-border/60 pt-2">
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-md text-emerald-600 hover:bg-emerald-500/10" title="Abrir WhatsApp" aria-label={`Abrir WhatsApp de ${client.name}`} onClick={() => onOpenWhatsapp(client.phone, client.name)}>
            <MessageCircle className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-md text-blue-600 hover:bg-blue-500/10" title="Ligar para cliente" aria-label={`Ligar para ${client.name}`} onClick={() => client.phone ? window.open(`tel:${client.phone}`) : toast.error("Telefone não cadastrado")}>
            <PhoneCall className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-md text-primary hover:bg-primary/10" title="Agendar tarefa" aria-label={`Agendar tarefa para ${client.name}`} onClick={() => onQuickAction?.("schedule", client)}>
            <Calendar className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-md text-amber-600 hover:bg-amber-500/10" title="Adicionar anotação" aria-label={`Adicionar anotação para ${client.name}`} onClick={() => onQuickAction?.("note", client)}>
            <FileEdit className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}
