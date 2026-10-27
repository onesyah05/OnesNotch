/**
 * Hotkey strings use the backend format `Ctrl+Alt+Shift+Super+<KeyboardEvent.code>`,
 * e.g. `Ctrl+Shift+KeyW` (see src-tauri/src/hotkeys.rs).
 */

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

const KEY_LABELS: Record<string, string> = {
  Super: "Win",
  Space: "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/** `Ctrl+Shift+KeyW` → `Ctrl + Shift + W`. */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) => KEY_LABELS[part] ?? part.replace(/^(Key|Digit)/, "").replace(/^Numpad/, "Num "))
    .join(" + ");
}

type KeyInfo = Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "code">;

/** Builds an accelerator from a keydown, or `null` while only modifiers are held. */
export function acceleratorFromEvent(event: KeyInfo): string | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(event.code);
  return parts.join("+");
}
