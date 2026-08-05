import { describe, expect, it } from "vitest";
import {
  canAccessModule,
  moduleForPath,
  normalizeRoles,
  primaryRole,
} from "@/lib/permissions";

describe("permissions", () => {
  it("normalizes unknown and duplicated roles", () => {
    expect(normalizeRoles(["lawyer", "unknown", "lawyer", "owner"])).toEqual([
      "lawyer",
      "owner",
    ]);
  });

  it("selects the most privileged role", () => {
    expect(primaryRole(["intern", "admin", "lawyer"])).toBe("admin");
    expect(primaryRole([])).toBeNull();
  });

  it("keeps financial and tenant administration restricted", () => {
    expect(canAccessModule(["admin"], "finance")).toBe(true);
    expect(canAccessModule(["lawyer"], "finance")).toBe(false);
    expect(canAccessModule(["admin"], "users")).toBe(false);
    expect(canAccessModule(["owner"], "users")).toBe(true);
    expect(canAccessModule(["admin"], "export")).toBe(false);
  });

  it("resolves exact and nested protected routes", () => {
    expect(moduleForPath("/admin/usuarios")).toBe("users");
    expect(moduleForPath("/financeiro/lancamentos")).toBe("finance");
    expect(moduleForPath("/rota-desconhecida")).toBeNull();
  });
});
