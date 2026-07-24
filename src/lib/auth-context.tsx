import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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
  loading: boolean;
  refreshProfile: () => Promise<void>;
  refreshBranding: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBranding = async (tenantId: string) => {
    const { data } = await supabase
      .from("tenant_branding")
      .select("tenant_id, brand_name, logo_url, primary_color, secondary_color, default_theme")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    setBranding(data as TenantBranding | null);
  };

  const loadProfile = async (uid: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, tenant_id, full_name, email, avatar_url, locale, theme")
      .eq("id", uid)
      .maybeSingle();
    const nextProfile = data as Profile | null;
    setProfile(nextProfile);
    if (nextProfile?.tenant_id) await loadBranding(nextProfile.tenant_id);
    else setBranding(null);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => loadProfile(sess.user.id), 0);
      } else {
        setProfile(null);
        setBranding(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) loadProfile(sess.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshProfile = async () => {
    if (user) await loadProfile(user.id);
  };

  const refreshBranding = async () => {
    if (profile?.tenant_id) await loadBranding(profile.tenant_id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setBranding(null);
  };

  return (
    <Ctx.Provider value={{ user, session, profile, branding, loading, refreshProfile, refreshBranding, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
