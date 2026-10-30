import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Check, Copy, X } from "lucide-react";
import { ErrorText } from "../../components/error-text";
import { Markdown } from "../../features/ai/markdown";
import { PgAnswer } from "../../features/ai/pg-answer";
import { ipc } from "../../lib/ipc";
import { lastExchange, useAiStore } from "../../stores/useAiStore";
import { useNotchStore } from "../../stores/useNotchStore";
import {
  CHIP_MAX_H,
  CHIP_MAX_W,
  CHIP_MIN_H,
  CHIP_MIN_W,
  ESSAY_PAD_X,
  ESSAY_PAD_Y,
  ESSAY_PANEL_H,
  ESSAY_PANEL_RADIUS,
  ESSAY_PANEL_W,
  PG_CONTENT_MAX_W,
  PG_PAD_X,
  PG_PAD_Y,
  chipLayout,
  chipRadius,
  unwrapAnswerText,
} from "./chip-layout";

export interface ChipSize {
  width: number;
  height: number;
  borderRadius: number;
}

/**
 * Compact answer chip. Multiple choice stays a pill (items wrap if the row is
 * too long); essays expand to match the full toggle panel dimensions (520x420)
 * so text is wide, clear, and comfortable to read.
 */
export function AnswerChip({ onSize }: { onSize: (size: ChipSize) => void }) {
  const { t } = useTranslation();
  const last = useAiStore((s) => lastExchange(s.exchanges));
  const rawAnswer = last?.answer ?? "";
  const answer = unwrapAnswerText(rawAnswer);
  const essay = !last?.error && answer !== "" && chipLayout(last?.kind ?? null, answer) === "essay";
  const padX = essay ? ESSAY_PAD_X : PG_PAD_X;
  const padY = essay ? ESSAY_PAD_Y : PG_PAD_Y;

  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<ChipSize | null>(null);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!answer) return;
    void ipc.clipboardWrite(answer).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    useNotchStore.getState().setState("idle");
    void ipc.setNotchState("idle").catch(() => {});
  };

  useLayoutEffect(() => {
    if (essay) {
      const next: ChipSize = {
        width: ESSAY_PANEL_W,
        height: ESSAY_PANEL_H,
        borderRadius: ESSAY_PANEL_RADIUS,
      };
      const prev = sizeRef.current;
      if (
        !prev ||
        prev.width !== next.width ||
        prev.height !== next.height ||
        prev.borderRadius !== next.borderRadius
      ) {
        sizeRef.current = next;
        onSize(next);
        void ipc.setAnswerSize(next.width, next.height).catch(() => {});
      }
      return;
    }

    const el = contentRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const contentW = Math.max(Math.ceil(rect.width), Math.ceil(el.scrollWidth));
      const contentH = Math.max(Math.ceil(rect.height), Math.ceil(el.scrollHeight));

      const width = Math.min(CHIP_MAX_W, Math.max(CHIP_MIN_W, contentW + 2 * padX));
      const height = Math.min(CHIP_MAX_H, Math.max(CHIP_MIN_H, contentH + 2 * padY));
      const next: ChipSize = { width, height, borderRadius: chipRadius(height) };
      const prev = sizeRef.current;
      if (
        prev &&
        Math.abs(prev.width - next.width) < 2 &&
        Math.abs(prev.height - next.height) < 2 &&
        prev.borderRadius === next.borderRadius
      ) {
        return;
      }
      sizeRef.current = next;
      onSize(next);
      void ipc.setAnswerSize(width, height).catch(() => {});
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [essay, padX, padY, last, onSize]);

  let content: ReactNode;
  if (last?.error) {
    content = <ErrorText error={last.error} className="max-w-[400px]" />;
  } else if (answer) {
    content = essay ? <Markdown text={answer} /> : <PgAnswer text={answer} />;
  } else {
    content = (
      <p className="flex w-max items-center gap-2 py-0.5 text-sm text-subtle">
        <span className="size-2 animate-pulse rounded-full bg-fg" aria-hidden="true" />
        {t(`ai.status.${last?.status ?? "thinking"}`)}
      </p>
    );
  }

  const padding: CSSProperties = { padding: `${padY}px ${padX}px` };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 1, transition: { duration: 0 } }}
      className={`flex h-full min-h-0 flex-col ${essay ? "items-start justify-start" : "items-center justify-center"}`}
      style={padding}
    >
      {essay ? (
        <div
          className="flex h-full w-full min-h-0 flex-col"
          onClick={(event) => event.stopPropagation()}
        >
          {/* Header jawaban essay dengan status, tombol copy, dan tombol close */}
          <div className="flex w-full shrink-0 items-center justify-between pb-2 mb-2 border-b border-fg/[0.08] text-xs">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-accent animate-pulse" />
              <span className="font-semibold text-fg tracking-wide">
                {last?.status === "streaming" ? t("ai.status.answering") : t("ai.title")}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-subtle hover:bg-fg/[0.08] hover:text-fg transition-colors"
                title={copied ? "Tersalin!" : "Salin Jawaban"}
              >
                {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                <span>{copied ? "Tersalin" : "Salin"}</span>
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="flex items-center justify-center size-6 rounded-md text-muted hover:bg-fg/[0.08] hover:text-fg transition-colors"
                title={t("common.close")}
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Isi essay dengan scrollbar halus dan ruang baca luas */}
          <div
            ref={contentRef}
            className="thin-scrollbar min-h-0 flex-1 w-full overflow-y-auto pr-2 select-text leading-relaxed text-sm text-fg"
          >
            {content}
          </div>
        </div>
      ) : (
        <div ref={contentRef} className="w-fit select-text" style={{ maxWidth: PG_CONTENT_MAX_W }}>
          {content}
        </div>
      )}
    </motion.div>
  );
}
