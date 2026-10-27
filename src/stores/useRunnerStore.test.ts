import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRunnerStore } from "./useRunnerStore";
import { ipc } from "../lib/ipc";

vi.mock("../lib/ipc", () => ({
  ipc: {
    runnerExecute: vi.fn(async () => ({ success: true, message: "OK" })),
    runnerOpenDirectory: vi.fn(async () => {}),
    runnerStopProcess: vi.fn(async () => {}),
    runnerStopApp: vi.fn(async () => ({ success: true, message: "Stopped" })),
    runnerPickDirectory: vi.fn(async () => "D:\\test\\project"),
  },
}));

describe("useRunnerStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useRunnerStore.setState({
      apps: [],
      searchQuery: "",
      executingId: null,
      error: null,
    });
  });

  it("adds an app preset and generates unique id", () => {
    const app = useRunnerStore.getState().addApp({
      name: "Frontend Web",
      command: "npm run dev",
      commandStop: "",
      directory: "D:\\web",
      terminal: "auto",
      mode: "terminal",
      color: "#22d3ee",
    });

    expect(app.id).toBeDefined();
    expect(app.name).toBe("Frontend Web");
    expect(useRunnerStore.getState().apps).toHaveLength(1);
  });

  it("executes an app preset via IPC", async () => {
    const app = useRunnerStore.getState().addApp({
      name: "Tauri App",
      command: "cargo tauri dev",
      commandStop: "",
      terminal: "auto",
      mode: "terminal",
    });

    const success = await useRunnerStore.getState().runApp(app.id);

    expect(success).toBe(true);
    expect(ipc.runnerExecute).toHaveBeenCalledWith({
      command: "cargo tauri dev",
      commandStop: undefined,
      directory: undefined,
      terminal: "auto",
      mode: "terminal",
    });
  });

  it("stops an app preset via IPC with custom stop command or default Ctrl+C", async () => {
    const app = useRunnerStore.getState().addApp({
      name: "Docker Containers",
      command: "docker compose up",
      commandStop: "docker compose down",
      directory: "D:\\backend",
    });

    useRunnerStore.setState({
      apps: [
        {
          ...app,
          runningPid: 1234,
          isRunning: true,
        },
      ],
    });

    const stopped = await useRunnerStore.getState().stopApp(app.id);
    expect(stopped).toBe(true);
    expect(ipc.runnerStopApp).toHaveBeenCalledWith({
      pid: 1234,
      commandStop: "docker compose down",
      directory: "D:\\backend",
    });

    const stateApp = useRunnerStore.getState().apps[0];
    expect(stateApp?.isRunning).toBe(false);
    expect(stateApp?.runningPid).toBeUndefined();
  });

  it("updates and deletes an app preset", () => {
    const app = useRunnerStore.getState().addApp({
      name: "Old Name",
      command: "echo 1",
    });

    useRunnerStore.getState().updateApp(app.id, { name: "New Name" });
    expect(useRunnerStore.getState().apps[0]?.name).toBe("New Name");

    useRunnerStore.getState().deleteApp(app.id);
    expect(useRunnerStore.getState().apps).toHaveLength(0);
  });
});
