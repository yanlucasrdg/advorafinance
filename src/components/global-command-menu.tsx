import { useEffect, useState, type ComponentType } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  Briefcase,
  Calendar,
  CircleDollarSign,
  Download,
  FilePlus2,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { storeCommandIntent, type CommandIntent } from "@/lib/command-intent";

type CommandLink = {
  label: string;
  description: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  shortcut?: string;
  intent?: CommandIntent;
};

type ClientResult = { id: string; name: string; email: string | null; type: string };
type CaseResult = { id: string; title: string; number: string | null; status: string };

const navigation: CommandLink[] = [
  {
    label: "Centro de operações",
    description: "Visão executiva do escritório",
    to: "/dashboard",
    icon: LayoutDashboard,
    shortcut: "G D",
  },
  {
    label: "CRM",
    description: "Pipeline, leads e clientes",
    to: "/crm",
    icon: Users,
    shortcut: "G C",
  },
  {
    label: "Processos",
    description: "Carteira processual e andamentos",
    to: "/processos",
    icon: Briefcase,
    shortcut: "G P",
  },
  {
    label: "Agenda",
    description: "Prazos, tarefas e compromissos",
    to: "/agenda",
    icon: Calendar,
    shortcut: "G A",
  },
  {
    label: "Financeiro",
    description: "Receitas, despesas e conciliação",
    to: "/financeiro",
    icon: CircleDollarSign,
    shortcut: "G F",
  },
  {
    label: "Relatórios",
    description: "Indicadores estratégicos",
    to: "/relatorios",
    icon: BarChart3,
  },
  {
    label: "Comunicações",
    description: "Conversas e atendimento",
    to: "/comunicacoes",
    icon: MessageSquare,
  },
  {
    label: "Automações",
    description: "Fluxos e rotinas inteligentes",
    to: "/automacoes",
    icon: Zap,
  },
  {
    label: "Configurações",
    description: "Preferências do escritório",
    to: "/config",
    icon: Settings,
  },
  {
    label: "Exportar dados",
    description: "Baixar os dados do escritório em JSON",
    to: "/exportar-dados",
    icon: Download,
  },
];

const actions: CommandLink[] = [
  {
    label: "Cadastrar cliente",
    description: "Abrir o CRM para incluir um novo contato",
    to: "/crm",
    icon: UserPlus,
    intent: { type: "create-client" },
  },
  {
    label: "Cadastrar processo",
    description: "Abrir a gestão processual",
    to: "/processos",
    icon: FilePlus2,
    intent: { type: "create-case" },
  },
  {
    label: "Registrar lançamento",
    description: "Abrir o controle financeiro",
    to: "/financeiro",
    icon: Plus,
    intent: { type: "create-entry" },
  },
  {
    label: "Abrir Copiloto Advora",
    description: "Analisar e executar com inteligência artificial",
    to: "/copiloto",
    icon: Sparkles,
  },
];

function cleanSearchTerm(value: string) {
  return value.replace(/[(),]/g, " ").trim();
}

export function GlobalCommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<ClientResult[]>([]);
  const [cases, setCases] = useState<CaseResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setClients([]);
      setCases([]);
    }
  }, [open]);

  useEffect(() => {
    const term = cleanSearchTerm(query);
    if (term.length < 2) {
      setClients([]);
      setCases([]);
      setSearching(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const pattern = `%${term}%`;
      const [clientQuery, caseQuery] = await Promise.all([
        supabase
          .from("clients")
          .select("id,name,email,type")
          .ilike("name", pattern)
          .order("updated_at", { ascending: false })
          .limit(5),
        supabase
          .from("cases")
          .select("id,title,number,status")
          .or(`title.ilike.${pattern},number.ilike.${pattern}`)
          .order("updated_at", { ascending: false })
          .limit(5),
      ]);
      if (!active) return;
      setClients((clientQuery.data ?? []) as ClientResult[]);
      setCases((caseQuery.data ?? []) as CaseResult[]);
      setSearching(false);
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const go = (to: string, intent?: CommandIntent) => {
    if (intent) storeCommandIntent(intent);
    onOpenChange(false);
    navigate({ to: to as never });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">Comando Advora</p>
          <p className="text-[11px] text-muted-foreground">
            Navegue, encontre registros e acelere a operação.
          </p>
        </div>
        <kbd className="inline-flex h-6 items-center rounded border border-border bg-secondary px-2 text-[10px] font-mono text-muted-foreground">
          ESC
        </kbd>
      </div>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Buscar cliente, processo ou comando…"
      />
      <CommandList className="max-h-[min(62vh,520px)] p-2">
        <CommandEmpty>
          <span className="block font-medium">Nenhum resultado encontrado</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Tente outro nome, número de processo ou comando.
          </span>
        </CommandEmpty>

        {query.trim().length >= 2 && (
          <>
            {searching && (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                Consultando o escritório…
              </div>
            )}
            {!searching && clients.length > 0 && (
              <CommandGroup heading="Clientes encontrados">
                {clients.map((client) => (
                  <CommandItem
                    key={client.id}
                    value={`cliente ${client.name} ${client.email ?? ""}`}
                    onSelect={() => go("/crm", { type: "open-client", id: client.id })}
                  >
                    <div className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-primary">
                      <Users className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{client.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {client.email ??
                          (client.type === "PJ" ? "Pessoa jurídica" : "Pessoa física")}
                      </p>
                    </div>
                    <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      CRM
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!searching && cases.length > 0 && (
              <CommandGroup heading="Processos encontrados">
                {cases.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`processo ${item.title} ${item.number ?? ""}`}
                    onSelect={() => go("/processos", { type: "open-case", id: item.id })}
                  >
                    <div className="grid size-8 place-items-center rounded-lg bg-sky-500/10 text-sky-600">
                      <Briefcase className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.number ?? item.status}
                      </p>
                    </div>
                    <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Processos
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {(clients.length > 0 || cases.length > 0 || searching) && (
              <CommandSeparator className="my-2" />
            )}
          </>
        )}

        <CommandGroup heading="Ações rápidas">
          {actions.map((action) => (
            <CommandItem
              key={action.label}
              value={`${action.label} ${action.description}`}
              onSelect={() => go(action.to, action.intent)}
            >
              <action.icon className="text-primary" />
              <div>
                <p className="text-sm font-medium">{action.label}</p>
                <p className="text-xs text-muted-foreground">{action.description}</p>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator className="my-2" />
        <CommandGroup heading="Navegar">
          {navigation.map((item) => (
            <CommandItem
              key={item.to}
              value={`${item.label} ${item.description}`}
              onSelect={() => go(item.to)}
            >
              <item.icon className="text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
              {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <div className="flex items-center justify-between border-t border-border bg-muted/35 px-4 py-2 text-[10px] text-muted-foreground">
        <span>
          <kbd className="rounded border border-border bg-card px-1">↑↓</kbd> navegar{" "}
          <kbd className="ml-1 rounded border border-border bg-card px-1">↵</kbd> abrir
        </span>
        <span>Resultados respeitam as permissões do escritório.</span>
      </div>
    </CommandDialog>
  );
}
