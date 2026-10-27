import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePortStore } from "./usePortStore";
import { ipc } from "../lib/ipc";

vi.mock("../lib/ipc", () => ({
  ipc: {
    portsGetActive: vi.fn(async () => [
      {
        port: 3000,
        protocol: "TCP",
        localAddress: "127.0.0.1:3000",
        state: "LISTENING",
        pid: 1234,
        processName: "node.exe",
      },
      {
        port: 5432,
        protocol: "TCP",
        localAddress: "0.0.0.0:5432",
        state: "LISTENING",
        pid: 5678,
        processName: "postgres.exe",
      },
    ]),
    portsKillProcess: vi.fn(async () => {}),
  },
}));

describe("usePortStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePortStore.setState({
      ports: [],
      isLoading: false,
      error: null,
      searchQuery: "",
    });
  });

  it("loads active ports from IPC", async () => {
    await usePortStore.getState().loadPorts();

    expect(ipc.portsGetActive).toHaveBeenCalled();
    expect(usePortStore.getState().ports).toHaveLength(2);
    expect(usePortStore.getState().ports[0]?.port).toBe(3000);
    expect(usePortStore.getState().ports[0]?.processName).toBe("node.exe");
  });

  it("kills process and removes corresponding ports", async () => {
    usePortStore.setState({
      ports: [
        {
          port: 3000,
          protocol: "TCP",
          localAddress: "127.0.0.1:3000",
          state: "LISTENING",
          pid: 1234,
          processName: "node.exe",
        },
        {
          port: 5432,
          protocol: "TCP",
          localAddress: "0.0.0.0:5432",
          state: "LISTENING",
          pid: 5678,
          processName: "postgres.exe",
        },
      ],
    });

    const success = await usePortStore.getState().killPortProcess(1234);

    expect(success).toBe(true);
    expect(ipc.portsKillProcess).toHaveBeenCalledWith(1234);
    expect(usePortStore.getState().ports).toHaveLength(1);
    expect(usePortStore.getState().ports[0]?.port).toBe(5432);
  });
});
