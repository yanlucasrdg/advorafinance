import React, { useState } from "react";
import {
  CheckSquare, Plus, Clock, AlertTriangle, Calendar, CheckCircle2, User,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type TaskItem = {
  id: string;
  title: string;
  clientName: string;
  dueDate: string;
  done: boolean;
  priority: "alta" | "media" | "baixa";
};

export function CrmTasksWidget() {
  const [tasks, setTasks] = useState<TaskItem[]>([
    {
      id: "1",
      title: "Retornar ligação sobre honorários",
      clientName: "Roberto Silva",
      dueDate: "Hoje • 15:00",
      done: false,
      priority: "alta",
    },
    {
      id: "2",
      title: "Enviar minuta do contrato trabalhista",
      clientName: "Mariana Souza",
      dueDate: "Hoje • 17:30",
      done: false,
      priority: "alta",
    },
    {
      id: "3",
      title: "Confirmar audiência de conciliação",
      clientName: "Empresa Alfa Ltda",
      dueDate: "Amanhã • 10:00",
      done: false,
      priority: "media",
    },
  ]);

  const [openNew, setOpenNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newClient, setNewClient] = useState("");

  const toggleTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
    toast.success("Status da tarefa atualizado!");
  };

  const handleAddTask = () => {
    if (!newTitle.trim()) return;
    const newTask: TaskItem = {
      id: String(Date.now()),
      title: newTitle,
      clientName: newClient || "Geral",
      dueDate: "Hoje",
      done: false,
      priority: "media",
    };
    setTasks([newTask, ...tasks]);
    setNewTitle("");
    setNewClient("");
    setOpenNew(false);
    toast.success("Nova tarefa adicionada com sucesso!");
  };

  const pendingCount = tasks.filter((t) => !t.done).length;

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <CheckSquare className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <span>Minhas Tarefas & SLA</span>
              {pendingCount > 0 && (
                <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0 h-4">
                  {pendingCount}
                </Badge>
              )}
            </h4>
            <p className="text-[10px] text-muted-foreground">Follow-ups e contatos pendentes</p>
          </div>
        </div>

        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 gap-1 font-medium">
              <Plus className="h-3 w-3" />
              <span>Nova Tarefa</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm font-bold">Adicionar Tarefa no CRM</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs text-muted-foreground">Descrição da Tarefa</label>
                <Input
                  placeholder="Ex.: Ligar para o cliente para fechar contrato"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="text-xs mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Cliente (opcional)</label>
                <Input
                  placeholder="Nome do cliente"
                  value={newClient}
                  onChange={(e) => setNewClient(e.target.value)}
                  className="text-xs mt-1"
                />
              </div>
              <Button onClick={handleAddTask} className="w-full text-xs font-medium mt-2">
                Criar Tarefa
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Task List */}
      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`flex items-start gap-2.5 p-2 rounded-lg border transition-colors ${
              task.done
                ? "bg-muted/30 border-transparent opacity-60"
                : "bg-muted/10 border-border/60 hover:border-primary/30"
            }`}
          >
            <Checkbox
              checked={task.done}
              onCheckedChange={() => toggleTask(task.id)}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <p
                className={`text-xs font-medium text-foreground leading-tight ${
                  task.done ? "line-through text-muted-foreground" : ""
                }`}
              >
                {task.title}
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
                <span className="font-semibold text-primary/90">{task.clientName}</span>
                <span>•</span>
                <span className="flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" /> {task.dueDate}
                </span>
              </div>
            </div>

            {task.priority === "alta" && !task.done && (
              <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 text-[9px] px-1 py-0 shrink-0">
                Alta
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
