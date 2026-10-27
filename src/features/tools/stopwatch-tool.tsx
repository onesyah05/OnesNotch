import { Flag, Pause, Play, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStopwatchStore } from "../../stores/useStopwatchStore";

function formatStopwatch(ms: number): { time: string; frac: string } {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((ms % 1000) / 10);
  return {
    time: `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
    frac: hundredths.toString().padStart(2, "0"),
  };
}

export function StopwatchTool() {
  const { t } = useTranslation();
  const { elapsedMs, isRunning, laps, start, pause, reset, lap } = useStopwatchStore();

  const formatted = formatStopwatch(elapsedMs);

  let fastestIdx = -1;
  let slowestIdx = -1;
  if (laps.length >= 2) {
    let min = Infinity;
    let max = -Infinity;
    laps.forEach((time, idx) => {
      if (time < min) {
        min = time;
        fastestIdx = idx;
      }
      if (time > max) {
        max = time;
        slowestIdx = idx;
      }
    });
  }

  return (
    <div className="flex h-full flex-col justify-between py-1 select-none">
      {/* 1. Main Time Counter */}
      <div className="flex flex-col items-center justify-center pt-2">
        <div className="flex items-baseline font-mono tracking-tight">
          <span
            className="text-5xl font-bold"
            style={{ color: isRunning ? "var(--notch-accent, #22d3ee)" : "var(--color-fg)" }}
          >
            {formatted.time}
          </span>
          <span className="text-2xl font-semibold opacity-70 ml-1">.{formatted.frac}</span>
        </div>
      </div>

      {/* 2. Laps Table */}
      <div className="my-2 flex-1 overflow-y-auto thin-scrollbar rounded-xl border border-white/5 bg-surface/30 p-2 min-h-[90px] max-h-[140px]">
        {laps.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted">
            {t("tools.stopwatch.noLaps")}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {laps.map((lapDuration, idx) => {
              const lapNum = laps.length - idx;
              const lapFormatted = formatStopwatch(lapDuration);
              const isFastest = idx === fastestIdx;
              const isSlowest = idx === slowestIdx;

              return (
                <div
                  key={lapNum}
                  className={`flex items-center justify-between px-2 py-1 rounded-lg text-xs font-mono transition-colors ${
                    isFastest
                      ? "bg-ok/10 text-ok font-semibold"
                      : isSlowest
                        ? "bg-live/10 text-live"
                        : "text-subtle hover:bg-white/5"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Flag className="size-3 opacity-60" />
                    <span>Lap {lapNum}</span>
                  </span>
                  <span>
                    +{lapFormatted.time}.{lapFormatted.frac}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Controls */}
      <div className="flex items-center justify-center gap-4 pt-1">
        <button
          type="button"
          onClick={reset}
          disabled={elapsedMs === 0 && !isRunning}
          title={t("tools.stopwatch.reset")}
          className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-surface/60 text-subtle hover:bg-surface hover:text-fg disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all shadow-sm"
        >
          <RotateCcw className="size-4" />
        </button>

        <button
          type="button"
          onClick={isRunning ? pause : start}
          title={isRunning ? t("tools.stopwatch.pause") : t("tools.stopwatch.start")}
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
          onClick={lap}
          disabled={!isRunning}
          title={t("tools.stopwatch.lap")}
          className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-surface/60 text-subtle hover:bg-surface hover:text-fg disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all shadow-sm"
        >
          <Flag className="size-4" />
        </button>
      </div>
    </div>
  );
}
