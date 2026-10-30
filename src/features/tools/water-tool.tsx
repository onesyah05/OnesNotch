import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlassWater, Plus, RotateCcw } from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useWaterStore } from "../../stores/useWaterStore";
import { currentWindow, dailyTargetMl, nextDueAt, reminderIntervalMs } from "../water/schedule";

const RING = 2 * Math.PI * 44;

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Today's water progress with a quick "drank a glass" button. */
export function WaterTool() {
  const { t } = useTranslation();
  const water = useSettingsStore((s) => s.settings?.water);
  const progress = useWaterStore((s) => s.progress);

  // Re-render once a minute so "next reminder" stays current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    useWaterStore.getState().load();
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!water) return null;

  const target = dailyTargetMl(water.weightKg);
  const ratio = target > 0 ? Math.min(1, progress.consumedMl / target) : 0;
  const window = currentWindow(now, water.startTime);
  const next = nextDueAt(window, progress, reminderIntervalMs(target, water.glassMl));
  const done = progress.consumedMl >= target;

  return (
    <div className="flex h-full items-center gap-6 px-2">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          <circle cx="50" cy="50" r="44" fill="none" strokeWidth="7" className="stroke-elevated" />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - ratio)}
            className="stroke-accent transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <GlassWater className="mb-0.5 size-4 text-accent" />
          <span className="font-mono text-lg font-semibold text-fg">
            {Math.round(ratio * 100)}%
          </span>
          <span className="text-[10px] text-subtle">
            {progress.consumedMl}/{target} ml
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div>
          <p className="text-sm font-semibold text-fg">
            {t("water.glasses", { count: progress.glasses })}
          </p>
          <p className="text-xs text-subtle">
            {!water.enabled
              ? t("water.off")
              : done
                ? t("water.goalReached")
                : t("water.nextAt", { time: clock(next) })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => useWaterStore.getState().drink(water)}
            className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-bg transition-transform hover:brightness-110 active:scale-95"
          >
            <Plus className="size-3.5" />
            {t("water.addGlass", { ml: water.glassMl })}
          </button>
          <button
            type="button"
            title={t("settings.water.resetButton")}
            aria-label={t("settings.water.resetButton")}
            onClick={() => useWaterStore.getState().resetToday()}
            className="flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void ipc.showSettings().catch(() => {})}
          className="self-start text-[11px] text-muted underline-offset-2 transition-colors hover:text-subtle hover:underline"
        >
          {t("water.openSettings")}
        </button>
      </div>
    </div>
  );
}
