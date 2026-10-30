import { create } from "zustand";
import type { WaterSettings } from "../lib/ipc";
import {
  currentWindow,
  dailyTargetMl,
  emptyProgress,
  isDue,
  SNOOZE_MINUTES,
  type WaterProgress,
} from "../features/water/schedule";

/**
 * Today's drink progress. It is a per-device convenience, so it lives in
 * localStorage, which the notch and settings windows share.
 */
const STORAGE_KEY = "notch_water_progress";

function readProgress(): WaterProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WaterProgress>;
    if (typeof parsed.dayKey !== "string") return null;
    return {
      dayKey: parsed.dayKey,
      consumedMl: Math.max(0, Number(parsed.consumedMl) || 0),
      glasses: Math.max(0, Number(parsed.glasses) || 0),
      lastDrinkAt: typeof parsed.lastDrinkAt === "number" ? parsed.lastDrinkAt : null,
      snoozeUntil: typeof parsed.snoozeUntil === "number" ? parsed.snoozeUntil : null,
    };
  } catch {
    return null;
  }
}

function writeProgress(progress: WaterProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage can be unavailable; progress then lasts for this session only.
  }
}

interface WaterStore {
  progress: WaterProgress;
  /** A reminder is showing and waits for "Drink". */
  reminderActive: boolean;
  load: () => void;
  /** Rolls the day over and raises the reminder when one is due. */
  tick: (settings: WaterSettings, now?: number) => void;
  drink: (settings: WaterSettings, now?: number) => void;
  snooze: (now?: number) => void;
  resetToday: () => void;
}

let storageListener = false;

export const useWaterStore = create<WaterStore>((set, get) => ({
  progress: emptyProgress(""),
  reminderActive: false,

  load: () => {
    const stored = readProgress();
    if (stored) set({ progress: stored });
    if (!storageListener && typeof window !== "undefined") {
      storageListener = true;
      window.addEventListener("storage", (event) => {
        if (event.key !== STORAGE_KEY) return;
        const next = readProgress();
        if (next) set({ progress: next });
      });
    }
  },

  tick: (settings, now = Date.now()) => {
    const window = currentWindow(now, settings.startTime);
    let { progress } = get();
    if (progress.dayKey !== window.dayKey) {
      progress = emptyProgress(window.dayKey);
      writeProgress(progress);
      set({ progress });
    }
    if (!settings.enabled) {
      if (get().reminderActive) set({ reminderActive: false });
      return;
    }
    const due = isDue({
      now,
      window,
      progress,
      targetMl: dailyTargetMl(settings.weightKg),
      glassMl: settings.glassMl,
    });
    // Once raised, the reminder stays until the user drinks or snoozes.
    if (due && !get().reminderActive) set({ reminderActive: true });
  },

  drink: (settings, now = Date.now()) => {
    const window = currentWindow(now, settings.startTime);
    const current = get().progress;
    const base = current.dayKey === window.dayKey ? current : emptyProgress(window.dayKey);
    const progress: WaterProgress = {
      ...base,
      consumedMl: base.consumedMl + settings.glassMl,
      glasses: base.glasses + 1,
      lastDrinkAt: now,
      snoozeUntil: null,
    };
    writeProgress(progress);
    set({ progress, reminderActive: false });
  },

  snooze: (now = Date.now()) => {
    const progress = { ...get().progress, snoozeUntil: now + SNOOZE_MINUTES * 60 * 1000 };
    writeProgress(progress);
    set({ progress, reminderActive: false });
  },

  resetToday: () => {
    const progress = emptyProgress(get().progress.dayKey);
    writeProgress(progress);
    set({ progress, reminderActive: false });
  },
}));
