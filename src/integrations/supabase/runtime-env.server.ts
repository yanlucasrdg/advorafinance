import { getRequest } from "@tanstack/react-start/server";

type CloudflareRequest = Request & {
  runtime?: {
    cloudflare?: {
      env?: Record<string, unknown>;
    };
  };
};

type CloudflareGlobal = typeof globalThis & {
  __env__?: Record<string, unknown>;
};

type BuildTimeEnv = ImportMeta & {
  env?: Record<string, string | boolean | undefined>;
};

/**
 * Cloudflare exposes Worker bindings on the request runtime. process.env is
 * retained as a fallback for local Vite/Nitro development.
 */
export function getServerEnv(name: string): string | undefined {
  const request = getRequest() as CloudflareRequest | undefined;
  const globalBinding = (globalThis as CloudflareGlobal).__env__?.[name];
  if (typeof globalBinding === "string" && globalBinding.length > 0) return globalBinding;
  const binding = request?.runtime?.cloudflare?.env?.[name];
  if (typeof binding === "string" && binding.length > 0) return binding;
  const processValue = process.env[name];
  if (processValue) return processValue;

  // URL and publishable key are intentionally public. Vite embeds their VITE_
  // counterparts in both bundles, which is a safe fallback for server-function
  // requests where Nitro does not surface the Cloudflare request bindings.
  const publicValue = (import.meta as BuildTimeEnv).env?.[`VITE_${name}`];
  return typeof publicValue === "string" && publicValue.length > 0 ? publicValue : undefined;
}
