import { supabase } from "../supabase/client";

export const lovable = {
  auth: {
    signInWithOAuth: async (provider: "google" | "github" | "apple", options?: { redirect_uri?: string }) => {
      return await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: options?.redirect_uri ?? window.location.origin,
        },
      });
    },
  },
};

export const lovableAuth = lovable.auth;