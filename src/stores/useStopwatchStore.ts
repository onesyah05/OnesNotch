import { create } from "zustand";

interface StopwatchStore {
  elapsedMs: number;
  isRunning: boolean;
  startTime: number | null;
  laps: number[];
  start: () => void;
  pause: () => void;
  reset: () => void;
  lap: () => void;
  tick: () => void;
}

let timerInterval: ReturnType<typeof setInterval> | null = null;

export const useStopwatchStore = create<StopwatchStore>((set, get) => ({
  elapsedMs: 0,
  isRunning: false,
  startTime: null,
  laps: [],

  start: () => {
    if (get().isRunning) return;
    const now = Date.now();
    const currentElapsed = get().elapsedMs;
    set({
      isRunning: true,
      startTime: now - currentElapsed,
    });

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      get().tick();
    }, 25);
  },

  pause: () => {
    if (!get().isRunning) return;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    const startTime = get().startTime;
    const elapsedMs = startTime ? Date.now() - startTime : get().elapsedMs;
    set({
      isRunning: false,
      elapsedMs,
      startTime: null,
    });
  },

  reset: () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    set({
      elapsedMs: 0,
      isRunning: false,
      startTime: null,
      laps: [],
    });
  },

  lap: () => {
    const { elapsedMs, laps } = get();
    if (elapsedMs === 0) return;
    const lastLapTotal = laps.reduce((acc, curr) => acc + curr, 0);
    const lapTime = elapsedMs - lastLapTotal;
    set({ laps: [lapTime, ...laps] });
  },

  tick: () => {
    const startTime = get().startTime;
    if (startTime && get().isRunning) {
      set({ elapsedMs: Date.now() - startTime });
    }
  },
}));
