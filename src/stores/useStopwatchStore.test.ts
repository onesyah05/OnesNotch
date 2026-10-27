import { beforeEach, describe, expect, it } from "vitest";
import { useStopwatchStore } from "./useStopwatchStore";

describe("useStopwatchStore", () => {
  beforeEach(() => {
    useStopwatchStore.getState().reset();
  });

  it("starts and records laps", () => {
    useStopwatchStore.setState({ elapsedMs: 5000, isRunning: true });

    useStopwatchStore.getState().lap();
    expect(useStopwatchStore.getState().laps).toEqual([5000]);

    useStopwatchStore.setState({ elapsedMs: 12000 });
    useStopwatchStore.getState().lap();
    expect(useStopwatchStore.getState().laps).toEqual([7000, 5000]);
  });

  it("resets state", () => {
    useStopwatchStore.setState({
      elapsedMs: 10000,
      isRunning: true,
      laps: [5000, 5000],
    });

    useStopwatchStore.getState().reset();

    expect(useStopwatchStore.getState().elapsedMs).toBe(0);
    expect(useStopwatchStore.getState().isRunning).toBe(false);
    expect(useStopwatchStore.getState().laps).toHaveLength(0);
  });
});
