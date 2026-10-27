import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { events, ipc, type SystemStats } from "../../lib/ipc";
import { useMediaStore } from "../../stores/useMediaStore";
import { useTimerStore } from "../../stores/useTimerStore";
import { usePomodoroStore } from "../../stores/usePomodoroStore";
import { useNotificationStore } from "../../stores/useNotificationStore";
import { AppIcon } from "../../components/app-icon";
import { Bell, Flame, Plug, Timer, Zap } from "lucide-react";

function formatSeconds(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}:${String(remM).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatNetworkSpeed(mbps: number, bytesPerSec: number): string {
  if (mbps >= 100) {
    return `${Math.round(mbps)} Mbps`;
  }
  if (mbps >= 1) {
    return `${mbps.toFixed(1)} Mbps`;
  }
  if (bytesPerSec >= 1024) {
    const kbps = bytesPerSec / 1024;
    return `${Math.round(kbps)} KB/s`;
  }
  if (bytesPerSec > 0) {
    return `${bytesPerSec} B/s`;
  }
  return "0 KB/s";
}

function getBatteryColor(level: number | null | undefined, charging: boolean | undefined): string {
  if (charging) return "text-ok";
  if (level == null) return "text-subtle";
  if (level > 70) return "text-ok"; // > 70% Hijau
  if (level >= 50) return "text-amber-400"; // 50% - 70% Orange
  return "text-live"; // < 50% Merah
}

function getNetworkColor(
  mbps: number | undefined,
  bytesPerSec: number | undefined,
  isUpload = false,
): string {
  const m = mbps ?? 0;
  const b = bytesPerSec ?? 0;
  const highThreshold = isUpload ? 0.5 : 1.0;
  const highBytes = isUpload ? 64 * 1024 : 128 * 1024;
  const medThreshold = isUpload ? 0.05 : 0.1;
  const medBytes = isUpload ? 5 * 1024 : 10 * 1024;

  if (m >= highThreshold || b >= highBytes) {
    return "text-ok"; // Hijau saat aktif/kencang
  }
  if (m >= medThreshold || b >= medBytes) {
    return "text-amber-400"; // Orange saat moderat
  }
  return "text-live/85"; // Merah saat lambat/idle
}

export function IdleStatus({ visibleInCapture }: { visibleInCapture: boolean }) {
  const { i18n } = useTranslation();
  const { media } = useMediaStore();
  const [now, setNow] = useState(() => new Date());
  const [stats, setStats] = useState<SystemStats | null>(null);

  const isTimerRunning = useTimerStore((s) => s.isRunning);
  const isTimerCompleted = useTimerStore((s) => s.isCompleted);
  const timerRemaining = useTimerStore((s) => s.remainingSeconds);

  const isPomodoroRunning = usePomodoroStore((s) => s.isRunning);
  const pomodoroRemaining = usePomodoroStore((s) => s.remainingSeconds);
  const pomodoroMode = usePomodoroStore((s) => s.mode);

  const activePopup = useNotificationStore((s) => s.activePopup);

  const isTimerActive = isTimerRunning || isTimerCompleted || isPomodoroRunning;
  const isTimerOrNotifActive = isTimerActive || Boolean(activePopup);

  useEffect(() => {
    // 1-second clock tick
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

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
      clearInterval(timer);
      pending.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  // When media is actively playing, hide all other info and display media pill
  if (media.isPlaying) {
    const progressPercent =
      media.durationMs > 0 ? Math.min(100, (media.positionMs / media.durationMs) * 100) : 0;

    return (
      <div className="relative flex h-full w-full items-center justify-between px-5 text-fg select-none">
        {/* Left: Thumbnail & Track Title + Artist */}
        <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
          <div className="relative size-10 shrink-0 overflow-hidden rounded-[10px] bg-surface ring-1 ring-white/15 shadow-sm">
            {media.coverUrl ? (
              <img src={media.coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <AppIcon appName={media.appName || "Music"} size={40} />
            )}
          </div>

          <div className="flex flex-col min-w-0 flex-1 justify-center overflow-hidden">
            <span className="font-semibold text-fg truncate text-[13px] leading-tight">
              {media.title || "Music"}
            </span>
            <span className="text-[11px] text-subtle truncate opacity-75 leading-tight mt-0.5">
              {media.artist || media.appName || "Playing"}
            </span>
          </div>
        </div>

        {/* Right: Sound Rhythm Animation (Equalizer) & Live dot */}
        <div className="flex items-center gap-2.5 shrink-0 pl-1">
          <div
            className="flex items-end gap-[3px] h-5 px-0.5"
            title={`${media.title || "Music"} - ${media.artist || "Playing"}`}
          >
            <motion.span
              animate={{ height: ["4px", "18px", "6px", "20px", "4px"] }}
              transition={{ duration: 1.0, repeat: Infinity, ease: "easeInOut" }}
              className="w-[3px] rounded-full"
              style={{ backgroundColor: "var(--notch-accent, #f59e0b)" }}
            />
            <motion.span
              animate={{ height: ["12px", "6px", "20px", "8px", "12px"] }}
              transition={{ duration: 0.85, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
              className="w-[3px] rounded-full"
              style={{ backgroundColor: "var(--notch-accent, #f59e0b)" }}
            />
            <motion.span
              animate={{ height: ["6px", "18px", "4px", "18px", "6px"] }}
              transition={{ duration: 1.15, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
              className="w-[3px] rounded-full"
              style={{ backgroundColor: "var(--notch-accent, #f59e0b)" }}
            />
            <motion.span
              animate={{ height: ["10px", "20px", "12px", "4px", "10px"] }}
              transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: 0.1 }}
              className="w-[3px] rounded-full"
              style={{ backgroundColor: "var(--notch-accent, #f59e0b)" }}
            />
          </div>

          {visibleInCapture && (
            <span
              className="ml-1 size-2 shrink-0 rounded-full bg-live animate-pulse"
              title="Visible in screen capture"
            />
          )}
        </div>

        {/* Bottom: Progress Bar Lagu */}
        <div className="absolute inset-x-6 bottom-2 h-[2.5px] rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${progressPercent}%`,
              background: "var(--notch-accent, #f59e0b)",
            }}
          />
        </div>
      </div>
    );
  }

  const locale = i18n.language === "id" ? "id-ID" : "en-US";

  // Time format: HH:mm:ss
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  // Date format: e.g. "Sen, 26 Okt" or "Mon, Oct 26"
  const dateFormatted = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(now);

  // When timer or notification is active, display: tanggal - timer/notifikasi - jam
  if (isTimerOrNotifActive) {
    return (
      <div className="flex h-full w-full items-center justify-between px-5 text-fg select-none">
        {/* 1. Tanggal */}
        <div className="text-[11.5px] text-subtle font-medium truncate max-w-[100px] shrink-0">
          {dateFormatted}
        </div>

        <span className="text-[10px] text-muted/40 shrink-0" aria-hidden="true">
          •
        </span>

        {/* 2. Timer / Notifikasi */}
        <div className="flex items-center justify-center min-w-0 flex-1 px-2">
          {isTimerCompleted ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/20 border border-cyan-300/50 shadow-[0_0_16px_rgba(34,211,238,0.35)] font-mono text-[12.5px] font-bold text-cyan-200 animate-pulse">
              <Timer className="size-4 shrink-0 text-cyan-300" />
              <span className="text-white font-bold tracking-tight">00:00 Selesai!</span>
            </div>
          ) : isTimerRunning ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-400/35 font-mono text-[12.5px] font-semibold text-cyan-300">
              <Timer className="size-4 shrink-0 text-cyan-400" />
              <span>{formatSeconds(timerRemaining)}</span>
            </div>
          ) : isPomodoroRunning ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-400/35 font-mono text-[12.5px] font-semibold text-amber-300">
              <Flame className="size-4 shrink-0 text-amber-400 animate-pulse" />
              <span>{formatSeconds(pomodoroRemaining)}</span>
              <span className="text-[10px] opacity-75">
                ({pomodoroMode === "work" ? "Fokus" : "Break"})
              </span>
            </div>
          ) : activePopup ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-white/10 text-fg text-[12px] truncate max-w-[160px]">
              <Bell className="size-3.5 shrink-0 text-cyan-400" />
              <span className="truncate">{activePopup.title}</span>
            </div>
          ) : null}
        </div>

        <span className="text-[10px] text-muted/40 shrink-0" aria-hidden="true">
          •
        </span>

        {/* 3. Jam */}
        <div className="flex items-center gap-1 font-mono shrink-0">
          <span className="font-semibold text-fg text-[12.5px]">
            {hours}:{minutes}
          </span>
          <span className="text-[11px] text-subtle font-normal">:{seconds}</span>
          {visibleInCapture && (
            <span
              className="ml-1 size-2 shrink-0 rounded-full bg-live animate-pulse"
              title="Visible in screen capture"
            />
          )}
        </div>
      </div>
    );
  }

  const battery = stats?.battery;
  const network = stats?.network;
  const batteryColor = getBatteryColor(battery?.level, battery?.charging);

  const rxBytes = network?.rxBytesPerSec ?? 0;
  const txBytes = network?.txBytesPerSec ?? 0;
  // Tampilkan hanya salah satu: upload (naik) jika tx > rx, sebaliknya download (turun)
  const isUpload = txBytes > rxBytes;
  const activeMbps = isUpload ? (network?.txMbps ?? 0) : (network?.rxMbps ?? 0);
  const activeBytes = isUpload ? txBytes : rxBytes;
  const networkColor = getNetworkColor(activeMbps, activeBytes, isUpload);

  return (
    <div className="flex h-full w-full items-center justify-between px-4.5 text-[11px] font-medium tracking-tight text-fg select-none">
      {/* 1. Jam Realtime */}
      <div className="flex items-center gap-1 font-mono">
        <span className="font-semibold text-fg">
          {hours}:{minutes}
        </span>
        <span className="text-[10px] text-subtle font-normal">:{seconds}</span>
      </div>

      <span className="text-[9px] text-muted/40" aria-hidden="true">
        •
      </span>

      {/* 2. Tanggal */}
      <div className="text-[10.5px] text-subtle font-medium truncate max-w-[78px]">
        {dateFormatted}
      </div>

      <span className="text-[9px] text-muted/40" aria-hidden="true">
        •
      </span>

      {/* 3. Baterai */}
      <div
        className={`flex items-center gap-1 font-mono text-[10.5px] font-semibold ${batteryColor}`}
      >
        {battery?.charging ? (
          <span className="text-ok font-bold" title="Charging">
            <Zap className="size-3 fill-current" />
          </span>
        ) : battery?.level != null ? (
          <BatteryIcon level={battery.level} colorClass={batteryColor} />
        ) : (
          <span className="text-subtle" title="AC Power">
            <Plug className="size-3" />
          </span>
        )}
        <span>{battery?.level != null ? `${battery.level}%` : "AC"}</span>
      </div>

      <span className="text-[9px] text-muted/40" aria-hidden="true">
        •
      </span>

      {/* 4. Mbps Internet Realtime (Dinamis Up atau Down) */}
      <div
        className={`flex items-center gap-0.5 font-mono text-[10.5px] font-semibold ${networkColor}`}
        title={
          isUpload
            ? `Upload: ${formatNetworkSpeed(activeMbps, activeBytes)}`
            : `Download: ${formatNetworkSpeed(activeMbps, activeBytes)}`
        }
      >
        {isUpload ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="size-3 shrink-0"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="size-3 shrink-0"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        )}
        <span>{formatNetworkSpeed(activeMbps, activeBytes)}</span>
      </div>

      {/* Live capture dot */}
      {visibleInCapture && (
        <span
          className="ml-0.5 size-2 shrink-0 rounded-full bg-live animate-pulse"
          title="Visible in screen capture"
        />
      )}
    </div>
  );
}

function BatteryIcon({ level, colorClass }: { level: number; colorClass: string }) {
  // Clamped 0..100
  const pct = Math.max(0, Math.min(100, level));
  return (
    <svg
      viewBox="0 0 24 14"
      fill="none"
      className={`h-2.5 w-4 shrink-0 ${colorClass}`}
      aria-hidden="true"
    >
      <rect
        x="0.75"
        y="0.75"
        width="19.5"
        height="12.5"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        className="opacity-80"
      />
      <path d="M22 4.5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="2.5" y="2.5" width={(16 * pct) / 100} height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}
