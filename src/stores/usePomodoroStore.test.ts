import { beforeEach, describe, expect, it } from "vitest";
import { POMODORO_DURATIONS, usePomodoroStore } from "./usePomodoroStore";

describe("usePomodoroStore", () => {
  beforeEach(() => {
    usePomodoroStore.getState().reset();
    usePomodoroStore.setState({
      mode: "work",
      remainingSeconds: POMODORO_DURATIONS.work,
      isRunning: false,
      cycle: 1,
      totalCompleted: 0,
    });
  });

  it("switches modes correctly", () => {
    usePomodoroStore.getState().setMode("shortBreak");

    expect(usePomodoroStore.getState().mode).toBe("shortBreak");
    expect(usePomodoroStore.getState().remainingSeconds).toBe(POMODORO_DURATIONS.shortBreak);
  });

  it("skips from work to shortBreak on cycle 1", () => {
    usePomodoroStore.getState().skip();

    expect(usePomodoroStore.getState().mode).toBe("shortBreak");
    expect(usePomodoroStore.getState().cycle).toBe(2);
    expect(usePomodoroStore.getState().totalCompleted).toBe(1);
  });

  it("skips to longBreak on cycle 4", () => {
    usePomodoroStore.setState({ cycle: 4, mode: "work" });
    usePomodoroStore.getState().skip();

    expect(usePomodoroStore.getState().mode).toBe("longBreak");
    expect(usePomodoroStore.getState().cycle).toBe(1);
    expect(usePomodoroStore.getState().totalCompleted).toBe(1);
  });
});
