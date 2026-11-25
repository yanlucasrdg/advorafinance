import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  canAccessModule,
  normalizeRoles,
  primaryRole,
  type AppModule,
  type AppRole,
} from "@/lib/permissions";
import { canAccessPlanModule, toAdminPlan, type AdminPlanId } from "@/lib/admin-plans";

type Profile = {
  id: string;
  tenant_id: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  locale: string;
  theme: "light" | "dark";
};

export type TenantBranding = {
  tenant_id: string;
  brand_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  default_theme: "light" | "dark";
};

type AuthCtx = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  branding: TenantBranding | null;
  roles: AppRole[];
  primaryRole: AppRole | null;
  effectivePlan: AdminPlanId;
  accessSuspended: boolean;
  loading: boolean;
  can: (module: AppModule) => boolean;
  refreshProfile: () => Promise<void>;
  refreshBranding: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const activeUser = useRef<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [effectivePlan, setEffectivePlan] = useState<AdminPlanId>("free");
  const [accessSuspended, setAccessSuspended] = useState(false);
  const [loading, setLoading] = useState(true);
  const [trialDeadline, setTrialDeadline] = useState<number | null>(null);

  const loadBranding = useCallback(async (tenantId: string) => {
    const requestedBy = activeUser.current;
    const { data } = await supabase
      .from("tenant_branding")
      .select("tenant_id, brand_name, logo_url, primary_color, secondary_color, default_theme")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (requestedBy && activeUser.current === requestedBy) setBranding(data as TenantBranding | null);
  }, []);

  const loadProfile = useCallback(
    async (uid: string) => {
      const [{ data }, { data: roleRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, tenant_id, full_name, email, avatar_url, locale, theme")
          .eq("id", uid)
          .maybeSingle(),
        supabase.from("user_roles").select("role, tenant_id").eq("user_id", uid),
      ]);
      if (activeUser.current !== uid) return;
      const nextProfile = data as Profile | null;
      setRoles(normalizeRoles((roleRows ?? []).filter(row => row.role === "master_admin" || row.tenant_id === nextProfile?.tenant_id).map(row => row.role)));
      setProfile(nextProfile);
      if (nextProfile?.tenant_id) {
        const tenantId = nextProfile.tenant_id;
        const [{ data: plan }, { data: subscription }] = await Promise.all([
          supabase.rpc("current_effective_plan"),
          supabase
            .from("tenant_subscriptions")
            .select("status, trial_ends_at")
            .eq("tenant_id", tenantId)
            .maybeSingle(),
          loadBranding(tenantId),
        ]);
        if (activeUser.current !== uid) return;
        setEffectivePlan(toAdminPlan(plan));
        setTrialDeadline(subscription?.status === "trialing" && subscription.trial_ends_at ? Date.parse(subscription.trial_ends_at) : null);
        setAccessSuspended(subscription?.status === "suspended");
      } else {
        setBranding(null);
        setEffectivePlan("free");
        setAccessSuspended(false);
      }
    },
    [loadBranding],
  );

  useEffect(() => {
    let subscribed = true;
    let eventReceived = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      eventReceived = true;
      const nextId = sess?.user.id ?? null;
      if (activeUser.current !== nextId) {
        queryClient.clear();
        setProfile(null);
        setBranding(null);
        setEffectivePlan("free");
        setRoles([]);
        setAccessSuspended(false);
        setTrialDeadline(null);
        setLoading(!!nextId);
        activeUser.current = nextId;
      }
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => { void loadProfile(sess.user.id).finally(() => {
          if (subscribed && activeUser.current === sess.user.id) setLoading(false);
        }); }, 0);
      } else {
        setLoading(false);
        setProfile(null);
        setBranding(null);
        setRoles([]);
        setEffectivePlan("free");
        setAccessSuspended(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      if (!subscribed || eventReceived) return;
      activeUser.current = sess?.user.id ?? null;
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) loadProfile(sess.user.id).finally(() => {
        if (subscribed && activeUser.current === sess.user.id) setLoading(false);
      });
      else setLoading(false);
    });

    return () => { subscribed = false; sub.subscription.unsubscribe(); };
  }, [loadProfile, queryClient]);

  useEffect(() => {
    if (!profile?.tenant_id || !user) return;
    const channel = supabase
      .channel(`subscription:${profile.tenant_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tenant_subscriptions",
          filter: `tenant_id=eq.${profile.tenant_id}`,
        },
        () => {
          void loadProfile(user.id);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadProfile, profile?.tenant_id, user]);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [loadProfile, user]);

  useEffect(() => {
    if (!user || !trialDeadline || trialDeadline <= Date.now()) return;
    const timer = window.setTimeout(() => { void loadProfile(user.id); }, trialDeadline - Date.now() + 1);
    return () => window.clearTimeout(timer);
  }, [trialDeadline, user, loadProfile]);

  const refreshBranding = useCallback(async () => {
    if (profile?.tenant_id) await loadBranding(profile.tenant_id);
  }, [loadBranding, profile?.tenant_id]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setBranding(null);
    setRoles([]);
    setEffectivePlan("free");
    setAccessSuspended(false);
  }, []);

  const can = useCallback(
    (module: AppModule) =>
      !accessSuspended &&
      canAccessModule(roles, module) &&
      canAccessPlanModule(effectivePlan, module),
    [accessSuspended, effectivePlan, roles],
  );

  return (
    <Ctx.Provider
      value={{
        user,
        session,
        profile,
        branding,
        roles,
        primaryRole: primaryRole(roles),
        effectivePlan,
        accessSuspended,
        loading,
        can,
        refreshProfile,
        refreshBranding,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
