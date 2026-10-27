import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ErrorText } from "../../components/error-text";
import {
  CheckIcon,
  CopyIcon,
  RetryIcon,
  ScreenIcon,
  SendIcon,
  StopIcon,
  WindowIcon,
} from "../../components/icons";
import { formatAccelerator } from "../../lib/accelerator";
import { ipc, type CaptureTarget } from "../../lib/ipc";
import {
  isActive,
  lastExchange,
  useAiStore,
  type Exchange,
  type ExchangeStatus,
} from "../../stores/useAiStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { unwrapAnswerText } from "../../windows/notch/chip-layout";
import { Markdown } from "./markdown";
import { PgAnswer } from "./pg-answer";

const COPIED_MS = 1200;
/** Within this many pixels of the bottom, new text keeps the view pinned. */
const STICKY_PX = 24;

// Buttons live inside the clickable pill; keep their clicks from bubbling up.
function stop(event: MouseEvent) {
  event.stopPropagation();
}

export function AnswerPanel() {
  const exchanges = useAiStore((s) => s.exchanges);
  return exchanges.length === 0 ? <EmptyState /> : <Conversation exchanges={exchanges} />;
}

function EmptyState() {
  const { t } = useTranslation();
  const hotkey = useSettingsStore((s) => s.settings?.hotkeys.answerScreen);
  const ask = (target: CaptureTarget) => void useAiStore.getState().ask(target);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-fg">{t("ai.empty.title")}</p>
      <p className="text-xs text-subtle">
        {t("ai.empty.hint", { hotkey: hotkey ? formatAccelerator(hotkey) : "—" })}
      </p>
      <div className="mt-1 flex gap-2">
        <ActionChip onClick={() => ask("screen")} icon={<ScreenIcon />}>
          {t("ai.empty.screen")}
        </ActionChip>
        <ActionChip onClick={() => ask("window")} icon={<WindowIcon />}>
          {t("ai.empty.window")}
        </ActionChip>
      </div>
    </div>
  );
}

function Conversation({ exchanges }: { exchanges: Exchange[] }) {
  const { t } = useTranslation();
  const provider = useAiStore((s) => s.provider);
  const model = useAiStore((s) => s.model);
  const firstTokenMs = useAiStore((s) => s.firstTokenMs);
  const captureMode = useSettingsStore((s) => s.settings?.captureMode ?? "screen");
  const last = lastExchange(exchanges);
  const active = isActive(last?.status);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sticky = useRef(true);
  const [copied, setCopied] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && sticky.current) el.scrollTop = el.scrollHeight;
  }, [exchanges]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) sticky.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_PX;
  };

  const copy = () => {
    if (!last?.answer) return;
    const cleanText = unwrapAnswerText(last.answer);
    void ipc
      .clipboardWrite(cleanText)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  const store = useAiStore.getState();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <header className="flex items-center gap-2 text-xs">
        <StatusDot status={last?.status} />
        <span className="text-fg">{statusText(t, last?.status, firstTokenMs)}</span>
        {provider && (
          <span className="min-w-0 truncate text-muted">
            {t(`providers.${provider}`)} · {model}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {active ? (
            <IconButton label={t("ai.actions.cancel")} onClick={() => store.cancel()}>
              <StopIcon />
            </IconButton>
          ) : (
            <>
              <IconButton label={t("ai.actions.retry")} onClick={() => void store.retry()}>
                <RetryIcon />
              </IconButton>
              <IconButton
                label={t(copied ? "ai.actions.copied" : "ai.actions.copy")}
                onClick={copy}
                disabled={!last?.answer}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </IconButton>
              <IconButton label={t("ai.actions.again")} onClick={() => void store.ask(captureMode)}>
                {captureMode === "window" ? <WindowIcon /> : <ScreenIcon />}
              </IconButton>
            </>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto pr-1 select-text"
        aria-live="polite"
      >
        {exchanges.map((exchange, index) => (
          <ExchangeView key={index} exchange={exchange} />
        ))}
      </div>

      <FollowUp disabled={active} />
    </div>
  );
}

function ExchangeView({ exchange }: { exchange: Exchange }) {
  const { t } = useTranslation();
  const cleanAnswer = exchange.answer ? unwrapAnswerText(exchange.answer) : "";

  return (
    <article className="mb-3 last:mb-0">
      {exchange.prompt !== null && (
        <p className="mb-2 ml-auto w-fit max-w-[85%] rounded-2xl glass-elevated px-3 py-1.5 text-sm break-words text-fg">
          <span className="sr-only">{t("ai.you")}: </span>
          {exchange.prompt}
        </p>
      )}
      {cleanAnswer &&
        (exchange.kind === "pg" ? (
          <PgAnswer text={cleanAnswer} className="my-1" />
        ) : (
          <Markdown text={cleanAnswer} />
        ))}
      {!exchange.answer && isActive(exchange.status) && <Skeleton />}
      {exchange.error && <ErrorText error={exchange.error} className="mt-2" />}
    </article>
  );
}

function FollowUp({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const sessionId = useAiStore((s) => s.sessionId);
  const [text, setText] = useState("");
  const blocked = disabled || sessionId === null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (blocked || !text.trim()) return;
    void useAiStore.getState().followUp(text);
    setText("");
  };

  return (
    <form onSubmit={submit} onClick={stop} className="flex items-center gap-1.5">
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t("ai.followUp.placeholder")}
        maxLength={4000}
        disabled={sessionId === null}
        className="h-8 min-w-0 flex-1 rounded-full glass-surface px-3.5 text-sm text-fg border border-white/[0.08] outline-none placeholder:text-muted focus:border-white/20 disabled:opacity-50"
      />
      <IconButton label={t("ai.followUp.send")} type="submit" disabled={blocked || !text.trim()}>
        <SendIcon />
      </IconButton>
    </form>
  );
}

type T = ReturnType<typeof useTranslation>["t"];

function statusText(t: T, status: ExchangeStatus | undefined, firstTokenMs: number | null) {
  if (status === "done" && firstTokenMs !== null) {
    return t("ai.status.doneIn", { seconds: (firstTokenMs / 1000).toFixed(1) });
  }
  return t(`ai.status.${status ?? "done"}`);
}

function StatusDot({ status }: { status: ExchangeStatus | undefined }) {
  const tone =
    status === "error"
      ? "bg-live"
      : status === "done"
        ? "bg-ok"
        : isActive(status)
          ? "animate-pulse bg-fg"
          : "bg-muted";
  return <span className={`size-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />;
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2 py-1" aria-hidden="true">
      <span className="h-2.5 w-3/4 animate-pulse rounded-full bg-surface" />
      <span className="h-2.5 w-1/2 animate-pulse rounded-full bg-surface" />
    </div>
  );
}

interface IconButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  children: ReactNode;
}

function IconButton({ label, onClick, disabled, type = "button", children }: IconButtonProps) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-fg disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ActionChip({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex items-center gap-2 rounded-full glass-elevated px-3.5 py-1.5 text-xs text-fg transition-all hover:border-white/20"
    >
      {icon}
      {children}
    </button>
  );
}
