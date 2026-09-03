import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260903220000_waha_conversation_ingress.sql", import.meta.url),
  "utf8",
);
const webhook = readFileSync(new URL("./waha-webhook.server.ts", import.meta.url), "utf8");

describe("WAHA conversation ingress integrity", () => {
  it("serializes normalized contact creation and validates tenant ownership", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("regexp_replace(conversation.contact_phone");
    expect(migration).toContain("WAHA_INSTANCE_TENANT_MISMATCH");
    expect(migration).toContain("TO service_role");
  });

  it("uses the atomic conversation RPC before the idempotent message ingest RPC", () => {
    expect(webhook).toContain('rpc("get_or_create_waha_conversation"');
    expect(webhook).toContain('rpc("ingest_meta_whatsapp_message"');
    expect(webhook.indexOf('rpc("get_or_create_waha_conversation"'))
      .toBeLessThan(webhook.indexOf('rpc("ingest_meta_whatsapp_message"'));
  });
});
