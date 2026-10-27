import { beforeEach, describe, expect, it } from "vitest";
import { useTimerStore } from "./useTimerStore";

describe("useTimerStore", () => {
  beforeEach(() => {
    useTimerStore.getState().reset();
    useTimerStore.setState({
      durationSeconds: 300,
      remainingSeconds: 300,
      isRunning: false,
      isCompleted: false,
    });
  });

  it("sets duration and resets remaining time", () => {
    useTimerStore.getState().setDuration(600);

    expect(useTimerStore.getState().durationSeconds).toBe(600);
    expect(useTimerStore.getState().remainingSeconds).toBe(600);
    expect(useTimerStore.getState().isRunning).toBe(false);
  });

  it("ticks down and completes", () => {
    useTimerStore.setState({ remainingSeconds: 2, isRunning: true });

    useTimerStore.getState().tick();
    expect(useTimerStore.getState().remainingSeconds).toBe(1);

    useTimerStore.getState().tick();
    expect(useTimerStore.getState().remainingSeconds).toBe(0);
    expect(useTimerStore.getState().isCompleted).toBe(true);
    expect(useTimerStore.getState().isRunning).toBe(false);
  });

  it("adds seconds correctly", () => {
    useTimerStore.getState().addSeconds(60);

    expect(useTimerStore.getState().remainingSeconds).toBe(360);
  });
});
