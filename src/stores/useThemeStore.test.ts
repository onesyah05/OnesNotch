import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyThemeToCss, DEFAULT_THEME, useThemeStore } from "./useThemeStore";
import { ipc } from "../lib/ipc";

vi.mock("../lib/ipc", () => ({
  ipc: {
    themeSet: vi.fn(async (bg, accent) => ({
      backgroundColor: bg ?? DEFAULT_THEME.backgroundColor,
      accentColor: accent ?? DEFAULT_THEME.accentColor,
    })),
    settingsGet: vi.fn(async () => ({
      theme: {
        backgroundColor: "#0B132B",
        accentColor: "#A855F7",
      },
    })),
  },
}));

describe("useThemeStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({
      theme: { ...DEFAULT_THEME },
      loading: false,
    });
  });

  it("has default colors matching the PRD and current design", () => {
    expect(DEFAULT_THEME.backgroundColor).toBe("#111522");
    expect(DEFAULT_THEME.accentColor).toBe("#22D3EE");
  });

  it("applies theme to document CSS variables", () => {
    applyThemeToCss({
      backgroundColor: "#000000",
      accentColor: "#F43F5E",
    });

    expect(document.documentElement.style.getPropertyValue("--notch-bg")).toBe("#000000");
    expect(document.documentElement.style.getPropertyValue("--notch-accent")).toBe("#F43F5E");
  });

  it("sets background color and calls IPC", async () => {
    await useThemeStore.getState().setBackgroundColor("#18181B");

    expect(useThemeStore.getState().theme.backgroundColor).toBe("#18181B");
    expect(ipc.themeSet).toHaveBeenCalledWith("#18181B", undefined);
    expect(document.documentElement.style.getPropertyValue("--notch-bg")).toBe("#18181B");
  });

  it("sets accent color and calls IPC", async () => {
    await useThemeStore.getState().setAccentColor("#10B981");

    expect(useThemeStore.getState().theme.accentColor).toBe("#10B981");
    expect(ipc.themeSet).toHaveBeenCalledWith(undefined, "#10B981");
    expect(document.documentElement.style.getPropertyValue("--notch-accent")).toBe("#10B981");
  });

  it("resets back to default colors", async () => {
    useThemeStore.setState({
      theme: { backgroundColor: "#000000", accentColor: "#FF0000" },
    });

    await useThemeStore.getState().resetDefaults();

    expect(useThemeStore.getState().theme.backgroundColor).toBe("#111522");
    expect(useThemeStore.getState().theme.accentColor).toBe("#22D3EE");
    expect(ipc.themeSet).toHaveBeenCalledWith("#111522", "#22D3EE");
  });

  it("loads theme from settingsGet", async () => {
    await useThemeStore.getState().load();

    expect(useThemeStore.getState().theme.backgroundColor).toBe("#0B132B");
    expect(useThemeStore.getState().theme.accentColor).toBe("#A855F7");
  });
});
