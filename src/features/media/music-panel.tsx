import { useState, type ChangeEvent } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useMediaStore } from "../../stores/useMediaStore";
import { AppIcon } from "../../components/app-icon";

function formatTime(ms: number): string {
  if (!ms || ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function MusicPanel() {
  const { t } = useTranslation();
  const { media, togglePlayPause, next, previous, seek, setVolume, toggleMute, simulateTrack } =
    useMediaStore();

  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPos, setSeekPos] = useState(0);

  const hasTrack = Boolean(media.title || media.artist);
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

  const handleVolumeChange = (e: ChangeEvent<HTMLInputElement>) => {
    void setVolume(Number(e.target.value) / 100);
  };

  if (!hasTrack) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center select-none">
        {/* Animated Vinyl Icon */}
        <div className="relative mb-4 flex size-20 items-center justify-center rounded-full bg-gradient-to-tr from-surface to-elevated p-2 shadow-glass ring-1 ring-fg/10">
          <div className="size-full rounded-full border border-dashed border-fg/20 flex items-center justify-center">
            <div className="size-5 rounded-full bg-elevated ring-1 ring-fg/20" />
          </div>
        </div>

        <p className="text-sm font-semibold text-fg">
          {t("music.emptyTitle", "Tidak Ada Musik Sedang Diputar")}
        </p>
        <p className="mt-1 max-w-xs text-xs text-subtle">
          {t(
            "music.emptyHint",
            "Putar lagu di Spotify, YouTube Music, atau browser (Chrome/Edge) untuk mengontrol dari sini.",
          )}
        </p>

        {/* Supported Apps Pills */}
        <div className="mt-4 flex items-center gap-2">
          {["Spotify", "YouTube", "Chrome", "Edge"].map((app) => (
            <div
              key={app}
              className="flex items-center gap-1.5 rounded-full bg-surface/70 px-2.5 py-1 text-[11px] text-subtle ring-1 ring-fg/5"
            >
              <AppIcon appName={app} size={13} />
              <span>{app}</span>
            </div>
          ))}
        </div>

        {/* Test / Simulate Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            simulateTrack();
          }}
          className="mt-5 rounded-full glass-elevated px-4 py-1.5 text-xs font-medium text-fg hover:border-fg/25 active:scale-95 transition-all shadow-sm"
        >
          + {t("music.simulate", "Coba Putar Lagu Contoh")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-between p-4 select-none">
      {/* Top Header: App badge & Equalizer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 rounded-full bg-surface/70 px-3 py-1 ring-1 ring-fg/10">
          <AppIcon appName={media.appName || "Music"} size={16} />
          <span className="text-[11px] font-medium text-fg/90">
            {media.appName || t("music.nowPlaying", "Sedang Diputar")}
          </span>
        </div>

        {/* Live Audio Equalizer Bars */}
        <div
          className="flex items-end gap-1 h-4 px-1"
          title={media.isPlaying ? "Playing" : "Paused"}
        >
          {[0.6, 1.0, 0.4, 0.8].map((scale, i) => (
            <motion.span
              key={i}
              animate={
                media.isPlaying
                  ? {
                      height: ["4px", `${scale * 16}px`, "4px"],
                    }
                  : { height: "4px" }
              }
              transition={
                media.isPlaying
                  ? {
                      duration: 0.8 + i * 0.15,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }
                  : {}
              }
              className="w-1 rounded-full bg-accent/80"
            />
          ))}
        </div>
      </div>

      {/* Main Track Info + Artwork */}
      <div className="my-auto flex items-center gap-4 py-2">
        {/* Album Artwork */}
        <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl bg-surface/80 shadow-glass ring-1 ring-fg/15">
          {media.coverUrl ? (
            <img src={media.coverUrl} alt={media.title} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center bg-gradient-to-br from-surface via-elevated to-surface">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="size-9 text-muted/80"
              >
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" fill="currentColor" fillOpacity="0.2" />
                <circle cx="18" cy="16" r="3" fill="currentColor" fillOpacity="0.2" />
              </svg>
            </div>
          )}
        </div>

        {/* Track Title and Artist */}
        <div className="flex-1 min-w-0 pr-1">
          <h3 className="text-sm font-semibold text-fg truncate leading-tight" title={media.title}>
            {media.title || t("music.unknownTitle", "Lagu Tidak Diketahui")}
          </h3>
          <p className="text-xs text-subtle truncate mt-1" title={media.artist}>
            {media.artist || t("music.unknownArtist", "Artis Tidak Diketahui")}
          </p>
          {media.album && (
            <p className="text-[10px] text-muted truncate mt-0.5" title={media.album}>
              {media.album}
            </p>
          )}
        </div>
      </div>

      {/* Bottom Controls: Timeline & Buttons & Volume */}
      <div className="space-y-3">
        {/* Timeline Scrubber */}
        <div className="space-y-1">
          <div className="relative flex items-center h-4 group">
            {/* Background track */}
            <div className="h-1.5 w-full rounded-full bg-fg/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent to-accent/60 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {/* Native range slider for smooth scrubbing */}
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

          <div className="flex justify-between text-[10px] text-muted font-variant-numeric tabular-nums">
            <span>{formatTime(currentPos)}</span>
            <span>{formatTime(media.durationMs)}</span>
          </div>
        </div>

        {/* Playback Control Buttons */}
        <div className="flex items-center justify-between pt-1">
          {/* Master Volume Slider & Mute Toggle */}
          <div className="flex items-center gap-2 w-32">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void toggleMute();
              }}
              title={media.isMuted ? "Unmute" : "Mute"}
              className="text-muted hover:text-fg transition-colors p-1"
            >
              {media.isMuted || media.volume === 0 ? (
                <MuteIcon />
              ) : media.volume < 0.5 ? (
                <VolumeLowIcon />
              ) : (
                <VolumeHighIcon />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={media.isMuted ? 0 : Math.round(media.volume * 100)}
              onChange={handleVolumeChange}
              onClick={(e) => e.stopPropagation()}
              className="w-full h-1 bg-fg/15 rounded-lg appearance-none cursor-pointer accent-accent"
            />
          </div>

          {/* Transport buttons: Previous, Play/Pause, Next */}
          <div className="flex items-center gap-3">
            {/* Previous Track */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void previous();
              }}
              aria-label={t("music.previous")}
              className="flex size-9 items-center justify-center rounded-full glass-surface text-muted hover:text-fg hover:bg-elevated transition-all active:scale-95"
            >
              <PrevIcon />
            </button>

            {/* Play / Pause Toggle Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void togglePlayPause();
              }}
              aria-label={media.isPlaying ? "Pause" : "Play"}
              className="flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent/60 text-bg shadow-glass-card hover:brightness-110 active:scale-90 transition-all font-bold"
            >
              {media.isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>

            {/* Next Track */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void next();
              }}
              aria-label={t("music.next")}
              className="flex size-9 items-center justify-center rounded-full glass-surface text-muted hover:text-fg hover:bg-elevated transition-all active:scale-95"
            >
              <NextIcon />
            </button>
          </div>

          {/* Dummy placeholder for layout symmetry */}
          <div className="w-32 flex justify-end">
            <span className="text-[10px] text-muted/60">{Math.round(media.volume * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5 ml-0.5">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function VolumeHighIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function VolumeLowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}
