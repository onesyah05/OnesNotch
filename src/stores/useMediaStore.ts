import { create } from "zustand";
import { ipc, type MediaState } from "../lib/ipc";

export const DEFAULT_MEDIA_STATE: MediaState = {
  isPlaying: false,
  title: "",
  artist: "",
  album: "",
  appName: "",
  coverUrl: null,
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  isMuted: false,
  canPlayPause: true,
  canSkipNext: true,
  canSkipPrevious: true,
  canSeek: true,
};

interface MediaStore {
  media: MediaState;
  loading: boolean;
  load: () => Promise<void>;
  setMedia: (media: MediaState) => void;
  togglePlayPause: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;
  simulateTrack: (
    title?: string,
    artist?: string,
    album?: string,
    appName?: string,
    durationMs?: number,
  ) => void;
}

export const useMediaStore = create<MediaStore>((set, get) => ({
  media: DEFAULT_MEDIA_STATE,
  loading: false,

  setMedia: (media) => set({ media }),

  load: async () => {
    try {
      set({ loading: true });
      const current = await ipc.mediaGetState();
      set({ media: current, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  togglePlayPause: async () => {
    const current = get().media;
    // Optimistic UI update
    set({ media: { ...current, isPlaying: !current.isPlaying } });
    try {
      await ipc.mediaTogglePlayPause();
    } catch {
      // Revert if failed
      set({ media: current });
    }
  },

  play: async () => {
    const current = get().media;
    set({ media: { ...current, isPlaying: true } });
    try {
      await ipc.mediaPlay();
    } catch {
      set({ media: current });
    }
  },

  pause: async () => {
    const current = get().media;
    set({ media: { ...current, isPlaying: false } });
    try {
      await ipc.mediaPause();
    } catch {
      set({ media: current });
    }
  },

  next: async () => {
    try {
      await ipc.mediaNext();
    } catch {
      // Backend handles fallback
    }
  },

  previous: async () => {
    try {
      await ipc.mediaPrevious();
    } catch {
      // Backend handles fallback
    }
  },

  seek: async (positionMs: number) => {
    const current = get().media;
    set({ media: { ...current, positionMs } });
    try {
      await ipc.mediaSeek(positionMs);
    } catch {
      // ignore
    }
  },

  setVolume: async (volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    const current = get().media;
    set({ media: { ...current, volume: clamped, isMuted: clamped === 0 } });
    try {
      await ipc.mediaSetVolume(clamped);
    } catch {
      // ignore
    }
  },

  toggleMute: async () => {
    const current = get().media;
    set({ media: { ...current, isMuted: !current.isMuted } });
    try {
      const isMuted = await ipc.mediaToggleMute();
      set({ media: { ...get().media, isMuted } });
    } catch {
      set({ media: current });
    }
  },

  simulateTrack: (
    title = "Starboy",
    artist = "The Weeknd, Daft Punk",
    album = "Starboy",
    appName = "Spotify",
    durationMs = 230_000,
  ) => {
    set({
      media: {
        isPlaying: true,
        title,
        artist,
        album,
        appName,
        coverUrl: null,
        positionMs: 45_000,
        durationMs,
        volume: 0.85,
        isMuted: false,
        canPlayPause: true,
        canSkipNext: true,
        canSkipPrevious: true,
        canSeek: true,
      },
    });
  },
}));
