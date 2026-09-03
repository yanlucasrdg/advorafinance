import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  SlidersHorizontal,
  UserRoundCog,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminStatusLabel, ADMIN_PLANS, type AdminSubscriptionStatus } from "@/lib/admin-plans";
import { listPlatformUsers } from "@/lib/platform-admin.functions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Usuários — Administração Advora" }] }),
  component: PlatformUsers,
});

type UserRow = Awaited<ReturnType<typeof listPlatformUsers>>[number];
const PAGE_SIZE = 20;

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(
        new Date(value),
      )
    : "Sem expiração";
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status as AdminSubscriptionStatus;
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        normalized === "active" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        normalized === "suspended" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        normalized === "expired" && "bg-rose-500/10 text-rose-700 dark:text-rose-300",
      )}
    >
      {adminStatusLabel(normalized)}
    </span>
  );
}

function PlatformUsers() {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      listPlatformUsers({
        data: {
          search,
          plan: plan === "all" ? null : (plan as "free" | "starter" | "pro" | "enterprise"),
          status: status === "all" ? null : (status as AdminSubscriptionStatus),
          page,
          pageSize: PAGE_SIZE,
        },
      })
        .then(setRows)
        .catch((error) =>
          toast.error(error instanceof Error ? error.message : "Falha ao consultar usuários."),
        )
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [page, plan, search, status]);

  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const changeFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Gestão de acesso
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Usuários</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Consulte contas e administre o plano do escritório ao qual cada usuário pertence.
        </p>
      </header>

      <section className="rounded-3xl border border-border/70 bg-card/90 shadow-sm">
        <div className="grid gap-3 border-b border-border/70 p-4 md:grid-cols-[1fr_180px_180px] md:p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => changeFilter(setSearch, event.target.value)}
              placeholder="Buscar por nome ou e-mail"
              className="h-11 rounded-xl pl-10"
            />
          </div>
          <Select value={plan} onValueChange={(value) => changeFilter(setPlan, value)}>
            <SelectTrigger className="h-11 w-full rounded-xl">
              <SelectValue placeholder="Plano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os planos</SelectItem>
              {Object.values(ADMIN_PLANS).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => changeFilter(setStatus, value)}>
            <SelectTrigger className="h-11 w-full rounded-xl">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="suspended">Suspensos</SelectItem>
              <SelectItem value="expired">Expirados</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Usuário</TableHead>
                <TableHead>Escritório</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cadastro</TableHead>
                <TableHead>Expiração</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-56 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-primary" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-56 text-center">
                    <Users className="mx-auto size-8 text-muted-foreground/60" />
                    <p className="mt-3 font-medium">Nenhum usuário encontrado</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Ajuste os filtros para ampliar a busca.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((user) => (
                  <TableRow key={user.user_id} className="group">
                    <TableCell>
                      <div className="min-w-48">
                        <p className="font-medium">{user.full_name || "Nome não informado"}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {user.email || "E-mail não informado"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {user.tenant_name || "Sem escritório"}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">
                        {ADMIN_PLANS[user.plan as keyof typeof ADMIN_PLANS]?.name || "Free"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={user.access_status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.created_at)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.expires_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost" className="rounded-lg">
                        <Link to="/admin/users/$userId" params={{ userId: user.user_id }}>
                          <UserRoundCog className="size-4" />
                          Gerenciar
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <footer className="flex items-center justify-between border-t border-border/70 px-5 py-4">
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString("pt-BR")} usuário{total === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              className="size-9 rounded-lg"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-20 text-center text-xs text-muted-foreground">
              {page} de {pages}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="size-9 rounded-lg"
              disabled={page >= pages || loading}
              onClick={() => setPage((value) => value + 1)}
              aria-label="Próxima página"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </footer>
      </section>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <SlidersHorizontal className="size-3.5" />
        Filtros e paginação são processados no banco; nenhum dado global é exposto diretamente ao
        navegador.
      </p>
    </div>
  );
}
