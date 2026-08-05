import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
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

async function requireOwner(context: { supabase: SupabaseClient<Database>; userId: string }) {
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
  .validator((data) => InviteSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.fullName },
    });
    if (inviteError || !invited.user) throw new Error(inviteError?.message ?? "Não foi possível enviar o convite.");

    const userId = invited.user.id;
    const { error: provisionError } = await context.supabase.rpc("provision_tenant_member", {
      p_user_id: userId,
      p_full_name: data.fullName,
      p_email: data.email,
      p_phone: data.phone ?? "",
      p_role: data.role,
    });
    if (provisionError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(provisionError.message);
    }

    return { userId };
  });

export const changeTeamMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => ChangeRoleSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const { error } = await context.supabase.rpc("replace_tenant_member_role", {
      p_user_id: data.userId,
      p_role: data.role,
    });
    if (error) throw new Error(error.message);

    return { ok: true };
  });
