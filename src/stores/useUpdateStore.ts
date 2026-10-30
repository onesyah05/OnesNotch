import { create } from "zustand";
import { ipc, toAppError, type AppError, type UpdateInfo } from "../lib/ipc";

/** Versions the user chose "Later" for; the notch stops nagging about them. */
const DISMISSED_KEY = "notch_update_dismissed";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export type UpdatePhase = "idle" | "checking" | "downloading" | "installing";

interface UpdateStore {
  info: UpdateInfo | null;
  phase: UpdatePhase;
  /** 0-1 while downloading; null when the size is unknown. */
  progress: number | null;
  error: AppError | null;
  /** Set after a manual check that found nothing, for the "up to date" note. */
  checkedAt: number | null;
  dismissedVersion: string | null;
  setInfo: (info: UpdateInfo | null) => void;
  load: () => Promise<void>;
  check: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  info: null,
  phase: "idle",
  progress: null,
  error: null,
  checkedAt: null,
  dismissedVersion: readDismissed(),

  setInfo: (info) => set({ info }),

  load: async () => {
    try {
      set({ info: await ipc.updateStatus() });
    } catch {
      // Browser-only dev has no backend.
    }
  },

  check: async () => {
    if (get().phase !== "idle") return;
    set({ phase: "checking", error: null });
    try {
      const info = await ipc.updateCheck();
      set({ info, phase: "idle", checkedAt: Date.now() });
    } catch (err) {
      set({ phase: "idle", error: toAppError(err) });
    }
  },

  install: async () => {
    if (get().phase !== "idle" || !get().info) return;
    set({ phase: "downloading", progress: null, error: null });
    try {
      await ipc.updateInstall((event) => {
        if (event.type === "progress") {
          set({ progress: event.total ? Math.min(1, event.downloaded / event.total) : null });
        } else {
          set({ phase: "installing", progress: 1 });
        }
      });
    } catch (err) {
      set({ phase: "idle", progress: null, error: toAppError(err) });
    }
  },

  dismiss: () => {
    const version = get().info?.version ?? null;
    if (!version) return;
    try {
      localStorage.setItem(DISMISSED_KEY, version);
    } catch {
      // Without storage the pill simply returns on the next start.
    }
    set({ dismissedVersion: version });
  },
}));

/** The notch shows the update pill for a version the user has not dismissed. */
export function shouldShowUpdatePill(
  state: Pick<UpdateStore, "info" | "dismissedVersion" | "phase">,
): boolean {
  if (!state.info) return false;
  return state.phase !== "idle" || state.info.version !== state.dismissedVersion;
}
