import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateEvent, UpdateInfo } from "../lib/ipc";

const info: UpdateInfo = { version: "0.3.0", currentVersion: "0.2.0", notes: null, dateMs: null };

const ipcMock = vi.hoisted(() => ({
  updateStatus: vi.fn(),
  updateCheck: vi.fn(),
  updateInstall: vi.fn(),
}));

vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return { ...actual, ipc: { ...actual.ipc, ...ipcMock } };
});

import { shouldShowUpdatePill, useUpdateStore } from "./useUpdateStore";

describe("useUpdateStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useUpdateStore.setState({
      info: null,
      phase: "idle",
      progress: null,
      error: null,
      checkedAt: null,
      dismissedVersion: null,
    });
  });

  it("stores the result of a manual check", async () => {
    ipcMock.updateCheck.mockResolvedValue(info);
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().info).toEqual(info);
    expect(useUpdateStore.getState().phase).toBe("idle");
    expect(useUpdateStore.getState().checkedAt).not.toBeNull();
  });

  it("keeps the error when a check fails", async () => {
    ipcMock.updateCheck.mockRejectedValue({ code: "update_failed", message: "offline" });
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().error?.code).toBe("update_failed");
  });

  it("reports download progress and the installing phase", async () => {
    useUpdateStore.setState({ info });
    ipcMock.updateInstall.mockImplementation(async (onEvent: (e: UpdateEvent) => void) => {
      onEvent({ type: "progress", downloaded: 50, total: 100 });
      expect(useUpdateStore.getState().progress).toBe(0.5);
      onEvent({ type: "installing" });
    });
    await useUpdateStore.getState().install();
    expect(useUpdateStore.getState().phase).toBe("installing");
  });

  it("hides the pill for a dismissed version only", () => {
    useUpdateStore.setState({ info });
    expect(shouldShowUpdatePill(useUpdateStore.getState())).toBe(true);
    useUpdateStore.getState().dismiss();
    expect(shouldShowUpdatePill(useUpdateStore.getState())).toBe(false);
    expect(localStorage.getItem("notch_update_dismissed")).toBe("0.3.0");

    useUpdateStore.setState({ info: { ...info, version: "0.4.0" } });
    expect(shouldShowUpdatePill(useUpdateStore.getState())).toBe(true);
  });
});
