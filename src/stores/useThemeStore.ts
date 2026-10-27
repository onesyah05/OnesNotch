import { create } from "zustand";
import { ipc, type ThemeSettings } from "../lib/ipc";

export const DEFAULT_THEME: ThemeSettings = {
  backgroundColor: "#111522",
  accentColor: "#22D3EE",
};

export const ACCENT_PRESETS = [
  { name: "Cyan", value: "#22D3EE" },
  { name: "Sapphire", value: "#3B82F6" },
  { name: "Neon Violet", value: "#A855F7" },
  { name: "Rose Pink", value: "#F43F5E" },
  { name: "Emerald", value: "#10B981" },
  { name: "Sunset Orange", value: "#F97316" },
  { name: "Amber Gold", value: "#F59E0B" },
];

export const BG_PRESETS = [
  { name: "Dark Navy", value: "#111522" },
  { name: "Pitch Black", value: "#000000" },
  { name: "Midnight Blue", value: "#0B132B" },
  { name: "Deep Slate", value: "#18181B" },
  { name: "Dark Plum", value: "#160B24" },
  { name: "Obsidian Forest", value: "#0B1A14" },
];

export function applyThemeToCss(theme: ThemeSettings): void {
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty(
      "--notch-bg",
      theme.backgroundColor || DEFAULT_THEME.backgroundColor,
    );
    document.documentElement.style.setProperty(
      "--notch-accent",
      theme.accentColor || DEFAULT_THEME.accentColor,
    );
  }
}

interface ThemeStore {
  theme: ThemeSettings;
  loading: boolean;
  setTheme: (theme: ThemeSettings) => void;
  setBackgroundColor: (backgroundColor: string) => Promise<void>;
  setAccentColor: (accentColor: string) => Promise<void>;
  resetDefaults: () => Promise<void>;
  load: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: DEFAULT_THEME,
  loading: false,

  setTheme: (theme) => {
    applyThemeToCss(theme);
    set({ theme });
  },

  setBackgroundColor: async (backgroundColor) => {
    const prev = get().theme;
    const next = { ...prev, backgroundColor };
    get().setTheme(next);
    try {
      const updated = await ipc.themeSet(backgroundColor, undefined);
      get().setTheme(updated);
    } catch {
      // Revert if failed
      get().setTheme(prev);
    }
  },

  setAccentColor: async (accentColor) => {
    const prev = get().theme;
    const next = { ...prev, accentColor };
    get().setTheme(next);
    try {
      const updated = await ipc.themeSet(undefined, accentColor);
      get().setTheme(updated);
    } catch {
      // Revert if failed
      get().setTheme(prev);
    }
  },

  resetDefaults: async () => {
    get().setTheme(DEFAULT_THEME);
    try {
      const updated = await ipc.themeSet(DEFAULT_THEME.backgroundColor, DEFAULT_THEME.accentColor);
      get().setTheme(updated);
    } catch {
      // keep default in memory
    }
  },

  load: async () => {
    try {
      set({ loading: true });
      const settings = await ipc.settingsGet();
      if (settings?.theme) {
        get().setTheme(settings.theme);
      }
      set({ loading: false });
    } catch {
      applyThemeToCss(DEFAULT_THEME);
      set({ loading: false });
    }
  },
}));
