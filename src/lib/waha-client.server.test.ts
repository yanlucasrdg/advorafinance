import { describe, expect, it } from "vitest";
import { isInboundWahaMessage, phoneFromWahaId, wahaSessionName, wahaSessionRecoveryAction, wahaStatus } from "./waha-client.server";

describe("WAHA provider helpers", () => {
  it("creates a stable session name without punctuation", () => {
    expect(wahaSessionName("550E8400-E29B-41D4-A716-446655440000"))
      .toBe("advora-550e8400e29b41d4a716446655440000");
  });

  it("accepts only direct WhatsApp phone identifiers", () => {
    expect(phoneFromWahaId("5511999999999@c.us")).toBe("5511999999999");
    expect(phoneFromWahaId("120363123456@g.us")).toBeNull();
    expect(phoneFromWahaId("status@broadcast")).toBeNull();
  });

  it("maps WAHA lifecycle states to the CRM contract", () => {
    expect(wahaStatus("WORKING")).toBe("connected");
    expect(wahaStatus("STARTING")).toBe("connecting");
    expect(wahaStatus("SCAN_QR_CODE")).toBe("connecting");
    expect(wahaStatus("PASSKEY_REQUIRED")).toBe("connecting");
    expect(wahaStatus("PASSKEY_CONFIRMATION_REQUIRED")).toBe("connecting");
    expect(wahaStatus("FAILED")).toBe("error");
    expect(wahaStatus("STOPPED")).toBe("disconnected");
  });

  it("uses the lifecycle action required by each recoverable status", () => {
    expect(wahaSessionRecoveryAction("STOPPED")).toBe("start");
    expect(wahaSessionRecoveryAction("FAILED")).toBe("restart");
    expect(wahaSessionRecoveryAction("STARTING")).toBeNull();
    expect(wahaSessionRecoveryAction("WORKING")).toBeNull();
  });

  it("persists only inbound WAHA message events", () => {
    expect(isInboundWahaMessage("message", false)).toBe(true);
    expect(isInboundWahaMessage("message", undefined)).toBe(true);
    expect(isInboundWahaMessage("message", true)).toBe(false);
    expect(isInboundWahaMessage("message.ack", false)).toBe(false);
  });
});
