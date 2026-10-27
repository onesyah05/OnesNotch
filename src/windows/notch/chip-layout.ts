/** MCQ answers stay a pill; essays grow into a wider, capped panel. */

import type { AnswerKind } from "../../lib/ipc";

export type ChipLayout = AnswerKind;

/** Pill (pg) padding. The chip size is content + 2 × padding, so the style uses these too. */
export const PG_PAD_X = 24;
export const PG_PAD_Y = 11;
/** Essay padding. */
export const ESSAY_PAD_X = 24;
export const ESSAY_PAD_Y = 16;

export const CHIP_MIN_W = 160;
/** The notch window is 640 logical px wide; keep a margin for the shadow. */
export const CHIP_MAX_W = 600;
export const CHIP_MIN_H = 44;
/** Window is 480 tall and the chip floats 12 px down (`MAX_CHIP_H` in state.rs is 456). */
export const CHIP_MAX_H = 420;
/** Essay scroll box (logical px), scrollbar included: max width for essays. */
export const ESSAY_BOX_W = CHIP_MAX_W - 2 * ESSAY_PAD_X;
/** Widest a pg row may get before items wrap to a second line. */
export const PG_CONTENT_MAX_W = CHIP_MAX_W - 2 * PG_PAD_X;

export const PILL_RADIUS = 9999;
export const PANEL_RADIUS = 28;

/** Toggle panel (expanded) dimensions for full essay answers */
export const ESSAY_PANEL_W = 560;
export const ESSAY_PANEL_H = 420;
export const ESSAY_PANEL_RADIUS = 28;

/** Above this height a fully-round pill clips text, so we switch to the panel radius. */
const PILL_HEIGHT_MAX = 64;

/**
 * Unwraps raw JSON payloads or question maps into clean human-readable text.
 * Guarantees raw JSON `{ "1": "..." }` or `{ "answer": "..." }` is never shown in UI.
 */
export function unwrapAnswerText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return text;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return text;
    }
    // 1. Direct answer/jawaban/text field
    for (const key of ["answer", "jawaban", "text", "content", "response", "result"]) {
      if (typeof parsed[key] === "string" && parsed[key].trim()) {
        return unwrapAnswerText(parsed[key]);
      }
      if (parsed[key] && typeof parsed[key] === "object") {
        return unwrapAnswerText(JSON.stringify(parsed[key]));
      }
    }
    // 2. Map of question keys, e.g. {"1": "Pengertian ranah..."}
    const entries = Object.entries(parsed).filter(([k]) => k !== "type" && k !== "kind");
    const first = entries[0];
    if (entries.length === 1 && first && typeof first[1] === "string") {
      return unwrapAnswerText(first[1]);
    }
    if (entries.length > 1 && entries.every(([, v]) => typeof v === "string")) {
      entries.sort((a, b) => {
        const na = parseInt(a[0].replace(/\D/g, ""), 10);
        const nb = parseInt(b[0].replace(/\D/g, ""), 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a[0].localeCompare(b[0]);
      });
      return entries.map(([k, v]) => `${k}. ${v}`).join("\n\n");
    }
  } catch {
    // If not valid JSON, return original
  }
  return text;
}

/** Short, single-line answers (typical MCQ) vs wrapping essay/code. */
export function isCompactAnswer(text: string): boolean {
  const unwrapped = unwrapAnswerText(text);
  const trimmed = unwrapped.trim();
  if (!trimmed) return true;
  if (trimmed.includes("```") || trimmed.includes("\n\n")) return false;
  if (/^#{1,6}\s/m.test(trimmed) || /^\s*[-*]\s/m.test(trimmed)) return false;
  const lines = trimmed.split("\n");
  if (lines.length > 2) return false;
  return trimmed.length <= 140;
}

/** Trusts the model's kind; guesses from the text only for answers without one. */
export function chipLayout(kind: AnswerKind | null, text: string): ChipLayout {
  if (kind === "pg") return "pg";
  if (kind === "essay") return "essay";
  return isCompactAnswer(text) ? "pg" : "essay";
}

export function chipRadius(height: number): number {
  return height <= PILL_HEIGHT_MAX ? PILL_RADIUS : PANEL_RADIUS;
}

/**
 * Splits "3. C | 4. D" into labelled items.
 * Also handles JSON maps like `{"6":"c","7":"c","8":"c"}` as a resilient fallback.
 */
export function splitPgAnswer(text: string): { label: string | null; choice: string }[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const target =
          parsed.answer && typeof parsed.answer === "object" && !Array.isArray(parsed.answer)
            ? parsed.answer
            : parsed;
        const entries = Object.entries(target);
        // Only accept if all values are short MCQ choices (e.g. <= 4 chars or numbers)
        if (
          entries.length > 0 &&
          entries.every(
            ([, v]) => (typeof v === "string" && v.trim().length <= 4) || typeof v === "number",
          )
        ) {
          entries.sort((a, b) => {
            const na = parseInt(a[0].replace(/\D/g, ""), 10);
            const nb = parseInt(b[0].replace(/\D/g, ""), 10);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a[0].localeCompare(b[0]);
          });
          return entries.map(([k, v]) => ({
            label: k.replace(/^(question|soal|nomor|no|q)[._]?/i, "").replace(/\D/g, "") || k,
            choice: String(v).trim().toUpperCase(),
          }));
        }
      }
    } catch {
      // Fall through to pipe splitting
    }
  }

  return text
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = /^(\S{1,6}?)[.:)]\s*(.+)$/.exec(item);
      return match
        ? { label: match[1]!, choice: match[2]!.toUpperCase() }
        : { label: null, choice: item.toUpperCase() };
    });
}
