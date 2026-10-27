import { beforeEach, describe, expect, it, vi } from "vitest";
import { useClipboardStore } from "./useClipboardStore";
import { ipc } from "../lib/ipc";

vi.mock("../lib/ipc", () => ({
  ipc: {
    clipboardGetHistory: vi.fn(async () => [
      { id: "clip_1", text: "First copy", timestamp: 1000 },
      { id: "clip_2", text: "Second copy", timestamp: 2000 },
    ]),
    clipboardWrite: vi.fn(async () => {}),
    clipboardDeleteItem: vi.fn(async () => true),
    clipboardClearHistory: vi.fn(async () => {}),
  },
}));

describe("useClipboardStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useClipboardStore.setState({
      items: [],
      loading: false,
      searchQuery: "",
      copiedId: null,
    });
  });

  it("loads clipboard history from IPC", async () => {
    await useClipboardStore.getState().load();

    expect(ipc.clipboardGetHistory).toHaveBeenCalled();
    expect(useClipboardStore.getState().items).toHaveLength(2);
    expect(useClipboardStore.getState().items[0]?.text).toBe("First copy");
  });

  it("adds and deduplicates incoming clipboard items", () => {
    useClipboardStore.getState().addItem({ id: "clip_3", text: "New text", timestamp: 3000 });

    expect(useClipboardStore.getState().items).toHaveLength(1);
    expect(useClipboardStore.getState().items[0]?.text).toBe("New text");

    // Add same text again -> moves to top without duplicate count
    useClipboardStore.getState().addItem({ id: "clip_4", text: "New text", timestamp: 4000 });
    expect(useClipboardStore.getState().items).toHaveLength(1);
  });

  it("copies an item and writes to IPC", async () => {
    const item = { id: "clip_1", text: "Hello", timestamp: 1000 };
    await useClipboardStore.getState().copy(item);

    expect(ipc.clipboardWrite).toHaveBeenCalledWith("Hello");
    expect(useClipboardStore.getState().copiedId).toBe("clip_1");
  });

  it("deletes a single item", async () => {
    useClipboardStore.setState({
      items: [{ id: "clip_1", text: "Hello", timestamp: 1000 }],
    });

    await useClipboardStore.getState().deleteItem("clip_1");

    expect(useClipboardStore.getState().items).toHaveLength(0);
    expect(ipc.clipboardDeleteItem).toHaveBeenCalledWith("clip_1");
  });

  it("clears all items", async () => {
    useClipboardStore.setState({
      items: [{ id: "clip_1", text: "Hello", timestamp: 1000 }],
    });

    await useClipboardStore.getState().clearAll();

    expect(useClipboardStore.getState().items).toHaveLength(0);
    expect(ipc.clipboardClearHistory).toHaveBeenCalled();
  });
});
