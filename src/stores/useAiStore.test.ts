import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The mock records the streaming handler each call receives so tests can
 * replay backend events like the real channel would.
 */
type Handler = (event: AiEvent) => void;
const handlers = {
  answer: [] as Handler[],
  followup: [] as Handler[],
  retry: [] as Handler[],
};

vi.mock("../lib/ipc", () => ({
  ipc: {
    aiAnswer: vi.fn((_target: unknown, _lang: unknown, onEvent: Handler) => {
      handlers.answer.push(onEvent);
      return Promise.resolve(101);
    }),
    aiFollowup: vi.fn((_id: unknown, _text: unknown, onEvent: Handler) => {
      handlers.followup.push(onEvent);
      return Promise.resolve(102);
    }),
    aiRetry: vi.fn((_id: unknown, onEvent: Handler) => {
      handlers.retry.push(onEvent);
      return Promise.resolve(103);
    }),
    aiCancel: vi.fn(() => Promise.resolve()),
  },
  toAppError: (value: unknown) => ({
    code: "internal",
    message: value instanceof Error ? value.message : String(value),
  }),
}));

import { ipc, type AiEvent } from "../lib/ipc";
import { lastExchange, useAiStore } from "./useAiStore";

function fire(handlersList: Handler[], index: number, event: AiEvent) {
  handlersList[index]!(event);
}

describe("useAiStore", () => {
  beforeEach(() => {
    useAiStore.setState({ sessionId: null, target: "screen", firstTokenMs: null, exchanges: [] });
    handlers.answer.length = 0;
    handlers.followup.length = 0;
    handlers.retry.length = 0;
  });

  it("stores the answer with its kind and marks it done", async () => {
    const done = useAiStore.getState().ask("screen");
    expect(lastExchange(useAiStore.getState().exchanges)?.status).toBe("capturing");

    for (const event of [
      { type: "started", sessionId: 1, provider: "anthropic", model: "m" },
      { type: "answer", kind: "pg", text: "3. C | 4. D" },
      { type: "done", elapsedMs: 900, firstTokenMs: 120 },
    ] as AiEvent[]) {
      fire(handlers.answer, handlers.answer.length - 1, event);
    }
    await done;

    const state = useAiStore.getState();
    expect(lastExchange(state.exchanges)).toMatchObject({
      status: "done",
      answer: "3. C | 4. D",
      kind: "pg",
    });
    expect(state.firstTokenMs).toBe(120);
    expect(state.sessionId).toBe(101);
  });

  it("drops events from a request that was replaced", async () => {
    const first = useAiStore.getState().ask("screen");
    handlers.answer[0]!({ type: "answer", kind: "essay", text: "stale" } as AiEvent);
    const second = useAiStore.getState().ask("window");
    await Promise.all([first, second]);

    // The old request still delivers after it was replaced.
    handlers.answer[0]!({ type: "answer", kind: "pg", text: "X" } as AiEvent);

    expect(lastExchange(useAiStore.getState().exchanges)?.answer).toBe("");
    expect(useAiStore.getState().target).toBe("window");
  });

  it("records an error event on the exchange", async () => {
    const done = useAiStore.getState().ask("screen");
    handlers.answer[0]!({ type: "error", error: { code: "no_key", message: "no key" } } as AiEvent);
    await done;

    const last = lastExchange(useAiStore.getState().exchanges);
    expect(last?.status).toBe("error");
    expect(last?.error).toEqual({ code: "no_key", message: "no key" });
  });

  it("appends the follow-up prompt and result", async () => {
    const done = useAiStore.getState().ask("screen");
    handlers.answer[0]!({ type: "done", elapsedMs: 10, firstTokenMs: 5 } as AiEvent);
    await done;

    await useAiStore.getState().followUp("Why not C?");
    handlers.followup[0]!({ type: "answer", kind: "essay", text: "Because…" } as AiEvent);
    handlers.followup[0]!({ type: "done", elapsedMs: 10, firstTokenMs: 3 } as AiEvent);

    const exchanges = useAiStore.getState().exchanges;
    expect(exchanges).toHaveLength(2);
    expect(lastExchange(exchanges)).toMatchObject({
      prompt: "Why not C?",
      status: "done",
      answer: "Because…",
    });
  });

  it("cancels the running request and marks the exchange cancelled", async () => {
    const done = useAiStore.getState().ask("screen");
    handlers.answer[0]!({ type: "captured", width: 1, height: 1, captureMs: 5 } as AiEvent);
    await done;

    useAiStore.getState().cancel();
    expect(lastExchange(useAiStore.getState().exchanges)?.status).toBe("cancelled");
    expect(ipc.aiCancel).toHaveBeenCalledWith(101);
  });
});
