import { beforeEach, describe, expect, it } from "vitest";
import type { WaterSettings } from "../lib/ipc";
import { emptyProgress } from "../features/water/schedule";
import { useWaterStore } from "./useWaterStore";

const settings: WaterSettings = { enabled: true, weightKg: 60, startTime: "07:00", glassMl: 250 };
const at = (h: number, mi = 0) => new Date(2026, 9, 30, h, mi).getTime();

describe("useWaterStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useWaterStore.setState({ progress: emptyProgress(""), reminderActive: false });
  });

  it("raises a reminder inside the window and clears it on drink", () => {
    useWaterStore.getState().tick(settings, at(8));
    expect(useWaterStore.getState().reminderActive).toBe(true);

    useWaterStore.getState().drink(settings, at(8, 1));
    const state = useWaterStore.getState();
    expect(state.reminderActive).toBe(false);
    expect(state.progress.consumedMl).toBe(250);
    expect(state.progress.glasses).toBe(1);

    // 8 glasses over 12 h → next one 90 minutes later.
    useWaterStore.getState().tick(settings, at(9));
    expect(useWaterStore.getState().reminderActive).toBe(false);
    useWaterStore.getState().tick(settings, at(9, 31));
    expect(useWaterStore.getState().reminderActive).toBe(true);
  });

  it("stays quiet when disabled or outside the window", () => {
    useWaterStore.getState().tick({ ...settings, enabled: false }, at(8));
    expect(useWaterStore.getState().reminderActive).toBe(false);
    useWaterStore.getState().tick(settings, at(20));
    expect(useWaterStore.getState().reminderActive).toBe(false);
  });

  it("snoozes and persists progress", () => {
    useWaterStore.getState().tick(settings, at(8));
    useWaterStore.getState().snooze(at(8));
    expect(useWaterStore.getState().reminderActive).toBe(false);
    useWaterStore.getState().tick(settings, at(8, 10));
    expect(useWaterStore.getState().reminderActive).toBe(false);
    useWaterStore.getState().tick(settings, at(8, 15));
    expect(useWaterStore.getState().reminderActive).toBe(true);

    useWaterStore.getState().drink(settings, at(8, 16));
    useWaterStore.setState({ progress: emptyProgress("") });
    useWaterStore.getState().load();
    expect(useWaterStore.getState().progress.consumedMl).toBe(250);
  });

  it("starts a fresh day", () => {
    useWaterStore.getState().drink(settings, at(8));
    const nextDay = new Date(2026, 9, 31, 8).getTime();
    useWaterStore.getState().tick(settings, nextDay);
    expect(useWaterStore.getState().progress.consumedMl).toBe(0);
    expect(useWaterStore.getState().progress.dayKey).toBe("2026-10-31");
  });
});
