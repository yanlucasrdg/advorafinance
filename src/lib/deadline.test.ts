import { describe, expect, it } from "vitest";

import {
  DEADLINE_KIND_VALUES,
  DEADLINE_PRIORITY_VALUES,
  deadlineErrorMessage,
} from "./deadline";

describe("deadline contract", () => {
  it("usa os valores canônicos persistidos no banco", () => {
    expect(DEADLINE_KIND_VALUES).toContain("prazo_processual");
    expect(DEADLINE_KIND_VALUES).not.toContain("prazo");
    expect(DEADLINE_PRIORITY_VALUES).toEqual(["low", "medium", "high", "critical"]);
  });

  it("não expõe mensagens internas do banco ao usuário", () => {
    expect(deadlineErrorMessage(new Error("DEADLINE_VERSION_CONFLICT: row 123"))).toBe(
      "Este prazo foi alterado por outra pessoa. Os dados foram atualizados.",
    );
    expect(deadlineErrorMessage(new Error("permission denied for table deadlines"))).toBe(
      "Não foi possível atualizar o prazo.",
    );
  });
});

