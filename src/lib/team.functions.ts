import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AssignableRole = z.enum(["admin", "lawyer", "secretary", "intern"]);

const InviteSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(30).optional(),
  role: AssignableRole,
});

const ChangeRoleSchema = z.object({
  userId: z.string().uuid(),
  role: AssignableRole,
});

async function requireOwner(context: { supabase: any; userId: string }) {
  const { data: profile, error: profileError } = await context.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", context.userId)
    .maybeSingle();

  if (profileError || !profile?.tenant_id) throw new Error("Escritório não encontrado.");

  const { data: ownerRole, error: roleError } = await context.supabase
    .from("user_roles")
    .select("id")
    .eq("tenant_id", profile.tenant_id)
    .eq("user_id", context.userId)
    .eq("role", "owner")
    .maybeSingle();

  if (roleError || !ownerRole) throw new Error("Apenas proprietários podem administrar usuários.");
  return profile.tenant_id as string;
}

export const inviteTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InviteSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.fullName },
    });
    if (inviteError || !invited.user) throw new Error(inviteError?.message ?? "Não foi possível enviar o convite.");

    const userId = invited.user.id;
    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: userId,
      tenant_id: tenantId,
      full_name: data.fullName,
      email: data.email,
      phone: data.phone || null,
    } as never);
    if (profileError) throw new Error(profileError.message);

    const { error: removeRolesError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", userId);
    if (removeRolesError) throw new Error(removeRolesError.message);

    const { error: insertRoleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, tenant_id: tenantId, role: data.role } as never);
    if (insertRoleError) throw new Error(insertRoleError.message);

    return { userId };
  });

export const changeTeamMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ChangeRoleSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: currentRoles, error: currentRoleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", data.userId);
    if (currentRoleError) throw new Error(currentRoleError.message);
    if (!currentRoles?.length) throw new Error("Usuário não pertence a este escritório.");
    if (currentRoles.some((entry: { role: string }) => entry.role === "owner" || entry.role === "master_admin")) {
      throw new Error("A função de um proprietário não pode ser alterada nesta tela.");
    }

    const { error: removeRolesError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", data.userId);
    if (removeRolesError) throw new Error(removeRolesError.message);

    const { error: insertRoleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, tenant_id: tenantId, role: data.role } as never);
    if (insertRoleError) throw new Error(insertRoleError.message);

    return { ok: true };
  });
