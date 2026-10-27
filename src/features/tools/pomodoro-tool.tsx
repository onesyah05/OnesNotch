import { Coffee, Flame, Pause, Play, RotateCcw, SkipForward, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  POMODORO_DURATIONS,
  usePomodoroStore,
  type PomodoroMode,
} from "../../stores/usePomodoroStore";

function formatSeconds(total: number): string {
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function PomodoroTool() {
  const { t } = useTranslation();
  const {
    mode,
    remainingSeconds,
    isRunning,
    cycle,
    totalCompleted,
    start,
    pause,
    reset,
    skip,
    setMode,
  } = usePomodoroStore();

  const totalForMode = POMODORO_DURATIONS[mode];
  const progress =
    totalForMode > 0 ? Math.max(0, Math.min(100, (remainingSeconds / totalForMode) * 100)) : 0;

  const MODES: { id: PomodoroMode; label: string; icon: typeof Flame }[] = [
    { id: "work", label: t("tools.pomodoro.work"), icon: Flame },
    { id: "shortBreak", label: t("tools.pomodoro.shortBreak"), icon: Coffee },
    { id: "longBreak", label: t("tools.pomodoro.longBreak"), icon: Sparkles },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-between py-2 select-none">
      {/* 1. Mode Selector Tabs */}
      <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-surface/50 p-1">
        {MODES.map((m) => {
          const Icon = m.icon;
          const isActive = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
                isActive
                  ? "bg-white/20 text-fg shadow-sm font-semibold border border-white/20"
                  : "text-muted hover:text-subtle"
              }`}
            >
              <Icon className="size-3.5" />
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* 2. Main Countdown & Cycle Dots */}
      <div className="my-auto flex flex-col items-center justify-center">
        {/* Cycle indicators (4 dots) */}
        <div className="flex items-center gap-1.5 mb-2">
          {[1, 2, 3, 4].map((step) => {
            const isDone = step < cycle;
            const isCurrent = step === cycle;
            return (
              <span
                key={step}
                className={`size-2 rounded-full transition-all ${
                  isCurrent ? "scale-125 shadow-sm" : isDone ? "opacity-80" : "bg-white/15"
                }`}
                style={{
                  backgroundColor: isCurrent || isDone ? "var(--notch-accent, #22d3ee)" : undefined,
                }}
              />
            );
          })}
          <span className="text-[10px] text-muted font-mono ml-1.5">
            {t("tools.pomodoro.session")} {cycle}/4
          </span>
        </div>

        {/* Big Countdown */}
        <span
          className="font-mono text-5xl font-bold tracking-tight"
          style={{ color: isRunning ? "var(--notch-accent, #22d3ee)" : "var(--color-fg)" }}
        >
          {formatSeconds(remainingSeconds)}
        </span>

        {/* Progress Bar */}
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

      {/* 3. Controls & Stats */}
      <div className="flex flex-col items-center gap-2.5 w-full">
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            title={t("tools.pomodoro.reset")}
            className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-surface/60 text-subtle hover:bg-surface hover:text-fg active:scale-95 transition-all shadow-sm"
          >
            <RotateCcw className="size-4" />
          </button>

          <button
            type="button"
            onClick={isRunning ? pause : start}
            title={isRunning ? t("tools.pomodoro.pause") : t("tools.pomodoro.start")}
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
            onClick={skip}
            title={t("tools.pomodoro.skip")}
            className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-surface/60 text-subtle hover:bg-surface hover:text-fg active:scale-95 transition-all shadow-sm"
          >
            <SkipForward className="size-4" />
          </button>
        </div>

        {totalCompleted > 0 && (
          <span className="text-[11px] text-muted">
            {t("tools.pomodoro.totalCompleted")}:{" "}
            <span className="font-semibold text-fg">{totalCompleted}</span>
          </span>
        )}
      </div>
    </div>
  );
}
