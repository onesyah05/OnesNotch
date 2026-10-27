import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { NotchState } from "../lib/ipc";

export type { NotchState };

export type NotchTab = "ai" | "music" | "notifications" | "tools";

interface NotchStore {
  state: NotchState;
  tab: NotchTab;
  /** Mirrors the backend flag and always starts false (AGENTS.md rule 2). */
  visibleInCapture: boolean;
  /** Percent, mirrors the backend clamp of 30-100. */
  opacity: number;
  panic: boolean;
  /** False until the backend status has been read once. */
  hydrated: boolean;
  setState: (state: NotchState) => void;
  setTab: (tab: NotchTab) => void;
  setVisibleInCapture: (visible: boolean) => void;
  setOpacity: (opacity: number) => void;
  setPanic: (panic: boolean) => void;
  hydrate: () => Promise<void>;
}

export const useNotchStore = create<NotchStore>((set) => ({
  state: "idle",
  tab: "ai",
  visibleInCapture: false,
  opacity: 100,
  panic: false,
  hydrated: false,
  setState: (state) => set({ state }),
  setTab: (tab) => set({ tab }),
  setVisibleInCapture: (visibleInCapture) => set({ visibleInCapture }),
  setOpacity: (opacity) => set({ opacity }),
  setPanic: (panic) => set({ panic }),
  hydrate: async () => {
    try {
      const status = await ipc.appStatus();
      set({
        state: status.state,
        visibleInCapture: status.visibleInCapture,
        opacity: status.opacity,
        panic: status.panic,
        hydrated: true,
      });
    } catch {
      // Browser-only dev has no backend; keep the safe defaults.
      set({ hydrated: true });
    }
  },
}));
