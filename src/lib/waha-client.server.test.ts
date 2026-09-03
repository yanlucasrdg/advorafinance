import { describe, expect, it } from "vitest";
import { isInboundWahaMessage, phoneFromWahaId, phoneFromWahaPhoneNumber, resolveWahaContactPhone, wahaInboundContactIdentifiers, wahaLidFromId, wahaMessageCreatedAt, wahaSessionName, wahaSessionRecoveryAction, wahaStatus } from "./waha-client.server";

describe("WAHA provider helpers", () => {
  it("creates a stable session name without punctuation", () => {
    expect(wahaSessionName("550E8400-E29B-41D4-A716-446655440000"))
      .toBe("advora-550e8400e29b41d4a716446655440000");
  });

  it("normalizes phone-number fields returned separately from a LID chatId", () => {
    expect(phoneFromWahaPhoneNumber("+5521976868609")).toBe("5521976868609");
    expect(phoneFromWahaPhoneNumber("5521976868609@c.us")).toBe("5521976868609");
    expect(phoneFromWahaPhoneNumber("123456789@lid")).toBeNull();
  });

  it("accepts only direct WhatsApp phone identifiers", () => {
    expect(phoneFromWahaId("5511999999999@c.us")).toBe("5511999999999");
    expect(phoneFromWahaId("5511999999999@s.whatsapp.net")).toBe("5511999999999");
    expect(phoneFromWahaId("5511999999999:17@s.whatsapp.net")).toBe("5511999999999");
    expect(phoneFromWahaId("5511999999999@lid")).toBeNull();
    expect(phoneFromWahaId("120363123456@g.us")).toBeNull();
    expect(phoneFromWahaId("status@broadcast")).toBeNull();
  });

  it("recognizes and resolves an inbound NOWEB LID", async () => {
    expect(wahaLidFromId("123456789@lid")).toBe("123456789@lid");
    expect(wahaLidFromId("contact@lid")).toBeNull();
    const phone = await resolveWahaContactPhone("advora-test", ["123456789@lid"], async (session, lid) => {
      expect([session, lid]).toEqual(["advora-test", "123456789@lid"]);
      return "5521976868609@c.us";
    });
    expect(phone).toBe("5521976868609");
  });

  it("prefers an event phone identifier and exposes an unresolved LID", async () => {
    let lookupCalls = 0;
    expect(await resolveWahaContactPhone("advora-test", ["123@lid", "5521999999999@s.whatsapp.net"], async () => {
      lookupCalls += 1;
      return null;
    })).toBe("5521999999999");
    expect(lookupCalls).toBe(0);
    await expect(resolveWahaContactPhone("advora-test", ["123@lid"], async () => null)).resolves.toBeNull();
  });

  it("extracts NOWEB and GOWS alternate phone identifiers", () => {
    expect(wahaInboundContactIdentifiers({
      from: "123@lid",
      _data: { key: { remoteJid: "123@lid", remoteJidAlt: "5521999999999@s.whatsapp.net" } },
    })).toContain("5521999999999@s.whatsapp.net");
    expect(wahaInboundContactIdentifiers({
      chatId: "123@lid",
      _data: { Info: { Chat: "123@lid", SenderAlt: "5521976868609@s.whatsapp.net" } },
    })).toContain("5521976868609@s.whatsapp.net");
  });

  it("does not turn group, channel or status participants into direct CRM conversations", () => {
    expect(wahaInboundContactIdentifiers({ from: "120363123456@g.us", participant: "5511999999999@c.us" })).toEqual([]);
    expect(wahaInboundContactIdentifiers({ chatId: "120363123456@newsletter", participant: "5511999999999@c.us" })).toEqual([]);
    expect(wahaInboundContactIdentifiers({
      participant: "5511999999999@c.us",
      _data: { key: { remoteJid: "status@broadcast" } },
    })).toEqual([]);
  });

  it("accepts WAHA timestamps in seconds or milliseconds and safely falls back", () => {
    const fallback = new Date("2026-09-03T12:00:00.000Z");
    expect(wahaMessageCreatedAt(1_725_000_000, fallback)).toBe("2024-08-30T06:40:00.000Z");
    expect(wahaMessageCreatedAt("1725000000000", fallback)).toBe("2024-08-30T06:40:00.000Z");
    expect(wahaMessageCreatedAt("invalid", fallback)).toBe(fallback.toISOString());
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
