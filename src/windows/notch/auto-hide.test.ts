import { describe, expect, it } from "vitest";
import { shouldReveal } from "./auto-hide";

const base = { enabled: true, state: "idle" as const, hasEvent: false, pulsing: false };

describe("shouldReveal", () => {
  it("always shows when auto-hide is off", () => {
    expect(shouldReveal({ ...base, enabled: false })).toBe(true);
  });

  it("hides an idle notch with nothing going on", () => {
    expect(shouldReveal(base)).toBe(false);
  });

  it("shows for interaction, events and pulses", () => {
    expect(shouldReveal({ ...base, state: "peek" })).toBe(true);
    expect(shouldReveal({ ...base, state: "expanded" })).toBe(true);
    expect(shouldReveal({ ...base, state: "answer" })).toBe(true);
    expect(shouldReveal({ ...base, hasEvent: true })).toBe(true);
    expect(shouldReveal({ ...base, pulsing: true })).toBe(true);
  });
});
