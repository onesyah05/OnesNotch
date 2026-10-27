import { create } from "zustand";
import { ipc, type PortInfo } from "../lib/ipc";

interface PortStore {
  ports: PortInfo[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  loadPorts: () => Promise<void>;
  killPortProcess: (pid: number) => Promise<boolean>;
  setSearchQuery: (query: string) => void;
}

export const usePortStore = create<PortStore>((set, get) => ({
  ports: [],
  isLoading: false,
  error: null,
  searchQuery: "",

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  loadPorts: async () => {
    set({ isLoading: true, error: null });
    try {
      const active = await ipc.portsGetActive();
      set({ ports: active, isLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, isLoading: false });
    }
  },

  killPortProcess: async (pid: number) => {
    try {
      await ipc.portsKillProcess(pid);
      // Remove killed process's ports immediately from store
      set({
        ports: get().ports.filter((p) => p.pid !== pid),
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      return false;
    }
  },
}));
