import React from "react";
import {
  Flame, Zap, Snowflake, MessageCircle, PhoneCall, Calendar, FileEdit,
  Clock, AlertTriangle, ShieldCheck, UserCheck, MoreVertical, ExternalLink,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  meta: {
    area: string;
    value: number;
    owner: string;
    hot: boolean;
  };
  onClick: (client: ClientCardData) => void;
  onOpenWhatsapp: (phone: string | null, clientName: string) => void;
  onQuickAction?: (action: string, client: ClientCardData) => void;
};

function formatBRL(amount: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getSlaInfo(updatedAtIso: string, stageId: string) {
  const diffMs = Date.now() - new Date(updatedAtIso).getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  let label = "Hoje";
  if (diffDays >= 1) {
    label = `${diffDays}d na etapa`;
  } else if (diffHours >= 1) {
    label = `${diffHours}h na etapa`;
  } else {
    label = "<1h na etapa";
  }

  // Determine SLA alert: Triage/Novo Contato > 24h, Proposta/Consulta > 48h
  const isOverdue =
    (stageId === "novo_contato" || stageId === "triagem") ? diffHours >= 24 : diffHours >= 48;

  return { label, diffHours, diffDays, isOverdue };
}

const AREA_COLOR_MAP: Record<string, string> = {
  Trabalhista: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  Cível: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  Empresarial: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  Tributário: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  Família: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
  Criminal: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  Previdenciário: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
};

export function CrmKanbanCard({
  client,
  meta,
  onClick,
  onOpenWhatsapp,
  onQuickAction,
}: CrmKanbanCardProps) {
  const sla = getSlaInfo(client.updated_at || client.created_at, client.status);

  const areaBadgeClass =
    AREA_COLOR_MAP[meta.area] ||
    "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";

  return (
    <div
      onClick={() => onClick(client)}
      className={`group relative rounded-xl border bg-card p-3.5 transition-all duration-200 cursor-pointer shadow-xs hover:shadow-md hover:-translate-y-0.5 ${
        sla.isOverdue
          ? "border-amber-400/60 dark:border-amber-500/40 bg-amber-500/2"
          : "border-border/80 hover:border-primary/40"
      }`}
    >
      {/* Header Row: Client Name + Temp Badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar className="h-8 w-8 shrink-0 ring-2 ring-primary/10">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
              {getInitials(client.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {client.name}
            </h4>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{client.type === "PJ" ? "Pessoa Jurídica" : "Pessoa Física"}</span>
              {client.doc && <span>• {client.doc}</span>}
            </div>
          </div>
        </div>

        {/* Lead Temperature */}
        <div className="shrink-0">
          {meta.hot ? (
            <Badge className="bg-gradient-to-r from-orange-500 to-rose-500 text-white text-[10px] px-1.5 py-0.5 font-medium border-0 flex items-center gap-1 shadow-xs">
              <Flame className="h-3 w-3 fill-current animate-pulse" />
              <span>Quente</span>
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 text-muted-foreground border-border">
              <Zap className="h-2.5 w-2.5 mr-0.5 text-amber-500" />
              <span>Morno</span>
            </Badge>
          )}
        </div>
      </div>

      {/* Tags Row: Area + SLA */}
      <div className="flex items-center justify-between gap-2 my-2.5">
        <span
          className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md border ${areaBadgeClass}`}
        >
          {meta.area}
        </span>

        {/* SLA Status */}
        <div
          className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md ${
            sla.isOverdue
              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold"
              : "text-muted-foreground bg-muted/50"
          }`}
          title={`Tempo na etapa atual: ${sla.label}`}
        >
          {sla.isOverdue ? (
            <AlertTriangle className="h-3 w-3 text-rose-500 animate-bounce" />
          ) : (
            <Clock className="h-3 w-3" />
          )}
          <span>{sla.label}</span>
        </div>
      </div>

      {/* Footer Row: Value + Responsible Avatar */}
      <div className="flex items-center justify-between border-t border-border/60 pt-2.5 mt-2">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-medium tracking-wider text-muted-foreground">
            Honorário Estimado
          </span>
          <span className="text-xs font-bold text-foreground">
            {formatBRL(meta.value)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div
            className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full"
            title={`Advogado Responsável: ${meta.owner}`}
          >
            <UserCheck className="h-3 w-3 text-primary" />
            <span className="truncate max-w-[80px]">{meta.owner}</span>
          </div>
        </div>
      </div>

      {/* Quick actions stay in the document flow so they never overlap the card below. */}
      <div
        className="mt-0 max-h-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:mt-2 group-hover:max-h-10 group-hover:opacity-100 focus-within:mt-2 focus-within:max-h-10 focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-center gap-1 border-t border-border/60 pt-2">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 rounded-full text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
          title="Abrir WhatsApp"
          onClick={() => onOpenWhatsapp(client.phone, client.name)}
        >
          <MessageCircle className="h-3.5 w-3.5" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 rounded-full text-blue-600 hover:bg-blue-500/10 hover:text-blue-600"
          title="Ligar para Cliente"
          onClick={() => {
            if (client.phone) {
              window.open(`tel:${client.phone}`);
            } else {
              toast.error("Telefone não cadastrado");
            }
          }}
        >
          <PhoneCall className="h-3.5 w-3.5" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 rounded-full text-purple-600 hover:bg-purple-500/10 hover:text-purple-600"
          title="Agendar Reunião / Tarefa"
          onClick={() => {
            if (onQuickAction) onQuickAction("schedule", client);
            else toast.info(`Agendar consulta para ${client.name}`);
          }}
        >
          <Calendar className="h-3.5 w-3.5" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 rounded-full text-amber-600 hover:bg-amber-500/10 hover:text-amber-600"
          title="Adicionar Anotação"
          onClick={() => {
            if (onQuickAction) onQuickAction("note", client);
            else toast.info(`Nova anotação para ${client.name}`);
          }}
        >
          <FileEdit className="h-3.5 w-3.5" />
        </Button>
        </div>
      </div>
    </div>
  );
}
