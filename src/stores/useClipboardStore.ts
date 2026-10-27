import { create } from "zustand";
import { ipc, type ClipboardItem } from "../lib/ipc";

interface ClipboardStore {
  items: ClipboardItem[];
  loading: boolean;
  searchQuery: string;
  copiedId: string | null;
  load: () => Promise<void>;
  addItem: (item: ClipboardItem) => void;
  copy: (item: ClipboardItem) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  setSearchQuery: (query: string) => void;
}

export const useClipboardStore = create<ClipboardStore>((set, get) => ({
  items: [],
  loading: false,
  searchQuery: "",
  copiedId: null,

  load: async () => {
    try {
      set({ loading: true });
      const items = await ipc.clipboardGetHistory();
      set({ items, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  addItem: (item) => {
    set((state) => {
      const exists = state.items.some((i) => i.id === item.id || i.text === item.text);
      if (exists) {
        return {
          items: [item, ...state.items.filter((i) => i.id !== item.id && i.text !== item.text)],
        };
      }
      return { items: [item, ...state.items.slice(0, 49)] };
    });
  },

  copy: async (item) => {
    try {
      await ipc.clipboardWrite(item.text);
      set({ copiedId: item.id });
      setTimeout(() => {
        if (get().copiedId === item.id) {
          set({ copiedId: null });
        }
      }, 1500);
    } catch {
      // ignore
    }
  },

  copyText: async (text) => {
    try {
      await ipc.clipboardWrite(text);
    } catch {
      // ignore
    }
  },

  deleteItem: async (id) => {
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
    try {
      await ipc.clipboardDeleteItem(id);
    } catch {
      // ignore
    }
  },

  clearAll: async () => {
    set({ items: [] });
    try {
      await ipc.clipboardClearHistory();
    } catch {
      // ignore
    }
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
