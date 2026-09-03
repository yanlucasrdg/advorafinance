import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  Loader2,
  Mail,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ADMIN_PLANS,
  adminStatusLabel,
  type AdminPlanId,
  type AdminSubscriptionStatus,
} from "@/lib/admin-plans";
import { getPlatformUser, updatePlatformSubscription } from "@/lib/platform-admin.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users/$userId")({
  head: () => ({ meta: [{ title: "Gerenciar usuário — Administração Advora" }] }),
  component: ManagePlatformUser,
});

type UserDetail = Awaited<ReturnType<typeof getPlatformUser>>;

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function ManagePlatformUser() {
  const { userId } = Route.useParams();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [plan, setPlan] = useState<AdminPlanId>("free");
  const [status, setStatus] = useState<AdminSubscriptionStatus>("active");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const detail = await getPlatformUser({ data: { userId } });
      setUser(detail);
      setPlan(detail.plan as AdminPlanId);
      setStatus(detail.access_status as AdminSubscriptionStatus);
      setExpiresAt(toLocalInput(detail.expires_at));
      setNotes(detail.admin_notes || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar o usuário.");
    }
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);

  const setDuration = (days: number | null) => {
    if (days === null) return setExpiresAt("");
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(23, 59, 0, 0);
    setExpiresAt(toLocalInput(date.toISOString()));
  };

  const save = async () => {
    setSaving(true);
    try {
      await updatePlatformSubscription({
        data: {
          userId,
          plan,
          status,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          adminNotes: notes,
        },
      });
      toast.success("Plano e acesso atualizados para todo o escritório.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (!user)
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <header>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-4">
          <Link to="/admin/users">
            <ArrowLeft className="size-4" />
            Voltar aos usuários
          </Link>
        </Button>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Controle de assinatura
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Gerenciar usuário</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A alteração de plano é aplicada ao escritório inteiro e registrada em auditoria.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
        <aside className="space-y-5">
          <section className="rounded-3xl border border-border/70 bg-card/90 p-6 shadow-sm">
            <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <UserRound className="size-5" />
            </span>
            <h2 className="mt-5 text-lg font-semibold">{user.full_name || "Nome não informado"}</h2>
            <div className="mt-5 space-y-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <Mail className="size-4" />
                {user.email || "E-mail não informado"}
              </p>
              <p className="flex items-center gap-2">
                <Building2 className="size-4" />
                {user.tenant_name || "Sem escritório"}
              </p>
              <p className="flex items-center gap-2">
                <CalendarClock className="size-4" />
                Cadastro em {new Intl.DateTimeFormat("pt-BR").format(new Date(user.created_at))}
              </p>
            </div>
          </section>
          <section className="rounded-3xl border border-primary/20 bg-primary/5 p-6">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">Escopo da alteração</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  O plano pertence ao workspace. Outros usuários deste mesmo escritório receberão as
                  mesmas permissões comerciais.
                </p>
              </div>
            </div>
          </section>
        </aside>

        <section className="rounded-3xl border border-border/70 bg-card/90 p-6 shadow-sm sm:p-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plan">Plano</Label>
              <Select value={plan} onValueChange={(value) => setPlan(value as AdminPlanId)}>
                <SelectTrigger id="plan" className="h-12 w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(ADMIN_PLANS).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <span className="font-medium">{item.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                {ADMIN_PLANS[plan].description}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status de acesso</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as AdminSubscriptionStatus)}
              >
                <SelectTrigger id="status" className="h-12 w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="suspended">Suspenso</SelectItem>
                  <SelectItem value="expired">Expirado</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                Suspenso bloqueia o acesso; expirado mantém a conta sob as regras do Free.
              </p>
            </div>
          </div>

          <div className="mt-7 space-y-3">
            <Label htmlFor="expires">Data de expiração</Label>
            <Input
              id="expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="h-12 rounded-xl"
            />
            <div className="flex flex-wrap gap-2">
              {[
                [7, "7 dias"],
                [30, "30 dias"],
                [90, "90 dias"],
                [365, "1 ano"],
              ].map(([days, label]) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => setDuration(days as number)}
                >
                  {label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-lg"
                onClick={() => setDuration(null)}
              >
                Sem expiração
              </Button>
            </div>
          </div>

          <div className="mt-7 space-y-2">
            <Label htmlFor="notes">Observações administrativas</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="Contexto da concessão, negociação ou motivo da alteração…"
              className="resize-none rounded-xl"
            />
            <p className="text-right text-xs text-muted-foreground">{notes.length}/2000</p>
          </div>

          <div className="mt-8 flex justify-end border-t border-border/70 pt-6">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={saving} className="h-11 rounded-xl px-5">
                  <Save className="size-4" />
                  Salvar alterações
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-3xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmar alteração do escritório?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O workspace <strong className="text-foreground">{user.tenant_name}</strong>{" "}
                    passará para o plano{" "}
                    <strong className="text-foreground">{ADMIN_PLANS[plan].name}</strong>, com
                    status{" "}
                    <strong className="text-foreground">
                      {adminStatusLabel(status).toLowerCase()}
                    </strong>
                    . A ação será registrada na auditoria.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void save()} className="rounded-xl">
                    Confirmar e salvar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>
      </div>
    </div>
  );
}
