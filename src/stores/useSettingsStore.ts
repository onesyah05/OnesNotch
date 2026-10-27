import { create } from "zustand";
import { ipc, toAppError, type AppError, type SettingsView } from "../lib/ipc";

interface SettingsStore {
  settings: SettingsView | null;
  load: () => Promise<void>;
  /**
   * Runs a settings command and stores the view it returns.
   * Resolves to the error instead of throwing, so forms can show it inline.
   */
  apply: (request: () => Promise<SettingsView>) => Promise<AppError | null>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: null,
  load: async () => {
    try {
      set({ settings: await ipc.settingsGet() });
    } catch {
      // Browser-only dev has no backend.
    }
  },
  apply: async (request) => {
    try {
      set({ settings: await request() });
      return null;
    } catch (err) {
      return toAppError(err);
    }
  },
}));
