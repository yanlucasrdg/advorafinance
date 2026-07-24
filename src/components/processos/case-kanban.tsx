import { memo, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Clock } from "lucide-react";
import { formatBRL } from "@/components/data-table-shell";
import type { Case, Deadline } from "@/hooks/use-cases";

export type ProcessStage = {
  id: string;
  label: string;
  glow: string;
  bar: string;
  text: string;
  ring: string;
};

type Props = {
  stages: readonly ProcessStage[];
  casesByStage: Map<string, Case[]>;
  deadlinesByCase: Map<string, Deadline[]>;
  onOpenCase: (caseItem: Case) => void;
  onMoveCase: (caseItem: Case, nextStatus: string) => void;
};

function successScore(id: string) {
  let value = 0;
  for (let index = 0; index < id.length; index++) value = (value * 31 + id.charCodeAt(index)) | 0;
  return 55 + (Math.abs(value) % 40);
}

export function CaseKanban({ stages, casesByStage, deadlinesByCase, onOpenCase, onMoveCase }: Props) {
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const allCases = useMemo(() => Array.from(casesByStage.values()).flat(), [casesByStage]);
  const activeCase = allCases.find((item) => item.id === activeCaseId) ?? null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = ({ active }: DragStartEvent) => setActiveCaseId(String(active.id));
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveCaseId(null);
    if (!over) return;
    const movedCase = allCases.find((item) => item.id === String(active.id));
    if (!movedCase) return;
    const targetId = String(over.id);
    const nextStatus = targetId.startsWith("stage:")
      ? targetId.slice("stage:".length)
      : allCases.find((item) => item.id === targetId)?.status;
    if (nextStatus && nextStatus !== movedCase.status) onMoveCase(movedCase, nextStatus);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveCaseId(null)}
      onDragEnd={handleDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable: "Pressione espaço para pegar o processo. Use as setas para escolher a etapa e espaço para soltar.",
        },
      }}
    >
      <div className="grid grid-flow-col auto-cols-[minmax(280px,1fr)] gap-4 overflow-x-auto pb-4 -mx-2 px-2">
        {stages.map((stage) => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            items={casesByStage.get(stage.id) ?? []}
            deadlinesByCase={deadlinesByCase}
            onOpenCase={onOpenCase}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "ease" }}>
        {activeCase ? <CaseCard caseItem={activeCase} deadlines={deadlinesByCase.get(activeCase.id) ?? []} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({ stage, items, deadlinesByCase, onOpenCase }: {
  stage: ProcessStage;
  items: Case[];
  deadlinesByCase: Map<string, Deadline[]>;
  onOpenCase: (caseItem: Case) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}` });
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 182,
    overscan: 6,
  });
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <section ref={setNodeRef} className={`flex min-h-[530px] flex-col rounded-xl p-2 transition-colors ${isOver ? "bg-primary/10 ring-1 ring-primary/40" : "bg-muted/35"}`}>
      <div className="mb-3 px-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`size-1.5 rounded-full ${stage.bar}`} />
            <h4 className={`text-xs font-semibold uppercase tracking-wide ${stage.text}`}>{stage.label}</h4>
            <span className="text-[10px] text-muted-foreground">({items.length})</span>
          </div>
        </div>
        <div className={`mt-3 h-0.5 rounded-full ${stage.bar} opacity-60`} />
      </div>

      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div ref={scrollRef} className="max-h-[calc(100vh-330px)] min-h-[420px] overflow-y-auto pr-1">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/40 py-8 text-center text-[11px] text-muted-foreground">Solte processos aqui</div>
          ) : (
            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
              {virtualItems.map((virtualItem) => {
                const caseItem = items[virtualItem.index];
                return (
                  <div
                    key={caseItem.id}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    className="absolute left-0 top-0 w-full pb-3"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <SortableCaseCard caseItem={caseItem} deadlines={deadlinesByCase.get(caseItem.id) ?? []} stage={stage} onOpenCase={onOpenCase} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

const SortableCaseCard = memo(function SortableCaseCard({ caseItem, deadlines, stage, onOpenCase }: {
  caseItem: Case;
  deadlines: Deadline[];
  stage: ProcessStage;
  onOpenCase: (caseItem: Case) => void;
}) {
  const sortable = useSortable({ id: caseItem.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div ref={sortable.setNodeRef} style={style} className={sortable.isDragging ? "opacity-30" : ""}>
      <CaseCard
        caseItem={caseItem}
        deadlines={deadlines}
        stage={stage}
        onOpenCase={onOpenCase}
        dragAttributes={sortable.attributes}
        dragListeners={sortable.listeners}
      />
    </div>
  );
});

function CaseCard({ caseItem, deadlines, stage, onOpenCase, overlay = false, dragAttributes, dragListeners }: {
  caseItem: Case;
  deadlines: Deadline[];
  stage?: ProcessStage;
  onOpenCase?: (caseItem: Case) => void;
  overlay?: boolean;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
}) {
  const nextDeadline = deadlines.filter((item) => !item.done).sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0];
  const daysToDeadline = nextDeadline ? Math.ceil((new Date(nextDeadline.due_at).getTime() - Date.now()) / 86_400_000) : null;
  const success = successScore(caseItem.id);

  return (
    <button
      type="button"
      onClick={() => onOpenCase?.(caseItem)}
      className={`w-full touch-none text-left glass rounded-xl p-3.5 ring-1 ${stage?.ring ?? "ring-primary/30"} ${stage?.glow ?? ""} ${overlay ? "cursor-grabbing shadow-xl" : "cursor-grab active:cursor-grabbing hover-lift"}`}
      aria-label={`${caseItem.title}. Processo ${caseItem.number ?? "sem número"}.`}
      {...dragAttributes}
      {...dragListeners}
    >
      <p className="truncate text-[11px] tabular-nums text-muted-foreground">{caseItem.number || "Sem número"}</p>
      <p className="mt-1 truncate text-sm font-semibold">{caseItem.clients?.name ?? caseItem.title}</p>
      <p className="text-[11px] capitalize text-muted-foreground">{caseItem.area ?? "—"}</p>
      <p className="mt-2 text-sm font-bold tabular-nums">{formatBRL(caseItem.value_cents ?? 0)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {daysToDeadline !== null && (
          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${daysToDeadline <= 2 ? "border-rose-500/30 bg-rose-500/15 text-rose-300" : "border-border bg-card/60 text-muted-foreground"}`}>
            Prazo: {daysToDeadline}d
          </span>
        )}
        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">Êxito: {success}%</span>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-3">
        <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Clock className="size-3" /> {new Date(caseItem.updated_at).toLocaleDateString("pt-BR")}</p>
        <span className="grid size-5 place-items-center rounded-full bg-[image:var(--gradient-brand)] text-[9px] font-bold">{(caseItem.responsible ?? "DR")[0]}</span>
      </div>
    </button>
  );
}
