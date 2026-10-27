import { useState } from "react";
import { Check, Pause, Play, Plus, RotateCcw, Timer as TimerIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTimerStore } from "../../stores/useTimerStore";

function formatSeconds(total: number): string {
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

const PRESETS = [
  { label: "1m", seconds: 60 },
  { label: "3m", seconds: 180 },
  { label: "5m", seconds: 300 },
  { label: "10m", seconds: 600 },
  { label: "15m", seconds: 900 },
  { label: "25m", seconds: 1500 },
  { label: "30m", seconds: 1800 },
  { label: "1j", seconds: 3600 },
];

export function TimerTool() {
  const { t } = useTranslation();
  const {
    durationSeconds,
    remainingSeconds,
    isRunning,
    isCompleted,
    setDuration,
    start,
    pause,
    reset,
    addSeconds,
  } = useTimerStore();

  const [customMin, setCustomMin] = useState("");

  const handleCustomSet = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(customMin, 10);
    if (!isNaN(val) && val > 0 && val <= 720) {
      setDuration(val * 60);
      setCustomMin("");
    }
  };

  const progress =
    durationSeconds > 0
      ? Math.max(0, Math.min(100, (remainingSeconds / durationSeconds) * 100))
      : 0;

  return (
    <div className="flex h-full flex-col items-center justify-between py-2 select-none">
      {/* 1. Presets Header */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 w-full">
        {PRESETS.map((preset) => {
          const isActive =
            durationSeconds === preset.seconds && !isRunning && remainingSeconds === preset.seconds;
          return (
            <button
              key={preset.seconds}
              type="button"
              onClick={() => setDuration(preset.seconds)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                isActive
                  ? "bg-white/20 text-fg shadow-sm border border-white/20 font-semibold"
                  : "bg-surface/50 text-subtle hover:bg-surface hover:text-fg border border-white/5"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* 2. Main Countdown Display */}
      <div className="relative my-auto flex flex-col items-center justify-center">
        {isCompleted ? (
          <div className="flex flex-col items-center gap-2 animate-bounce">
            <div
              className="flex size-14 items-center justify-center rounded-full text-black shadow-lg"
              style={{ backgroundColor: "var(--notch-accent, #22d3ee)" }}
            >
              <Check className="size-8 stroke-[3]" />
            </div>
            <span
              className="font-bold text-sm tracking-wide"
              style={{ color: "var(--notch-accent, #22d3ee)" }}
            >
              {t("tools.timer.completed")}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <span
              className="font-mono text-5xl font-bold tracking-tight"
              style={{ color: isRunning ? "var(--notch-accent, #22d3ee)" : "var(--color-fg)" }}
            >
              {formatSeconds(remainingSeconds)}
            </span>

            {/* Circular / Line Progress */}
            <div className="mt-3 h-1.5 w-44 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress}%`,
                  backgroundColor: "var(--notch-accent, #22d3ee)",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 3. Controls & Custom Time */}
      <div className="flex flex-col items-center gap-3 w-full">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            title={t("tools.timer.reset")}
            className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-surface/60 text-subtle hover:bg-surface hover:text-fg active:scale-95 transition-all shadow-sm"
          >
            <RotateCcw className="size-4" />
          </button>

          <button
            type="button"
            onClick={isRunning ? pause : start}
            title={isRunning ? t("tools.timer.pause") : t("tools.timer.start")}
            className="flex size-12 items-center justify-center rounded-full text-slate-950 font-bold shadow-md hover:brightness-110 active:scale-95 transition-all"
            style={{ backgroundColor: "var(--notch-accent, #22d3ee)" }}
          >
            {isRunning ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="size-5 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => addSeconds(60)}
            title="+1 menit"
            className="flex items-center gap-1 rounded-full border border-white/10 bg-surface/60 px-3 py-1.5 text-xs font-semibold text-subtle hover:bg-surface hover:text-fg active:scale-95 transition-all shadow-sm"
          >
            <Plus className="size-3.5" />
            <span>1m</span>
          </button>
        </div>

        {/* Custom duration input */}
        <form onSubmit={handleCustomSet} className="flex items-center gap-1.5 text-xs text-subtle">
          <TimerIcon className="size-3.5 text-muted shrink-0" />
          <span>{t("tools.timer.custom")}:</span>
          <input
            type="number"
            min="1"
            max="720"
            placeholder="menit"
            value={customMin}
            onChange={(e) => setCustomMin(e.target.value)}
            className="w-16 rounded-md border border-white/10 bg-surface/60 px-2 py-0.5 text-center font-mono text-xs text-fg focus:border-white/30 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!customMin}
            className="rounded-md border border-white/10 bg-surface px-2 py-0.5 font-medium hover:bg-elevated disabled:opacity-40 transition-colors"
          >
            {t("common.add")}
          </button>
        </form>
      </div>
    </div>
  );
}
