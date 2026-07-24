import React from "react";
import {
  Inbox, Scale, DollarSign, Landmark, Layers, Clock, ArrowRight,
  ShieldCheck, AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type LegalQueueId = "todas" | "triagem" | "juridico" | "financeiro" | "secretaria";

export type LegalQueueInfo = {
  id: LegalQueueId;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ElementType;
  count: number;
  slaAvg: string;
  color: string;
  bgColor: string;
  borderColor: string;
};

export const LEGAL_QUEUES: LegalQueueInfo[] = [
  {
    id: "triagem",
    label: "Triagem & Recepção",
    shortLabel: "Triagem",
    description: "Primeiro contato e qualificação de novos leads",
    icon: Inbox,
    count: 5,
    slaAvg: "12 min",
    color: "text-violet-600 dark:text-violet-400",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
  },
  {
    id: "juridico",
    label: "Atendimento Jurídico",
    shortLabel: "Jurídico",
    description: "Consultas técnicas e alinhamentos de advogados",
    icon: Scale,
    count: 8,
    slaAvg: "45 min",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
  {
    id: "financeiro",
    label: "Financeiro & Honorários",
    shortLabel: "Financeiro",
    description: "Contratos, boletos e negociações financeiras",
    icon: DollarSign,
    count: 3,
    slaAvg: "20 min",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
  },
  {
    id: "secretaria",
    label: "Secretaria & Prazos",
    shortLabel: "Secretaria",
    description: "Informes de tribunal, certidões e andamentos",
    icon: Landmark,
    count: 4,
    slaAvg: "30 min",
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
  },
];

type CrmQueuesBarProps = {
  selectedQueue: LegalQueueId;
  onSelectQueue: (queueId: LegalQueueId) => void;
  queueCounts?: Record<string, number>;
};

export function CrmQueuesBar({
  selectedQueue,
  onSelectQueue,
  queueCounts = {},
}: CrmQueuesBarProps) {
  const totalCount = Object.values(queueCounts).reduce((a, b) => a + b, 0) || 20;

  return (
    <div className="bg-card border border-border rounded-xl p-2.5 shadow-xs">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h4 className="text-xs font-bold text-foreground">Filas de Atendimento Jurídico</h4>
        </div>
        <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
          <Clock className="h-3 w-3 text-emerald-500" /> SLA Global: ~25min
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {/* All Queues Option */}
        <button
          onClick={() => onSelectQueue("todas")}
          className={`flex items-center justify-between p-2 rounded-lg border text-xs font-medium transition-all ${
            selectedQueue === "todas"
              ? "bg-primary text-primary-foreground border-primary shadow-xs"
              : "bg-muted/30 border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/60"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Layers className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Todas as Filas</span>
          </div>
          <Badge
            variant={selectedQueue === "todas" ? "secondary" : "outline"}
            className="text-[10px] px-1.5 py-0 h-4"
          >
            {totalCount}
          </Badge>
        </button>

        {/* Specific Legal Queues */}
        {LEGAL_QUEUES.map((q) => {
          const Icon = q.icon;
          const count = queueCounts[q.id] ?? q.count;
          const isSelected = selectedQueue === q.id;

          return (
            <button
              key={q.id}
              onClick={() => onSelectQueue(q.id)}
              className={`flex items-center justify-between p-2 rounded-lg border text-xs font-medium transition-all ${
                isSelected
                  ? `${q.bgColor} ${q.borderColor} ${q.color} font-bold ring-1 ring-current shadow-xs`
                  : "bg-card border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
              title={q.description}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${q.color}`} />
                <span className="truncate">{q.shortLabel}</span>
              </div>

              <div className="flex items-center gap-1">
                <Badge
                  className={`text-[10px] px-1.5 py-0 h-4 ${
                    isSelected
                      ? `${q.bgColor} ${q.color} border-0`
                      : "bg-muted text-muted-foreground border-0"
                  }`}
                >
                  {count}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
