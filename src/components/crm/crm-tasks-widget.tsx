import React from "react";
import { CheckSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * This widget deliberately has no local sample data. Tasks will be loaded
 * from the database when the CRM task workflow is implemented.
 */
export function CrmTasksWidget() {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CheckSquare className="h-4 w-4" />
        </div>
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <span>Minhas Tarefas &amp; SLA</span>
            <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[10px]">0</Badge>
          </h4>
          <p className="text-[10px] text-muted-foreground">Follow-ups e contatos pendentes</p>
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-border/60 px-3 py-8 text-center">
        <p className="text-xs font-medium text-muted-foreground">Nenhuma tarefa pendente</p>
        <p className="mt-1 text-[10px] text-muted-foreground/80">
          As tarefas reais serão exibidas aqui quando esta área for conectada ao banco.
        </p>
      </div>
    </div>
  );
}
