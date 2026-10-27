import { create } from "zustand";

export interface VideoItem {
  id: string;
  name: string;
  path: string;
  addedAt: number;
}

export interface VideoSettings {
  enabled: boolean;
  intervalSeconds: number; // Interval pemutaran otomatis (dalam detik)
  durationSeconds: number; // Durasi tampil (dalam detik, 0 = sampai video selesai)
  muted: boolean; // default: true
  objectFit: "cover" | "contain";
  videos: VideoItem[];
}

const STORAGE_KEY = "notch_video_settings";
const CHANNEL_NAME = "notch_video_sync_channel";

const DEFAULT_SETTINGS: VideoSettings = {
  enabled: false,
  intervalSeconds: 60,
  durationSeconds: 10,
  muted: true,
  objectFit: "cover",
  videos: [],
};

// Preset sample online clips untuk testing cepat
export const SAMPLE_VIDEOS: Array<{ name: string; path: string }> = [
  {
    name: "Abstract Neon Flow (Sample)",
    path: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  },
  {
    name: "Liquid Motion Loop (Sample)",
    path: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  },
];

interface VideoState {
  settings: VideoSettings;
  activePlayingVideo: VideoItem | null;
  lastPlayedId: string | null;

  // Actions
  load: () => void;
  updateSettings: (patch: Partial<VideoSettings>) => void;
  addVideosFromPaths: (paths: string[]) => void;
  addVideoUrl: (name: string, path: string) => void;
  addSampleVideos: () => void;
  removeVideo: (id: string) => void;
  clearVideos: () => void;
  triggerRandomPlay: () => VideoItem | null;
  testPlayVideo: (video: VideoItem) => void;
  stopPlaying: () => void;
}

function loadInitialSettings(): VideoSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VideoSettings>;
      return {
        enabled: Boolean(parsed.enabled),
        intervalSeconds: Math.max(5, Number(parsed.intervalSeconds) || 60),
        durationSeconds: Math.max(0, Number(parsed.durationSeconds ?? 10)),
        muted: parsed.muted !== undefined ? Boolean(parsed.muted) : true,
        objectFit: parsed.objectFit === "contain" ? "contain" : "cover",
        videos: Array.isArray(parsed.videos) ? parsed.videos : [],
      };
    }
  } catch {
    // ignore parse error
  }
  return DEFAULT_SETTINGS;
}

function saveToLocalStorage(settings: VideoSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // Broadcast via BroadcastChannel so Notch and Settings windows stay in sync immediately
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage({ type: "SETTINGS_UPDATED", settings });
      bc.close();
    }
  } catch {
    // ignore storage error
  }
}

function broadcastPlay(video: VideoItem | null): void {
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage({ type: "PLAY_VIDEO", video });
      bc.close();
    }
  } catch {
    // ignore
  }
}

let syncInitialized = false;

export const useVideoStore = create<VideoState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  activePlayingVideo: null,
  lastPlayedId: null,

  load: () => {
    const loaded = loadInitialSettings();
    set({ settings: loaded });

    if (!syncInitialized && typeof window !== "undefined") {
      syncInitialized = true;

      // Listen via BroadcastChannel across webviews
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel(CHANNEL_NAME);
        bc.onmessage = (event) => {
          const data = event.data;
          if (data?.type === "SETTINGS_UPDATED" && data.settings) {
            set({ settings: data.settings });
          } else if (data?.type === "PLAY_VIDEO") {
            set({ activePlayingVideo: data.video });
          }
        };
      }

      // Storage event listener fallback
      window.addEventListener("storage", (e) => {
        if (e.key === STORAGE_KEY && e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue) as VideoSettings;
            set({ settings: parsed });
          } catch {
            // ignore
          }
        }
      });
    }
  },

  updateSettings: (patch) => {
    const current = get().settings;
    const next: VideoSettings = { ...current, ...patch };
    set({ settings: next });
    saveToLocalStorage(next);
  },

  addVideosFromPaths: (paths: string[]) => {
    const current = get().settings;
    const existingPaths = new Set(current.videos.map((v) => v.path.toLowerCase()));

    const newItems: VideoItem[] = [];
    for (const p of paths) {
      const normalized = p.trim();
      if (!normalized || existingPaths.has(normalized.toLowerCase())) {
        continue;
      }
      // Extract file name from path
      const parts = normalized.split(/[/\\]/);
      const fileName = parts[parts.length - 1] || normalized;

      newItems.push({
        id: `vid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: fileName,
        path: normalized,
        addedAt: Date.now(),
      });
      existingPaths.add(normalized.toLowerCase());
    }

    if (newItems.length > 0) {
      const updatedVideos = [...current.videos, ...newItems];
      const next: VideoSettings = { ...current, videos: updatedVideos };
      set({ settings: next });
      saveToLocalStorage(next);
    }
  },

  addVideoUrl: (name: string, path: string) => {
    const current = get().settings;
    const item: VideoItem = {
      id: `vid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim() || "Video",
      path: path.trim(),
      addedAt: Date.now(),
    };
    const next: VideoSettings = { ...current, videos: [...current.videos, item] };
    set({ settings: next });
    saveToLocalStorage(next);
  },

  addSampleVideos: () => {
    const current = get().settings;
    const existingPaths = new Set(current.videos.map((v) => v.path.toLowerCase()));
    const toAdd: VideoItem[] = [];

    for (const sample of SAMPLE_VIDEOS) {
      if (!existingPaths.has(sample.path.toLowerCase())) {
        toAdd.push({
          id: `vid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: sample.name,
          path: sample.path,
          addedAt: Date.now(),
        });
        existingPaths.add(sample.path.toLowerCase());
      }
    }

    if (toAdd.length > 0) {
      const next: VideoSettings = { ...current, videos: [...current.videos, ...toAdd] };
      set({ settings: next });
      saveToLocalStorage(next);
    }
  },

  removeVideo: (id: string) => {
    const current = get().settings;
    const filtered = current.videos.filter((v) => v.id !== id);
    const next: VideoSettings = { ...current, videos: filtered };
    set({ settings: next });
    saveToLocalStorage(next);
    if (get().activePlayingVideo?.id === id) {
      get().stopPlaying();
    }
  },

  clearVideos: () => {
    const current = get().settings;
    const next: VideoSettings = { ...current, videos: [] };
    set({ settings: next });
    saveToLocalStorage(next);
    get().stopPlaying();
  },

  triggerRandomPlay: () => {
    const { settings, lastPlayedId } = get();
    if (!settings.enabled || settings.videos.length === 0) {
      return null;
    }

    const videos = settings.videos;
    const first = videos[0];
    if (!first) {
      return null;
    }

    let chosen: VideoItem = first;

    if (videos.length > 1) {
      // Pick a random video, preferably different from the last one played
      const candidates = videos.filter((v) => v.id !== lastPlayedId);
      const pool = candidates.length > 0 ? candidates : videos;
      const index = Math.floor(Math.random() * pool.length);
      const randomItem = pool[index];
      if (randomItem) {
        chosen = randomItem;
      }
    }

    set({ activePlayingVideo: chosen, lastPlayedId: chosen.id });
    broadcastPlay(chosen);
    return chosen;
  },

  testPlayVideo: (video: VideoItem) => {
    set({ activePlayingVideo: video, lastPlayedId: video.id });
    broadcastPlay(video);
  },

  stopPlaying: () => {
    set({ activePlayingVideo: null });
    broadcastPlay(null);
  },
}));
