import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, Search, ShieldCheck, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/data-table-shell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { changeTeamMemberRole, inviteTeamMember } from "@/lib/team.functions";

const ROLES = {
  owner: { label: "Proprietário", description: "Responsável pelo escritório e pelas decisões administrativas." },
  admin: { label: "Administrador", description: "Gerencia configurações e integrações do escritório." },
  lawyer: { label: "Advogado", description: "Acessa processos, clientes, agenda e dados operacionais." },
  secretary: { label: "Secretária", description: "Opera CRM, agenda e comunicações do escritório." },
  intern: { label: "Estagiário", description: "Acesso operacional limitado e supervisionado." },
} as const;

type AssignableRole = "admin" | "lawyer" | "secretary" | "intern";
type DisplayRole = keyof typeof ROLES;
type Member = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  phone: string | null;
  role: DisplayRole;
};

const emptyInvite = { fullName: "", email: "", phone: "", role: "lawyer" as AssignableRole };

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({ meta: [{ title: "Usuários — Advora" }] }),
  component: UsersAdmin,
});

function UsersAdmin() {
  const { profile } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filterRole, setFilterRole] = useState<"all" | DisplayRole>("all");
  const [isOwner, setIsOwner] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invite, setInvite] = useState(emptyInvite);

  const loadMembers = async () => {
    if (!profile?.tenant_id || !profile.id) return;
    setLoading(true);
    const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, avatar_url, phone").eq("tenant_id", profile.tenant_id).order("full_name"),
      supabase.from("user_roles").select("user_id, role").eq("tenant_id", profile.tenant_id),
    ]);
    if (profilesError || rolesError) {
      toast.error(profilesError?.message ?? rolesError?.message ?? "Não foi possível carregar os usuários.");
      setLoading(false);
      return;
    }

    const roleByUser = new Map((roles ?? []).map((entry) => [entry.user_id, entry.role as DisplayRole]));
    setMembers((profiles ?? []).map((member) => ({ ...member, role: roleByUser.get(member.id) ?? "intern" })));
    setIsOwner((roles ?? []).some((entry) => entry.user_id === profile.id && entry.role === "owner"));
    setLoading(false);
  };

  useEffect(() => { void loadMembers(); }, [profile?.id, profile?.tenant_id]);

  const visibleMembers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return members.filter((member) => {
      const matchesQuery = !normalized || `${member.full_name ?? ""} ${member.email ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalized);
      return matchesQuery && (filterRole === "all" || member.role === filterRole);
    });
  }, [filterRole, members, query]);

  const submitInvite = async () => {
    setSaving(true);
    try {
      await inviteTeamMember({ data: invite });
      toast.success("Convite enviado e perfil de acesso configurado.");
      setSheetOpen(false);
      setInvite(emptyInvite);
      await loadMembers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o convite.");
    } finally {
      setSaving(false);
    }
  };

  const updateRole = async (member: Member, role: AssignableRole) => {
    setSaving(true);
    try {
      await changeTeamMemberRole({ data: { userId: member.id, role } });
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, role } : item));
      toast.success("Perfil de acesso atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar o acesso.");
    } finally {
      setSaving(false);
    }
  };

  if (!loading && !isOwner) {
    return (
      <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <Panel className="p-8 text-center">
          <ShieldCheck className="mx-auto size-9 text-primary" />
          <h1 className="mt-4 text-lg font-semibold">Área restrita</h1>
          <p className="mt-2 text-sm text-muted-foreground">Somente o proprietário do escritório pode administrar usuários e perfis de acesso.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader title="Usuários" subtitle={`${members.length} ${members.length === 1 ? "usuário ativo" : "usuários ativos"} neste escritório.`} />

      <Panel className="overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-border flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Pesquisar por nome ou e-mail" />
          </div>
          <Select value={filterRole} onValueChange={(value) => setFilterRole(value as "all" | DisplayRole)}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue placeholder="Todos os perfis" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os perfis</SelectItem>
              {Object.entries(ROLES).map(([role, detail]) => <SelectItem key={role} value={role}>{detail.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setSheetOpen(true)} className="bg-[image:var(--gradient-brand)]"><Plus className="size-4" /> Novo usuário</Button>
        </div>

        {loading ? <div className="h-64 grid place-items-center"><Loader2 className="size-5 animate-spin text-primary" /></div> : (
          <div className="divide-y divide-border">
            {visibleMembers.map((member) => {
              const role = ROLES[member.role] ?? ROLES.intern;
              const initials = (member.full_name ?? member.email ?? "?").split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
              const canEdit = member.role !== "owner";
              return (
                <div key={member.id} className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
                  <Avatar className="size-9 shrink-0 ring-1 ring-primary/15">
                    {member.avatar_url && <AvatarImage src={member.avatar_url} alt={member.full_name ?? ""} />}
                    <AvatarFallback className="bg-primary-soft text-primary text-xs font-semibold">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{member.full_name || "Sem nome"}</p>
                    <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                  </div>
                  {canEdit ? (
                    <Select value={member.role} disabled={saving} onValueChange={(value) => void updateRole(member, value as AssignableRole)}>
                      <SelectTrigger className="w-40 sm:w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(ROLES).filter(([key]) => key !== "owner").map(([key, detail]) => <SelectItem key={key} value={key}>{detail.label}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : <span className="hidden sm:inline-flex rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary">{role.label}</span>}
                </div>
              );
            })}
            {!visibleMembers.length && <div className="p-12 text-center text-sm text-muted-foreground">Nenhum usuário encontrado.</div>}
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="flex gap-3"><UsersRound className="mt-0.5 size-5 text-primary" /><div><h2 className="text-sm font-semibold">Governança de acesso</h2><p className="mt-1 text-sm text-muted-foreground">Cada pessoa recebe uma função única. Proprietários preservam o controle do escritório; administradores, advogados, secretárias e estagiários recebem permissões proporcionais ao trabalho.</p></div></div>
      </Panel>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>Novo usuário</SheetTitle><SheetDescription>O convite é enviado por e-mail e o perfil de acesso é configurado para este escritório.</SheetDescription></SheetHeader>
          <div className="mt-6 grid gap-4">
            <div><Label htmlFor="member-name">Nome completo</Label><Input id="member-name" value={invite.fullName} onChange={(event) => setInvite({ ...invite, fullName: event.target.value })} /></div>
            <div><Label htmlFor="member-email">E-mail</Label><Input id="member-email" type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></div>
            <div><Label htmlFor="member-phone">Telefone <span className="text-muted-foreground">(opcional)</span></Label><Input id="member-phone" value={invite.phone} onChange={(event) => setInvite({ ...invite, phone: event.target.value })} /></div>
            <div>
              <Label>Perfil de acesso</Label>
              <Select value={invite.role} onValueChange={(value) => setInvite({ ...invite, role: value as AssignableRole })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(ROLES).filter(([key]) => key !== "owner").map(([key, detail]) => <SelectItem key={key} value={key}>{detail.label}</SelectItem>)}</SelectContent>
              </Select>
              <div className="mt-3 rounded-lg border border-border bg-secondary/35 p-3 text-xs"><p className="font-semibold text-foreground">{ROLES[invite.role].label}</p><p className="mt-1 text-muted-foreground">{ROLES[invite.role].description}</p></div>
            </div>
            <Button disabled={saving || !invite.fullName.trim() || !invite.email.trim()} onClick={() => void submitInvite()} className="mt-2 bg-[image:var(--gradient-brand)]">{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Enviar convite</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
