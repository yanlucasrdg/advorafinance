import { describe, expect, it } from "vitest";
import { isDrawerSessionCurrent } from "./crm-lead-drawer";

describe("CrmLeadDrawer session isolation", () => {
  it("accepts a response only for the currently opened client and session", () => {
    expect(
      isDrawerSessionCurrent(
        { clientId: "client-a", version: 3 },
        { clientId: "client-a", version: 3 },
      ),
    ).toBe(true);
  });

  it("rejects an async response from the previously opened client", () => {
    expect(
      isDrawerSessionCurrent(
        { clientId: "client-a", version: 3 },
        { clientId: "client-b", version: 4 },
      ),
    ).toBe(false);
  });

  it("rejects an old request when the same client is reopened", () => {
    expect(
      isDrawerSessionCurrent(
        { clientId: "client-a", version: 3 },
        { clientId: "client-a", version: 4 },
      ),
    ).toBe(false);
  });

  it("never treats an empty drawer as an active client session", () => {
    expect(
      isDrawerSessionCurrent({ clientId: null, version: 1 }, { clientId: null, version: 1 }),
    ).toBe(false);
  });
});
