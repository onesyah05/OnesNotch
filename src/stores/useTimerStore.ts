import { create } from "zustand";

interface TimerStore {
  durationSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  isCompleted: boolean;
  setDuration: (seconds: number) => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
  addSeconds: (seconds: number) => void;
  tick: () => void;
}

let timerInterval: ReturnType<typeof setInterval> | null = null;

export const useTimerStore = create<TimerStore>((set, get) => ({
  durationSeconds: 300, // 5 min default
  remainingSeconds: 300,
  isRunning: false,
  isCompleted: false,

  setDuration: (seconds) => {
    if (timerInterval) clearInterval(timerInterval);
    set({
      durationSeconds: seconds,
      remainingSeconds: seconds,
      isRunning: false,
      isCompleted: false,
    });
  },

  start: () => {
    if (get().isRunning || get().remainingSeconds <= 0) return;
    set({ isRunning: true, isCompleted: false });

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      get().tick();
    }, 1000);
  },

  pause: () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    set({ isRunning: false });
  },

  reset: () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    set({
      remainingSeconds: get().durationSeconds,
      isRunning: false,
      isCompleted: false,
    });
  },

  addSeconds: (seconds) => {
    const next = get().remainingSeconds + seconds;
    const nextDuration = Math.max(get().durationSeconds, next);
    set({
      remainingSeconds: next,
      durationSeconds: nextDuration,
      isCompleted: false,
    });
  },

  tick: () => {
    const current = get().remainingSeconds;
    if (current <= 1) {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      set({ remainingSeconds: 0, isRunning: false, isCompleted: true });
    } else {
      set({ remainingSeconds: current - 1 });
    }
  },
}));
