import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleMetaWhatsAppWebhook } from "./lib/meta-webhook.server";
import { handleKirvanoWebhook } from "./lib/kirvano-webhook.server";
import { handleWahaWebhook } from "./lib/waha-webhook.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type CloudflareRuntime = typeof globalThis & { __env__?: Record<string, unknown> };

let serverEntryPromise: Promise<ServerEntry> | undefined;

function withSecurityHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("cross-origin-opener-policy", "same-origin-allow-popups");
  headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://connect.facebook.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://graph.facebook.com; frame-src https://www.facebook.com https://web.facebook.com; object-src 'none'; base-uri 'self'; form-action 'self' https://pay.kirvano.com; frame-ancestors 'none'; upgrade-insecure-requests",
  );
  if (new URL(request.url).protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // TanStack server functions execute through the Nitro handler. Keep the
      // immutable Worker bindings available to their server-only helpers. The
      // Nitro service can call this entry without forwarding `env`, while its
      // outer Cloudflare handler has already populated globalThis.__env__.
      // Never replace those bindings with an empty object in that case.
      const forwardedEnv = env && typeof env === "object"
        ? env as Record<string, unknown>
        : undefined;
      if (forwardedEnv) (globalThis as CloudflareRuntime).__env__ = forwardedEnv;
      const pathname = new URL(request.url).pathname;
      let response: Response;
      if (pathname === "/webhooks/whatsapp") {
        const bindings = (globalThis as CloudflareRuntime).__env__ ?? forwardedEnv ?? {};
        response = await handleMetaWhatsAppWebhook(request, bindings);
      } else if (pathname === "/webhooks/waha") {
        // Keep WAHA ingress on the same authenticated Worker deployment as the CRM.
        const bindings = (globalThis as CloudflareRuntime).__env__ ?? forwardedEnv ?? {};
        response = await handleWahaWebhook(request, bindings);
      } else if (pathname === "/webhooks/kirvano") {
        const bindings = (globalThis as CloudflareRuntime).__env__ ?? forwardedEnv ?? {};
        response = await handleKirvanoWebhook(request, bindings);
      } else {
        const handler = await getServerEntry();
        response = await normalizeCatastrophicSsrResponse(await handler.fetch(request, env, ctx));
      }
      return withSecurityHeaders(response, request);
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }), request);
    }
  },
};
