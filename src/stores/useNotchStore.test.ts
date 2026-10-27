import { beforeEach, describe, expect, it, vi } from "vitest";

const appStatus = vi.fn();

vi.mock("../lib/ipc", () => ({
  ipc: { appStatus: () => appStatus() },
}));

import { useNotchStore } from "./useNotchStore";

describe("useNotchStore", () => {
  beforeEach(() => {
    appStatus.mockReset();
    useNotchStore.setState({
      state: "idle",
      tab: "ai",
      visibleInCapture: false,
      opacity: 100,
      panic: false,
      hydrated: false,
    });
  });

  it("starts idle and hidden from capture", () => {
    const s = useNotchStore.getState();
    expect(s.state).toBe("idle");
    expect(s.visibleInCapture).toBe(false);
  });

  it("switches state and tab", () => {
    useNotchStore.getState().setState("expanded");
    useNotchStore.getState().setTab("music");
    const s = useNotchStore.getState();
    expect(s.state).toBe("expanded");
    expect(s.tab).toBe("music");
  });

  it("hydrates from the backend status", async () => {
    appStatus.mockResolvedValue({
      state: "expanded",
      visibleInCapture: true,
      opacity: 70,
      panic: true,
    });

    await useNotchStore.getState().hydrate();

    const s = useNotchStore.getState();
    expect(s.state).toBe("expanded");
    expect(s.visibleInCapture).toBe(true);
    expect(s.opacity).toBe(70);
    expect(s.panic).toBe(true);
    expect(s.hydrated).toBe(true);
  });

  it("marks itself hydrated even if the backend call fails", async () => {
    appStatus.mockRejectedValue(new Error("offline"));

    await useNotchStore.getState().hydrate();

    expect(useNotchStore.getState().hydrated).toBe(true);
  });
});
