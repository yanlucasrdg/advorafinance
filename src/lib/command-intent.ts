export type CommandIntent =
  | { type: "create-client" }
  | { type: "create-case" }
  | { type: "create-entry" }
  | { type: "open-client"; id: string }
  | { type: "open-case"; id: string };

const COMMAND_INTENT_KEY = "advora:command-intent";

export function storeCommandIntent(intent: CommandIntent) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(COMMAND_INTENT_KEY, JSON.stringify(intent));
}

export function consumeCommandIntent(): CommandIntent | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(COMMAND_INTENT_KEY);
  window.sessionStorage.removeItem(COMMAND_INTENT_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as CommandIntent;
  } catch {
    return null;
  }
}
