import { useEffect, useState, type ChangeEvent } from "react";
import { motion } from "motion/react";
import { events, ipc, type SystemStats } from "../../lib/ipc";
import { useMediaStore } from "../../stores/useMediaStore";
import { AppIcon } from "../../components/app-icon";
import { Check, Flame, Zap } from "lucide-react";

function formatTime(ms: number): string {
  if (!ms || ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatGb(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "0";
  const gb = bytes / (1024 * 1024 * 1024);
  return gb.toFixed(1);
}

function getCpuColor(cpu: number): string {
  if (cpu >= 75) return "text-live";
  if (cpu >= 50) return "text-amber-400";
  return "text-ok";
}

function getTempColor(temp: number): string {
  if (temp >= 80) return "text-live";
  if (temp >= 65) return "text-amber-400";
  return "text-ok";
}

function getRamColor(pct: number): string {
  if (pct >= 85) return "text-live";
  if (pct >= 65) return "text-amber-400";
  return "text-ok";
}

export function PeekStatus({ visibleInCapture }: { visibleInCapture: boolean }) {
  const { media, togglePlayPause, previous, next, seek } = useMediaStore();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPos, setSeekPos] = useState(0);

  useEffect(() => {
    // Initial stats fetch
    void ipc
      .getSystemStats()
      .then(setStats)
      .catch(() => {});

    // Listen to background stats emitter (1 Hz)
    const pending = events.systemStats((payload) => {
      setStats(payload);
    });

    return () => {
      pending.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const hasMedia = media.isPlaying || Boolean(media.title && media.title.length > 0);
  const currentPos = isSeeking ? seekPos : media.positionMs;
  const progressPercent =
    media.durationMs > 0 ? Math.min(100, (currentPos / media.durationMs) * 100) : 0;

  const handleSeekChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSeekPos(Number(e.target.value));
  };

  const handleSeekCommit = () => {
    setIsSeeking(false);
    void seek(seekPos);
  };

  // If there is active media, hide other info and show full playback controls
  if (hasMedia) {
    return (
      <div className="relative flex h-full w-full items-center justify-between px-5 text-fg select-none">
        {/* 1. Left: Album Cover + Title + Artist */}
        <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
          <div className="relative size-10 shrink-0 overflow-hidden rounded-[10px] bg-surface ring-1 ring-white/15 shadow-sm">
            {media.coverUrl ? (
              <img src={media.coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <AppIcon appName={media.appName || "Music"} size={40} />
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1 justify-center overflow-hidden">
            <div
              className="text-[13px] font-semibold text-fg truncate leading-tight"
              title={media.title}
            >
              {media.title || "Music"}
            </div>
            <div
              className="text-[11px] text-subtle truncate mt-0.5 opacity-80 leading-tight"
              title={media.artist}
            >
              {media.artist || media.appName || "Playing"}
            </div>
          </div>
        </div>

        {/* 2. Center: Button Controls (Prev, Play/Pause, Next) */}
        <div className="flex items-center gap-3 shrink-0 px-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void previous();
            }}
            title="Previous track"
            className="flex size-8 items-center justify-center rounded-full text-muted hover:text-fg hover:bg-white/10 active:scale-90 transition-all"
          >
            <PrevIconSmall />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void togglePlayPause();
            }}
            title={media.isPlaying ? "Pause" : "Play"}
            className="flex size-10 items-center justify-center rounded-full text-slate-950 hover:brightness-110 active:scale-90 transition-all shadow-md font-bold"
            style={{ backgroundColor: "var(--notch-accent, #f59e0b)" }}
          >
            {media.isPlaying ? <PauseIconSmall /> : <PlayIconSmall />}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void next();
            }}
            title="Next track"
            className="flex size-8 items-center justify-center rounded-full text-muted hover:text-fg hover:bg-white/10 active:scale-90 transition-all"
          >
            <NextIconSmall />
          </button>
        </div>

        {/* 3. Right: Time Duration + Animasi Ritme Suara */}
        <div className="flex items-center gap-2 shrink-0 pl-1">
          <div className="text-[10.5px] text-muted font-mono tabular-nums">
            <span>{formatTime(currentPos)}</span>
            {media.durationMs > 0 && (
              <span className="opacity-60"> / {formatTime(media.durationMs)}</span>
            )}
          </div>

          {/* Animasi Ritme Suara (Equalizer Waveform) */}
          <div
            className="flex items-end gap-[2px] h-3.5 px-0.5"
            title={media.isPlaying ? "Playing" : "Paused"}
          >
            <motion.span
              animate={
                media.isPlaying
                  ? { height: ["3px", "14px", "6px", "14px", "3px"] }
                  : { height: "3px" }
              }
              transition={
                media.isPlaying ? { duration: 1.0, repeat: Infinity, ease: "easeInOut" } : {}
              }
              className="w-[2px] rounded-full"
              style={{ backgroundColor: "var(--notch-accent, #22d3ee)" }}
            />
            <motion.span
              animate={
                media.isPlaying
                  ? { height: ["8px", "4px", "14px", "5px", "8px"] }
                  : { height: "4px" }
              }
              transition={
                media.isPlaying
                  ? { duration: 0.85, repeat: Infinity, ease: "easeInOut", delay: 0.15 }
                  : {}
              }
              className="w-[2px] rounded-full"
              style={{ backgroundColor: "var(--notch-accent, #22d3ee)" }}
            />
            <motion.span
              animate={
                media.isPlaying
                  ? { height: ["4px", "12px", "4px", "13px", "4px"] }
                  : { height: "3px" }
              }
              transition={
                media.isPlaying
                  ? { duration: 1.15, repeat: Infinity, ease: "easeInOut", delay: 0.3 }
                  : {}
              }
              className="w-[2px] rounded-full"
              style={{ backgroundColor: "var(--notch-accent, #22d3ee)" }}
            />
            <motion.span
              animate={
                media.isPlaying
                  ? { height: ["6px", "14px", "7px", "3px", "6px"] }
                  : { height: "4px" }
              }
              transition={
                media.isPlaying
                  ? { duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: 0.1 }
                  : {}
              }
              className="w-[2px] rounded-full"
              style={{ backgroundColor: "var(--notch-accent, #22d3ee)" }}
            />
          </div>

          {visibleInCapture && (
            <span
              className="ml-0.5 size-1.5 shrink-0 rounded-full bg-live animate-pulse"
              title="Visible in screen capture"
            />
          )}
        </div>

        {/* 4. Bottom: Interactive Progress Bar Scrubber */}
        <div className="absolute inset-x-6 bottom-2 flex items-center h-2 group">
          <div className="h-[2.5px] w-full rounded-full bg-white/10 group-hover:h-[4px] transition-all overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${progressPercent}%`,
                background: "var(--notch-accent, #f59e0b)",
              }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={media.durationMs || 100}
            value={currentPos}
            onMouseDown={() => setIsSeeking(true)}
            onTouchStart={() => setIsSeeking(true)}
            onChange={handleSeekChange}
            onMouseUp={handleSeekCommit}
            onTouchEnd={handleSeekCommit}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 size-full opacity-0 cursor-pointer"
          />
        </div>
      </div>
    );
  }

  const hw = stats?.hardware;
  const cpuUsage = hw?.cpuUsage ?? 0;
  const cpuTemp = hw?.cpuTemp ?? 42;
  const ramUsed = formatGb(hw?.ramUsedBytes);
  const ramTotal = formatGb(hw?.ramTotalBytes);
  const ramPct = Math.round(hw?.ramUsagePercent ?? 0);
  const isHeavy = hw?.isHeavyLoad ?? false;
  const topApp = hw?.topProcess;

  const cpuColor = getCpuColor(cpuUsage);
  const tempColor = getTempColor(cpuTemp);
  const ramColor = getRamColor(ramPct);

  return (
    <div className="flex h-full w-full items-center justify-between px-3 text-[11px] font-medium tracking-tight text-fg select-none">
      {/* 1. CPU & Suhu */}
      <div className="flex items-center gap-1.5 font-mono">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="size-3.5 shrink-0 text-subtle"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
        </svg>
        <span className={`font-semibold ${cpuColor}`}>CPU {cpuUsage}%</span>
        <span className="text-[10px] text-muted">•</span>
        <span
          className={`font-semibold ${tempColor}`}
          title={hw?.isTempEstimated ? "Suhu estimasi dari beban CPU" : "Suhu CPU sensor"}
        >
          {Math.round(cpuTemp)}°C
        </span>
      </div>

      <div className="h-3.5 w-px bg-elevated/70 shrink-0" aria-hidden="true" />

      {/* 2. Status RAM */}
      <div className="flex items-center gap-1.5 font-mono">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="size-3.5 shrink-0 text-subtle"
          aria-hidden="true"
        >
          <path d="M2 7h20v10H2zM6 11v2M10 11v2M14 11v2M18 11v2" />
        </svg>
        <span className="font-semibold text-fg">
          RAM {ramUsed}/{ramTotal} GB
        </span>
        <span className={`text-[10px] font-semibold ${ramColor}`}>({ramPct}%)</span>
      </div>

      <div className="h-3.5 w-px bg-elevated/70 shrink-0" aria-hidden="true" />

      {/* 3. Indikator Penggunaan Resource (Aplikasi Berat) */}
      <div className="flex items-center min-w-0 max-w-[160px]">
        {isHeavy ? (
          <div
            className="flex items-center gap-1 rounded-full bg-live/15 px-2 py-0.5 text-[10px] font-semibold text-live border border-live/30 animate-pulse truncate"
            title={`Beban berat terdeteksi: ${topApp ? `${topApp.name} (${topApp.cpuUsage}%)` : "CPU/RAM tinggi"}`}
          >
            <Flame className="size-3 text-live shrink-0 fill-current" />
            <span className="truncate">
              {topApp
                ? `${topApp.name.replace(/\.exe$/i, "")} ${topApp.cpuUsage}%`
                : "Beban Tinggi"}
            </span>
          </div>
        ) : topApp ? (
          <div
            className="flex items-center gap-1 rounded-full bg-surface/80 px-2 py-0.5 text-[10px] font-medium text-subtle border border-elevated/60 truncate"
            title={`Proses teratas: ${topApp.name} (${topApp.cpuUsage}%)`}
          >
            <Zap className="size-2.5 text-ok shrink-0 fill-current" />
            <span className="truncate">{topApp.name.replace(/\.exe$/i, "")}</span>
            <span className="text-[9px] font-mono opacity-70">{topApp.cpuUsage}%</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 rounded-full bg-surface/80 px-2 py-0.5 text-[10px] font-medium text-ok border border-elevated/60">
            <Check className="size-3 text-ok shrink-0 stroke-[2.5]" />
            <span>Optimal</span>
          </div>
        )}
      </div>

      {/* Stealth indicator */}
      {visibleInCapture ? (
        <span
          className="ml-1 size-2 shrink-0 rounded-full bg-live animate-pulse"
          title="Visible in screen capture"
        />
      ) : (
        <span
          className="ml-1 size-1.5 shrink-0 rounded-full bg-ok/80"
          title="Hidden from screen capture"
        />
      )}
    </div>
  );
}

function PrevIconSmall() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
      <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
    </svg>
  );
}

function NextIconSmall() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
    </svg>
  );
}

function PlayIconSmall() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 ml-0.5">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIconSmall() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}
