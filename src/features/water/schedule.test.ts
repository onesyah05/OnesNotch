import { describe, expect, it } from "vitest";
import {
  currentWindow,
  dailyTargetMl,
  emptyProgress,
  isDue,
  nextDueAt,
  parseStartMinutes,
  reminderIntervalMs,
  remindersPerDay,
  targetRangeMl,
  WINDOW_MS,
} from "./schedule";

const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

describe("water schedule", () => {
  it("derives the goal from body weight", () => {
    expect(dailyTargetMl(60)).toBe(1800);
    expect(targetRangeMl(60)).toEqual([1800, 2100]);
  });

  it("spreads glasses over the 12-hour window", () => {
    expect(remindersPerDay(1800, 250)).toBe(8);
    expect(reminderIntervalMs(1800, 250)).toBe(WINDOW_MS / 8);
    expect(remindersPerDay(100, 250)).toBe(1);
  });

  it("parses start times", () => {
    expect(parseStartMinutes("07:00")).toBe(420);
    expect(parseStartMinutes("7:30")).toBe(450);
    expect(parseStartMinutes("24:00")).toBeNull();
    expect(parseStartMinutes("abc")).toBeNull();
  });

  it("picks today's window during and after it, and a fresh one before it", () => {
    const during = currentWindow(at(2026, 10, 30, 10), "07:00");
    expect(during.start).toBe(at(2026, 10, 30, 7));
    expect(during.dayKey).toBe("2026-10-30");

    const evening = currentWindow(at(2026, 10, 30, 21), "07:00");
    expect(evening.dayKey).toBe("2026-10-30");

    const earlyMorning = currentWindow(at(2026, 10, 31, 5), "07:00");
    expect(earlyMorning.start).toBe(at(2026, 10, 31, 7));
  });

  it("handles windows that cross midnight", () => {
    const lateNight = currentWindow(at(2026, 10, 31, 2), "20:00");
    expect(lateNight.start).toBe(at(2026, 10, 30, 20));
    const nextMorning = currentWindow(at(2026, 10, 31, 9), "20:00");
    expect(nextMorning.start).toBe(at(2026, 10, 31, 20));
  });

  it("is due at the window start, then one interval after each drink", () => {
    const window = currentWindow(at(2026, 10, 30, 7, 1), "07:00");
    const base = { window, targetMl: 1800, glassMl: 250 };
    const progress = emptyProgress(window.dayKey);
    expect(isDue({ ...base, now: at(2026, 10, 30, 7, 1), progress })).toBe(true);

    const drank = { ...progress, consumedMl: 250, glasses: 1, lastDrinkAt: at(2026, 10, 30, 8) };
    expect(nextDueAt(window, drank, WINDOW_MS / 8)).toBe(at(2026, 10, 30, 9, 30));
    expect(isDue({ ...base, now: at(2026, 10, 30, 9), progress: drank })).toBe(false);
    expect(isDue({ ...base, now: at(2026, 10, 30, 9, 30), progress: drank })).toBe(true);
  });

  it("respects snooze, the goal, and the window end", () => {
    const window = currentWindow(at(2026, 10, 30, 8), "07:00");
    const base = { window, targetMl: 1800, glassMl: 250 };
    const snoozed = { ...emptyProgress(window.dayKey), snoozeUntil: at(2026, 10, 30, 8, 15) };
    expect(isDue({ ...base, now: at(2026, 10, 30, 8), progress: snoozed })).toBe(false);
    expect(isDue({ ...base, now: at(2026, 10, 30, 8, 15), progress: snoozed })).toBe(true);

    const done = { ...emptyProgress(window.dayKey), consumedMl: 1800 };
    expect(isDue({ ...base, now: at(2026, 10, 30, 12), progress: done })).toBe(false);

    const empty = emptyProgress(window.dayKey);
    expect(isDue({ ...base, now: at(2026, 10, 30, 20), progress: empty })).toBe(false);
  });
});
