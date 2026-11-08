import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "../../i18n";
import type { ProviderView, SettingsView } from "../../lib/ipc";

const ipcMock = vi.hoisted(() => ({
  providerTest: vi.fn(),
  providerUpdate: vi.fn(),
}));

vi.mock("../../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ipc")>();
  return { ...actual, ipc: { ...actual.ipc, ...ipcMock } };
});

import { useSettingsStore } from "../../stores/useSettingsStore";
import { ProviderSection } from "./provider-section";

const codex: ProviderView = {
  id: "codex",
  keyPolicy: "none",
  hasKey: false,
  model: null,
  defaultModel: "gpt-6-sol",
  baseUrl: "https://chatgpt.com/backend-api",
  baseUrlEditable: false,
  supportsLogin: true,
  loggedIn: true,
  accountLabel: "a@b.co",
} as ProviderView;

function settings(provider: ProviderView): SettingsView {
  return {
    provider: provider.id,
    captureMode: "screen",
    historyEnabled: true,
    providers: [provider],
  } as unknown as SettingsView;
}

describe("model picker", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
    ipcMock.providerUpdate.mockResolvedValue(settings(codex));
  });

  it("lists the provider's models and saves the pick", async () => {
    ipcMock.providerTest.mockResolvedValue(["gpt-6-sol", "gpt-6-luna"]);
    useSettingsStore.setState({ settings: settings(codex) });
    render(<ProviderSection />);

    const picker = await screen.findByRole("combobox", { name: "Model" });
    await waitFor(() => expect(picker).not.toBeDisabled());
    const labels = Array.from((picker as HTMLSelectElement).options).map((o) => o.text);
    expect(labels).toEqual([
      "Default (gpt-6-sol)",
      "gpt-6-sol",
      "gpt-6-luna",
      "Type another model…",
    ]);

    fireEvent.change(picker, { target: { value: "gpt-6-luna" } });
    await waitFor(() =>
      expect(ipcMock.providerUpdate).toHaveBeenCalledWith("codex", "gpt-6-luna", null),
    );
  });

  it("switches to typing for a model the list does not show", async () => {
    ipcMock.providerTest.mockResolvedValue(["gpt-6-sol"]);
    useSettingsStore.setState({ settings: settings(codex) });
    render(<ProviderSection />);

    const picker = await screen.findByRole("combobox", { name: "Model" });
    await waitFor(() => expect(picker).not.toBeDisabled());
    fireEvent.change(picker, { target: { value: "__custom__" } });
    expect(await screen.findByPlaceholderText("gpt-6-sol")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick from list" })).toBeInTheDocument();
  });

  it("falls back to typing when the list cannot be loaded", async () => {
    ipcMock.providerTest.mockRejectedValue({ code: "offline", message: "offline" });
    useSettingsStore.setState({ settings: settings(codex) });
    render(<ProviderSection />);
    expect(await screen.findByPlaceholderText("gpt-6-sol")).toBeInTheDocument();
  });
});
