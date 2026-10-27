import { beforeEach, describe, expect, it } from "vitest";
import { useVideoStore } from "./useVideoStore";

describe("useVideoStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useVideoStore.setState({
      settings: {
        enabled: false,
        intervalSeconds: 60,
        durationSeconds: 10,
        muted: true,
        objectFit: "cover",
        videos: [],
      },
      activePlayingVideo: null,
      lastPlayedId: null,
    });
  });

  it("updates video settings and stores them in localStorage", () => {
    useVideoStore.getState().updateSettings({
      enabled: true,
      intervalSeconds: 30,
      durationSeconds: 15,
      muted: false,
    });

    const current = useVideoStore.getState().settings;
    expect(current.enabled).toBe(true);
    expect(current.intervalSeconds).toBe(30);
    expect(current.durationSeconds).toBe(15);
    expect(current.muted).toBe(false);

    const saved = JSON.parse(localStorage.getItem("notch_video_settings") || "{}");
    expect(saved.enabled).toBe(true);
    expect(saved.intervalSeconds).toBe(30);
  });

  it("adds videos from multiple file paths without duplicates", () => {
    useVideoStore.getState().addVideosFromPaths([
      "C:\\Videos\\clip1.mp4",
      "C:\\Videos\\clip2.mp4",
      "C:\\Videos\\clip1.mp4", // duplicate
    ]);

    const videos = useVideoStore.getState().settings.videos;
    expect(videos.length).toBe(2);
    expect(videos[0]?.name).toBe("clip1.mp4");
    expect(videos[0]?.path).toBe("C:\\Videos\\clip1.mp4");
    expect(videos[1]?.name).toBe("clip2.mp4");
  });

  it("adds demo sample videos", () => {
    useVideoStore.getState().addSampleVideos();
    const videos = useVideoStore.getState().settings.videos;
    expect(videos.length).toBeGreaterThanOrEqual(1);
    expect(videos[0]?.path).toContain("http");
  });

  it("triggers random video play when enabled", () => {
    useVideoStore.getState().updateSettings({ enabled: true });
    useVideoStore.getState().addVideosFromPaths(["C:\\v1.mp4", "C:\\v2.mp4"]);

    const played = useVideoStore.getState().triggerRandomPlay();
    expect(played).not.toBeNull();
    expect(useVideoStore.getState().activePlayingVideo?.id).toBe(played?.id);

    useVideoStore.getState().stopPlaying();
    expect(useVideoStore.getState().activePlayingVideo).toBeNull();
  });

  it("removes video and clears all videos", () => {
    useVideoStore.getState().addVideosFromPaths(["C:\\v1.mp4", "C:\\v2.mp4"]);
    const idToRemove = useVideoStore.getState().settings.videos[0]?.id;
    expect(idToRemove).toBeDefined();

    if (idToRemove) {
      useVideoStore.getState().removeVideo(idToRemove);
      expect(useVideoStore.getState().settings.videos.length).toBe(1);
    }

    useVideoStore.getState().clearVideos();
    expect(useVideoStore.getState().settings.videos.length).toBe(0);
  });
});
