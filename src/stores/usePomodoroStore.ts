import { create } from "zustand";

export type PomodoroMode = "work" | "shortBreak" | "longBreak";

export const POMODORO_DURATIONS: Record<PomodoroMode, number> = {
  work: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

interface PomodoroStore {
  mode: PomodoroMode;
  remainingSeconds: number;
  isRunning: boolean;
  cycle: number;
  totalCompleted: number;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  setMode: (mode: PomodoroMode) => void;
  tick: () => void;
}

let pomodoroInterval: ReturnType<typeof setInterval> | null = null;

export const usePomodoroStore = create<PomodoroStore>((set, get) => ({
  mode: "work",
  remainingSeconds: POMODORO_DURATIONS.work,
  isRunning: false,
  cycle: 1,
  totalCompleted: 0,

  start: () => {
    if (get().isRunning || get().remainingSeconds <= 0) return;
    set({ isRunning: true });

    if (pomodoroInterval) clearInterval(pomodoroInterval);
    pomodoroInterval = setInterval(() => {
      get().tick();
    }, 1000);
  },

  pause: () => {
    if (pomodoroInterval) {
      clearInterval(pomodoroInterval);
      pomodoroInterval = null;
    }
    set({ isRunning: false });
  },

  reset: () => {
    if (pomodoroInterval) {
      clearInterval(pomodoroInterval);
      pomodoroInterval = null;
    }
    const mode = get().mode;
    set({
      remainingSeconds: POMODORO_DURATIONS[mode],
      isRunning: false,
    });
  },

  setMode: (mode) => {
    if (pomodoroInterval) {
      clearInterval(pomodoroInterval);
      pomodoroInterval = null;
    }
    set({
      mode,
      remainingSeconds: POMODORO_DURATIONS[mode],
      isRunning: false,
    });
  },

  skip: () => {
    if (pomodoroInterval) {
      clearInterval(pomodoroInterval);
      pomodoroInterval = null;
    }
    const { mode, cycle, totalCompleted } = get();
    if (mode === "work") {
      const nextCycle = cycle >= 4 ? 1 : cycle + 1;
      const nextMode: PomodoroMode = cycle >= 4 ? "longBreak" : "shortBreak";
      set({
        mode: nextMode,
        remainingSeconds: POMODORO_DURATIONS[nextMode],
        isRunning: false,
        cycle: nextCycle,
        totalCompleted: totalCompleted + 1,
      });
    } else {
      set({
        mode: "work",
        remainingSeconds: POMODORO_DURATIONS.work,
        isRunning: false,
      });
    }
  },

  tick: () => {
    const current = get().remainingSeconds;
    if (current <= 1) {
      get().skip();
    } else {
      set({ remainingSeconds: current - 1 });
    }
  },
}));
