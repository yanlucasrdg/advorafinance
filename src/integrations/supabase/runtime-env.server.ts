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
  return process.env[name];
}
