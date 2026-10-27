import { create } from "zustand";
import i18n from "../i18n";
import {
  ipc,
  toAppError,
  type AiEvent,
  type AnswerKind,
  type AppError,
  type CaptureTarget,
  type ProviderId,
  type UiLanguage,
} from "../lib/ipc";

export type ExchangeStatus =
  "capturing" | "thinking" | "streaming" | "done" | "cancelled" | "error";

export interface Exchange {
  /** Null for the first answer, which is about the screenshot itself. */
  prompt: string | null;
  answer: string;
  /** Layout hint from the model; null until the answer arrives. */
  kind: AnswerKind | null;
  status: ExchangeStatus;
  error: AppError | null;
}

interface AiStore {
  sessionId: number | null;
  target: CaptureTarget;
  provider: ProviderId | null;
  model: string | null;
  exchanges: Exchange[];
  firstTokenMs: number | null;
  ask: (target: CaptureTarget) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

const ACTIVE: ExchangeStatus[] = ["capturing", "thinking", "streaming"];

export function isActive(status: ExchangeStatus | undefined): boolean {
  return status !== undefined && ACTIVE.includes(status);
}

export function lastExchange(exchanges: Exchange[]): Exchange | undefined {
  return exchanges[exchanges.length - 1];
}

function uiLanguage(): UiLanguage {
  return i18n.language?.startsWith("id") ? "id" : "en";
}

/**
 * Each request gets a token; events from an older request (cancelled, or
 * replaced by a newer one) are dropped so they cannot overwrite the panel.
 */
let currentToken = 0;
/** A request cancelled before its session id arrived; cancelled once the id is known. */
let cancelledEarly: number | null = null;

export const useAiStore = create<AiStore>((set, get) => {
  const patchLast = (patch: Partial<Exchange> | ((exchange: Exchange) => Partial<Exchange>)) =>
    set((state) => {
      const last = lastExchange(state.exchanges);
      if (!last) return {};
      const next = typeof patch === "function" ? patch(last) : patch;
      return { exchanges: [...state.exchanges.slice(0, -1), { ...last, ...next }] };
    });

  const handler = (token: number) => (event: AiEvent) => {
    if (token !== currentToken) return;
    switch (event.type) {
      case "started":
        set({ sessionId: event.sessionId, provider: event.provider, model: event.model });
        break;
      case "captured":
        patchLast({ status: "thinking" });
        break;
      case "answer":
        patchLast({ status: "streaming", answer: event.text, kind: event.kind });
        break;
      case "done":
        set({ firstTokenMs: event.firstTokenMs });
        patchLast({ status: "done" });
        break;
      case "cancelled":
        patchLast({ status: "cancelled" });
        break;
      case "error":
        patchLast({ status: "error", error: event.error });
        break;
    }
  };

  const start = async (token: number, request: Promise<number>) => {
    try {
      const sessionId = await request;
      if (token === currentToken) set({ sessionId });
      else if (token === cancelledEarly) void ipc.aiCancel(sessionId).catch(() => {});
    } catch (err) {
      if (token === currentToken) patchLast({ status: "error", error: toAppError(err) });
    }
  };

  return {
    sessionId: null,
    target: "screen",
    provider: null,
    model: null,
    exchanges: [],
    firstTokenMs: null,

    ask: async (target) => {
      const token = ++currentToken;
      set({
        sessionId: null,
        target,
        firstTokenMs: null,
        exchanges: [{ prompt: null, answer: "", kind: null, status: "capturing", error: null }],
      });
      await start(token, ipc.aiAnswer(target, uiLanguage(), handler(token)));
    },

    followUp: async (text) => {
      const { sessionId, exchanges } = get();
      const prompt = text.trim();
      if (sessionId === null || !prompt || isActive(lastExchange(exchanges)?.status)) return;
      const token = ++currentToken;
      set({
        firstTokenMs: null,
        exchanges: [
          ...exchanges,
          { prompt, answer: "", kind: null, status: "thinking", error: null },
        ],
      });
      await start(token, ipc.aiFollowup(sessionId, prompt, handler(token)));
    },

    retry: async () => {
      const { sessionId, target } = get();
      if (sessionId === null) {
        await get().ask(target);
        return;
      }
      const token = ++currentToken;
      set({ firstTokenMs: null });
      patchLast({ answer: "", kind: null, status: "thinking", error: null });
      await start(token, ipc.aiRetry(sessionId, handler(token)));
    },

    cancel: () => {
      const { sessionId, exchanges } = get();
      if (!isActive(lastExchange(exchanges)?.status)) return;
      // Invalidate the token first so late deltas stop rendering immediately.
      if (sessionId === null) cancelledEarly = currentToken;
      currentToken++;
      patchLast({ status: "cancelled" });
      if (sessionId !== null) void ipc.aiCancel(sessionId).catch(() => {});
    },

    reset: () => {
      currentToken++;
      set({ sessionId: null, provider: null, model: null, exchanges: [], firstTokenMs: null });
    },
  };
});
