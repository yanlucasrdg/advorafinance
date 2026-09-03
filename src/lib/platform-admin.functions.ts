import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthenticatedServerContext } from "@/lib/authorization.server";

const ListUsersSchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  plan: z.enum(["free", "starter", "pro", "enterprise"]).nullable().optional(),
  status: z.enum(["active", "suspended", "expired"]).nullable().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

const UpdateSubscriptionSchema = z.object({
  userId: z.string().uuid(),
  plan: z.enum(["free", "starter", "pro", "enterprise"]),
  status: z.enum(["active", "suspended", "expired"]),
  expiresAt: z.string().datetime().nullable(),
  adminNotes: z.string().trim().max(2000),
});

async function requirePlatformAdmin(context: AuthenticatedServerContext) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", context.userId)
    .eq("role", "master_admin")
    .limit(1);
  if (error || !data?.length)
    throw new Error("Acesso exclusivo para administradores da plataforma.");
}

export const getPlatformAdminDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context);
    const { data, error } = await context.supabase.rpc("platform_admin_dashboard");
    if (error) throw new Error("Não foi possível carregar os indicadores administrativos.");
    return data as unknown as {
      totalUsers: number;
      freeUsers: number;
      starterUsers: number;
      proUsers: number;
      enterpriseUsers: number;
      activeUsers: number;
      suspendedUsers: number;
      expiredUsers: number;
    };
  });

export const listPlatformUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => ListUsersSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const { data: rows, error } = await context.supabase.rpc("platform_admin_list_users", {
      p_search: data.search || null,
      p_plan: data.plan ?? null,
      p_status: data.status ?? null,
      p_page: data.page,
      p_page_size: data.pageSize,
    });
    if (error) throw new Error("Não foi possível consultar os usuários.");
    return rows;
  });

export const getPlatformUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const { data: rows, error } = await context.supabase.rpc("platform_admin_user_detail", {
      p_user_id: data.userId,
    });
    if (error) throw new Error("Não foi possível carregar o usuário.");
    if (!rows?.[0]) throw new Error("Usuário não encontrado.");
    return rows[0];
  });

export const updatePlatformSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => UpdateSubscriptionSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const { error } = await context.supabase.rpc("platform_admin_update_subscription", {
      p_user_id: data.userId,
      p_plan: data.plan,
      p_status: data.status,
      p_expires_at: data.expiresAt,
      p_admin_notes: data.adminNotes || null,
    });
    if (error)
      throw new Error(
        "Não foi possível salvar a assinatura. Nenhuma alteração parcial foi mantida.",
      );
    return { ok: true as const };
  });
