import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Volume2, VolumeX, X } from "lucide-react";
import type { VideoItem, VideoSettings } from "../../stores/useVideoStore";

interface NotchVideoPlayerProps {
  video: VideoItem;
  settings: VideoSettings;
  onFinished: () => void;
}

function resolveVideoSrc(path: string): string {
  if (!path) return "";
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("blob:")
  ) {
    return path;
  }
  try {
    return convertFileSrc(path);
  } catch (err) {
    console.error("[NotchVideoPlayer] convertFileSrc error:", err);
    return path;
  }
}

export function NotchVideoPlayer({ video, settings, onFinished }: NotchVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(settings.muted);
  const [loadError, setLoadError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const src = resolveVideoSrc(video.path);

  // Auto-play handling with unmuted policy fallback
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src) return;

    el.defaultMuted = isMuted;
    el.muted = isMuted;

    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise.catch((err: unknown) => {
        console.warn("[NotchVideoPlayer] Autoplay blocked, falling back to muted:", err);
        // Fallback to muted playback if blocked by browser policy
        if (!isMuted) {
          setIsMuted(true);
          el.muted = true;
          el.play().catch(() => {});
        }
      });
    }
  }, [src, isMuted]);

  // Duration timeout fallback if durationSeconds > 0
  useEffect(() => {
    if (settings.durationSeconds > 0) {
      const timer = setTimeout(() => {
        onFinished();
      }, settings.durationSeconds * 1000);
      return () => clearTimeout(timer);
    }
  }, [settings.durationSeconds, onFinished, video.id]);

  if (loadError || !src) {
    return (
      <div className="relative size-full flex items-center justify-between px-4 rounded-full bg-ink-950 text-xs text-subtle border border-live/30">
        <div className="flex items-center gap-1.5 truncate max-w-[220px]">
          <span className="size-1.5 rounded-full bg-live shrink-0" />
          <span className="truncate text-muted text-[11px]">
            {errorMessage || `Error memutar: ${video.name}`}
          </span>
        </div>
        <button
          type="button"
          onClick={onFinished}
          title="Tutup pesan error"
          className="size-6 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-fg"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="group relative size-full overflow-hidden rounded-full bg-black select-none ring-1 ring-white/15 shadow-notch">
      {/* HTML5 Video element */}
      <video
        ref={videoRef}
        src={src}
        autoPlay
        playsInline
        preload="auto"
        muted={isMuted}
        onEnded={onFinished}
        onError={(e) => {
          const err = e.currentTarget.error;
          let detail = "Format atau akses video ditolak";
          if (err) {
            if (err.code === 2) detail = "Gagal memuat file (Network/IO)";
            else if (err.code === 3) detail = "Codec video tidak didukung";
            else if (err.code === 4) detail = "Akses file ditolak (Protocol)";
          }
          console.error("[NotchVideoPlayer] Media error:", err, "src:", src);
          setErrorMessage(detail);
          setLoadError(true);
        }}
        className={`size-full ${settings.objectFit === "contain" ? "object-contain" : "object-cover"} rounded-full pointer-events-none transition-transform duration-300`}
      />

      {/* Subtle overlay gradient on hover */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-t from-black/60 via-transparent to-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />

      {/* Controls on hover */}
      <div className="absolute inset-0 flex items-center justify-between px-3.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto">
        {/* Left: Video label */}
        <div className="flex items-center gap-1.5 min-w-0 max-w-[170px] drop-shadow-md">
          <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
          <span className="text-[11px] font-medium text-white truncate">{video.name}</span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title={isMuted ? "Unmute" : "Mute"}
            onClick={(e) => {
              e.stopPropagation();
              setIsMuted(!isMuted);
            }}
            className="flex size-6 items-center justify-center rounded-full bg-black/60 text-white/90 hover:bg-black/90 hover:text-white transition-all active:scale-95 border border-white/20 shadow-sm"
          >
            {isMuted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
          </button>

          <button
            type="button"
            title="Tutup Video"
            onClick={(e) => {
              e.stopPropagation();
              onFinished();
            }}
            className="flex size-6 items-center justify-center rounded-full bg-black/60 text-white/90 hover:bg-black/90 hover:text-white transition-all active:scale-95 border border-white/20 shadow-sm"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
