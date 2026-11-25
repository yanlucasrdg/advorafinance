import { describe, expect, it } from "vitest";
import { handleKirvanoWebhook } from "./kirvano-webhook.server";

describe("Kirvano webhook authentication", () => {
  const bindings = { KIRVANO_WEBHOOK_TOKEN: "local-test-only" };
  function deliver(token: string) {
    return handleKirvanoWebhook(new Request("https://example.invalid/webhooks/kirvano", {
      method: "POST", headers: { "Security-Token": token },
      body: JSON.stringify({ event: "IGNORED_EVENT" }),
    }), bindings);
  }
  it("accepts the provider header and acknowledges an irrelevant event", async () => {
    expect((await deliver(bindings.KIRVANO_WEBHOOK_TOKEN)).status).toBe(200);
  });
  it("rejects an incorrect provider token", async () => {
    expect((await deliver("incorrect")).status).toBe(401);
  });
});
