/**
 * Drink-reminder math. Pure functions so the schedule is easy to test.
 *
 * Daily goal follows the common guideline of 30 ml per kg of body weight
 * (35 ml/kg as the upper end), spread over a 12-hour window.
 */

export const ML_PER_KG = 30;
export const ML_PER_KG_HIGH = 35;
export const WINDOW_HOURS = 12;
export const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;
export const SNOOZE_MINUTES = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

export function dailyTargetMl(weightKg: number): number {
  return Math.round(Math.max(0, weightKg) * ML_PER_KG);
}

/** Recommended range, e.g. 60 kg → [1800, 2100]. */
export function targetRangeMl(weightKg: number): [number, number] {
  const kg = Math.max(0, weightKg);
  return [Math.round(kg * ML_PER_KG), Math.round(kg * ML_PER_KG_HIGH)];
}

export function remindersPerDay(targetMl: number, glassMl: number): number {
  if (glassMl <= 0) return 1;
  return Math.max(1, Math.ceil(targetMl / glassMl));
}

/** Time between reminders so every glass fits inside the window. */
export function reminderIntervalMs(targetMl: number, glassMl: number): number {
  return Math.floor(WINDOW_MS / remindersPerDay(targetMl, glassMl));
}

/** `HH:MM` → minutes after midnight, or null when malformed. */
export function parseStartMinutes(raw: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export interface WaterWindow {
  start: number;
  end: number;
  /** Local calendar date of `start`, used to key the day's progress. */
  dayKey: string;
}

function localDayKey(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function startOn(dayMs: number, startMinutes: number): number {
  const d = new Date(dayMs);
  d.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  return d.getTime();
}

function makeWindow(start: number): WaterWindow {
  return { start, end: start + WINDOW_MS, dayKey: localDayKey(start) };
}

/**
 * The window progress belongs to right now: the active one, or after it ends
 * the one that ended today (so the evening still shows today's total), and
 * otherwise the next one (a fresh day).
 */
export function currentWindow(now: number, startTime: string): WaterWindow {
  const minutes = parseStartMinutes(startTime) ?? 7 * 60;
  const today = startOn(now, minutes);
  const recent = today <= now ? today : startOn(now - DAY_MS, minutes);
  if (now < recent + WINDOW_MS) return makeWindow(recent);
  if (localDayKey(recent) === localDayKey(now)) return makeWindow(recent);
  // `recent` was yesterday's window and is over, so today's is still ahead.
  return makeWindow(today);
}

export function isActive(window: WaterWindow, now: number): boolean {
  return now >= window.start && now < window.end;
}

export interface WaterProgress {
  dayKey: string;
  consumedMl: number;
  glasses: number;
  lastDrinkAt: number | null;
  snoozeUntil: number | null;
}

export function emptyProgress(dayKey: string): WaterProgress {
  return { dayKey, consumedMl: 0, glasses: 0, lastDrinkAt: null, snoozeUntil: null };
}

/** When the next reminder fires: at the window start, then one interval after each drink. */
export function nextDueAt(
  window: WaterWindow,
  progress: WaterProgress,
  intervalMs: number,
): number {
  const lastDrink =
    progress.lastDrinkAt != null && progress.lastDrinkAt >= window.start
      ? progress.lastDrinkAt
      : null;
  const due = lastDrink == null ? window.start : lastDrink + intervalMs;
  return progress.snoozeUntil != null ? Math.max(due, progress.snoozeUntil) : due;
}

export interface DueInput {
  now: number;
  window: WaterWindow;
  progress: WaterProgress;
  targetMl: number;
  glassMl: number;
}

export function isDue({ now, window, progress, targetMl, glassMl }: DueInput): boolean {
  if (!isActive(window, now)) return false;
  if (progress.consumedMl >= targetMl) return false;
  return now >= nextDueAt(window, progress, reminderIntervalMs(targetMl, glassMl));
}
