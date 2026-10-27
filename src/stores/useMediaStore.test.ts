import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MEDIA_STATE, useMediaStore } from "./useMediaStore";

const mediaTogglePlayPause = vi.fn();
const mediaPlay = vi.fn();
const mediaPause = vi.fn();
const mediaNext = vi.fn();
const mediaPrevious = vi.fn();
const mediaSeek = vi.fn();
const mediaSetVolume = vi.fn();
const mediaToggleMute = vi.fn();
const mediaGetState = vi.fn();

vi.mock("../lib/ipc", () => ({
  ipc: {
    mediaTogglePlayPause: () => mediaTogglePlayPause(),
    mediaPlay: () => mediaPlay(),
    mediaPause: () => mediaPause(),
    mediaNext: () => mediaNext(),
    mediaPrevious: () => mediaPrevious(),
    mediaSeek: (pos: number) => mediaSeek(pos),
    mediaSetVolume: (vol: number) => mediaSetVolume(vol),
    mediaToggleMute: () => mediaToggleMute(),
    mediaGetState: () => mediaGetState(),
  },
}));

describe("useMediaStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMediaStore.setState({
      media: { ...DEFAULT_MEDIA_STATE },
      loading: false,
    });
  });

  it("initializes with default media state", () => {
    const state = useMediaStore.getState().media;
    expect(state.isPlaying).toBe(false);
    expect(state.title).toBe("");
    expect(state.volume).toBe(0.8);
  });

  it("updates state upon simulation", () => {
    useMediaStore
      .getState()
      .simulateTrack("Blinding Lights", "The Weeknd", "After Hours", "Spotify");
    const state = useMediaStore.getState().media;
    expect(state.isPlaying).toBe(true);
    expect(state.title).toBe("Blinding Lights");
    expect(state.artist).toBe("The Weeknd");
    expect(state.appName).toBe("Spotify");
  });

  it("handles play, pause, and togglePlayPause", async () => {
    mediaTogglePlayPause.mockResolvedValue(undefined);
    await useMediaStore.getState().togglePlayPause();
    expect(useMediaStore.getState().media.isPlaying).toBe(true);

    mediaPause.mockResolvedValue(undefined);
    await useMediaStore.getState().pause();
    expect(useMediaStore.getState().media.isPlaying).toBe(false);

    mediaPlay.mockResolvedValue(undefined);
    await useMediaStore.getState().play();
    expect(useMediaStore.getState().media.isPlaying).toBe(true);
  });

  it("handles volume adjustments and muting", async () => {
    mediaSetVolume.mockResolvedValue(undefined);
    await useMediaStore.getState().setVolume(0.5);
    expect(useMediaStore.getState().media.volume).toBe(0.5);
    expect(useMediaStore.getState().media.isMuted).toBe(false);

    mediaToggleMute.mockResolvedValue(true);
    await useMediaStore.getState().toggleMute();
    expect(useMediaStore.getState().media.isMuted).toBe(true);
  });

  it("handles seek timeline", async () => {
    mediaSeek.mockResolvedValue(undefined);
    await useMediaStore.getState().seek(60_000);
    expect(useMediaStore.getState().media.positionMs).toBe(60_000);
  });
});
