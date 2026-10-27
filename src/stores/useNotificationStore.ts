import { create } from "zustand";
import { ipc, type AppNotification, type NotificationSettings } from "../lib/ipc";

interface NotificationStore {
  notifications: AppNotification[];
  activePopup: AppNotification | null;
  settings: NotificationSettings;
  loading: boolean;
  dndModalOpen: boolean;

  setNotifications: (notifications: AppNotification[]) => void;
  setActivePopup: (notification: AppNotification | null) => void;
  setDndModalOpen: (open: boolean) => void;

  load: () => Promise<void>;
  dismissPopup: () => void;
  dismissNotification: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  openApp: (notification: AppNotification) => Promise<boolean>;
  toggleDnd: () => Promise<void>;
  updateSettings: (patch: Partial<NotificationSettings>) => Promise<void>;
  simulateNotification: (appName?: string, title?: string, body?: string) => Promise<void>;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  dndEnabled: false,
  autoDismissSeconds: 5,
  allowedApps: ["WhatsApp", "Telegram", "Discord", "Slack", "Teams"],
};

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  activePopup: null,
  settings: DEFAULT_SETTINGS,
  loading: false,
  dndModalOpen: false,

  setNotifications: (notifications) => set({ notifications }),
  setActivePopup: (activePopup) => set({ activePopup }),
  setDndModalOpen: (dndModalOpen) => set({ dndModalOpen }),

  load: async () => {
    try {
      set({ loading: true });
      const [list, settingsView] = await Promise.all([ipc.notificationList(), ipc.settingsGet()]);
      set({
        notifications: list,
        settings: settingsView.notifications ?? DEFAULT_SETTINGS,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  dismissPopup: () => {
    set({ activePopup: null });
  },

  dismissNotification: async (id: string) => {
    // Optimistic update
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
      activePopup: state.activePopup?.id === id ? null : state.activePopup,
    }));
    try {
      await ipc.notificationDismiss(id);
    } catch {
      // Re-sync on failure
      void get().load();
    }
  },

  clearAll: async () => {
    set({ notifications: [], activePopup: null });
    try {
      await ipc.notificationClearAll();
    } catch {
      void get().load();
    }
  },

  openApp: async (notification: AppNotification) => {
    get().dismissPopup();
    try {
      const success = await ipc.notificationOpenApp(notification.appName, notification.appId);
      // Mark as read / dismissed from popup
      return success;
    } catch {
      return false;
    }
  },

  toggleDnd: async () => {
    const current = get().settings;
    const next = { ...current, dndEnabled: !current.dndEnabled };
    set({ settings: next });
    try {
      await ipc.notificationUpdateSettings(next);
    } catch {
      // Keep optimistic update in browser/test environment
    }
  },

  updateSettings: async (patch: Partial<NotificationSettings>) => {
    const current = get().settings;
    const next = { ...current, ...patch };
    set({ settings: next });
    try {
      await ipc.notificationUpdateSettings(next);
    } catch {
      // Keep optimistic update in browser/test environment
    }
  },

  simulateNotification: async (
    appName = "WhatsApp",
    title = "Rian Pratama",
    body = "Halo! Besok rapat jam 10 pagi jangan lupa ya.",
  ) => {
    const mock: AppNotification = {
      id: "sim-" + Date.now(),
      appName,
      title,
      body,
      timestamp: Date.now(),
      read: false,
    };
    try {
      await ipc.notificationSimulate(mock);
    } catch {
      // If IPC fails (e.g. dev browser), simulate directly in store
      const shouldPopup = get().settings.dndEnabled
        ? get().settings.allowedApps.some(
            (a) =>
              appName.toLowerCase().includes(a.toLowerCase()) ||
              a.toLowerCase().includes(appName.toLowerCase()),
          )
        : true;
      set((state) => ({
        notifications: [mock, ...state.notifications],
        activePopup: shouldPopup ? mock : state.activePopup,
      }));
    }
  },
}));
