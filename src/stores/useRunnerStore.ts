import { create } from "zustand";
import { ipc, type RunRequest } from "../lib/ipc";

export interface AppPreset {
  id: string;
  name: string;
  command: string; // Command Start
  commandStop?: string; // Command Stop (opsional, default: Ctrl+C)
  directory?: string;
  terminal?: "auto" | "wt" | "powershell" | "cmd";
  mode?: "terminal" | "background";
  color?: string;
  createdAt: number;
  lastRunAt?: number;
  runningPid?: number;
  isRunning?: boolean;
}

const STORAGE_KEY = "notch_runner_presets";

const DEFAULT_PRESETS: AppPreset[] = [
  {
    id: "preset-vite-dev",
    name: "Vite Dev Server",
    command: "npm run dev",
    terminal: "auto",
    mode: "terminal",
    color: "#22d3ee",
    createdAt: Date.now() - 3600000,
  },
  {
    id: "preset-tauri-dev",
    name: "Tauri Desktop",
    command: "cargo tauri dev",
    terminal: "auto",
    mode: "terminal",
    color: "#f59e0b",
    createdAt: Date.now() - 1800000,
  },
  {
    id: "preset-docker",
    name: "Docker Services",
    command: "docker compose up",
    terminal: "auto",
    mode: "terminal",
    color: "#3b82f6",
    createdAt: Date.now() - 900000,
  },
];

function loadSavedPresets(): AppPreset[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_PRESETS;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRESETS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}

function persistPresets(presets: AppPreset[]) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage write issues
  }
}

export interface RunnerState {
  apps: AppPreset[];
  searchQuery: string;
  executingId: string | null;
  error: string | null;

  setSearchQuery: (query: string) => void;
  addApp: (app: Omit<AppPreset, "id" | "createdAt">) => AppPreset;
  updateApp: (id: string, updates: Partial<Omit<AppPreset, "id" | "createdAt">>) => void;
  deleteApp: (id: string) => void;
  runApp: (id: string) => Promise<boolean>;
  stopApp: (id: string) => Promise<boolean>;
  openAppDirectory: (dir: string) => Promise<boolean>;
  pickDirectory: () => Promise<string | null>;
  reorderApps: (newApps: AppPreset[]) => void;
  resetDefaults: () => void;
}

export const useRunnerStore = create<RunnerState>((set, get) => ({
  apps: loadSavedPresets(),
  searchQuery: "",
  executingId: null,
  error: null,

  setSearchQuery: (query) => set({ searchQuery: query }),

  addApp: (appData) => {
    const newApp: AppPreset = {
      ...appData,
      id: `app-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: Date.now(),
    };
    const next = [newApp, ...get().apps];
    persistPresets(next);
    set({ apps: next, error: null });
    return newApp;
  },

  updateApp: (id, updates) => {
    const next = get().apps.map((app) => (app.id === id ? { ...app, ...updates } : app));
    persistPresets(next);
    set({ apps: next });
  },

  deleteApp: (id) => {
    const next = get().apps.filter((app) => app.id !== id);
    persistPresets(next);
    set({ apps: next });
  },

  runApp: async (id) => {
    const app = get().apps.find((a) => a.id === id);
    if (!app) return false;

    set({ executingId: id, error: null });

    const req: RunRequest = {
      command: app.command,
      commandStop: app.commandStop?.trim() || undefined,
      directory: app.directory?.trim() || undefined,
      terminal: app.terminal ?? "auto",
      mode: app.mode ?? "terminal",
    };

    try {
      const res = await ipc.runnerExecute(req);
      const next = get().apps.map((a) =>
        a.id === id
          ? {
              ...a,
              lastRunAt: Date.now(),
              runningPid: res.pid ?? a.runningPid,
              isRunning: true,
            }
          : a,
      );
      persistPresets(next);
      set({ apps: next, executingId: null, error: null });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ executingId: null, error: msg });
      return false;
    }
  },

  stopApp: async (id) => {
    const app = get().apps.find((a) => a.id === id);
    if (!app) return false;

    try {
      await ipc.runnerStopApp({
        pid: app.runningPid,
        commandStop: app.commandStop?.trim() || undefined,
        directory: app.directory?.trim() || undefined,
      });
      const next = get().apps.map((a) =>
        a.id === id ? { ...a, runningPid: undefined, isRunning: false } : a,
      );
      persistPresets(next);
      set({ apps: next });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return false;
    }
  },

  openAppDirectory: async (dir) => {
    if (!dir || !dir.trim()) return false;
    try {
      await ipc.runnerOpenDirectory(dir.trim());
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return false;
    }
  },

  pickDirectory: async () => {
    try {
      const selected = await ipc.runnerPickDirectory();
      return selected;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return null;
    }
  },

  reorderApps: (newApps) => {
    persistPresets(newApps);
    set({ apps: newApps });
  },

  resetDefaults: () => {
    persistPresets(DEFAULT_PRESETS);
    set({ apps: DEFAULT_PRESETS });
  },
}));
