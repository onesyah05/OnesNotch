import type { NotchState } from "../../lib/ipc";

export interface RevealInput {
  enabled: boolean;
  state: NotchState;
  /** A notification, drink reminder, video or finished timer wants attention. */
  hasEvent: boolean;
  /** A periodic or one-off appearance (new song, just collapsed) is running. */
  pulsing: boolean;
}

/**
 * With auto-hide on, the notch stays tucked above the screen edge unless
 * the user is interacting with it or something is happening.
 */
export function shouldReveal({ enabled, state, hasEvent, pulsing }: RevealInput): boolean {
  if (!enabled) return true;
  return state !== "idle" || hasEvent || pulsing;
}

/** Brief stay after collapsing, so the shrink animation is seen before hiding. */
export const COLLAPSE_LINGER_MS = 900;
