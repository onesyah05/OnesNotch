import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  Film,
  FolderOpen,
  Play,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  Sparkles,
  Plus,
  Clock,
  Shuffle,
  Info,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useVideoStore, type VideoItem } from "../../stores/useVideoStore";

export function NotchVideoSettings() {
  const { t } = useTranslation();
  const {
    settings,
    activePlayingVideo,
    updateSettings,
    addVideosFromPaths,
    addVideoUrl,
    addSampleVideos,
    removeVideo,
    clearVideos,
    testPlayVideo,
    stopPlaying,
  } = useVideoStore();

  const [isPicking, setIsPicking] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");

  const handlePickFiles = async () => {
    setIsPicking(true);
    try {
      const selected = await ipc.videoPickFiles();
      if (selected && selected.length > 0) {
        addVideosFromPaths(selected);
      }
    } catch (err) {
      console.error("Failed to pick video files:", err);
    } finally {
      setIsPicking(false);
    }
  };

  const handleAddManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualUrl.trim()) return;
    addVideoUrl(manualName.trim() || "Video Online", manualUrl.trim());
    setManualName("");
    setManualUrl("");
    setShowManualInput(false);
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl glass-surface p-4 border border-white/10">
      {/* 1. Header & Main Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Film className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">
                {t("settings.appearance.videoTitle", "Video Animasi Notch (MP4)")}
              </h3>
              {settings.enabled && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Aktif
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              {t(
                "settings.appearance.videoSubtitle",
                "Otomatis putar video MP4 secara acak di pill notch setiap interval waktu",
              )}
            </p>
          </div>
        </div>

        {/* Master Toggle */}
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => updateSettings({ enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-surface rounded-full peer peer-checked:bg-cyan-500 peer-focus:outline-none transition-colors border border-white/15 peer-checked:border-cyan-400/50 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white shadow-inner" />
        </label>
      </div>

      {/* 2. Timing & Playback Controls (Visible even if off for easy config) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-white/5">
        {/* Interval Setting */}
        <div className="flex flex-col gap-1.5 rounded-xl bg-surface/40 p-3 border border-white/5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-subtle font-medium">
              <Clock className="size-3.5 text-cyan-400" />
              Interval Putar (Detik)
            </span>
            <span className="font-mono text-cyan-400 font-semibold">
              {settings.intervalSeconds}s
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={settings.intervalSeconds}
              onChange={(e) => updateSettings({ intervalSeconds: Number(e.target.value) })}
              className="flex-1 accent-cyan-400 cursor-pointer"
            />
            <input
              type="number"
              min={5}
              max={3600}
              value={settings.intervalSeconds}
              onChange={(e) =>
                updateSettings({
                  intervalSeconds: Math.max(5, Number(e.target.value) || 5),
                })
              }
              className="w-16 rounded-lg bg-surface/80 border border-white/15 px-2 py-1 text-center font-mono text-xs text-fg focus:outline-none focus:border-cyan-400"
            />
          </div>
          <span className="text-[11px] text-muted">
            Setiap {settings.intervalSeconds} detik, 1 video dipilih acak dan diputar di notch.
          </span>
        </div>

        {/* Duration Setting */}
        <div className="flex flex-col gap-1.5 rounded-xl bg-surface/40 p-3 border border-white/5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-subtle font-medium">
              <Film className="size-3.5 text-purple-400" />
              Durasi Tampil (Detik)
            </span>
            <span className="font-mono text-purple-400 font-semibold">
              {settings.durationSeconds === 0 ? "Penuh (Full)" : `${settings.durationSeconds}s`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={settings.durationSeconds}
              onChange={(e) => updateSettings({ durationSeconds: Number(e.target.value) })}
              className="flex-1 accent-purple-400 cursor-pointer"
            />
            <input
              type="number"
              min={0}
              max={300}
              value={settings.durationSeconds}
              onChange={(e) =>
                updateSettings({
                  durationSeconds: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="w-16 rounded-lg bg-surface/80 border border-white/15 px-2 py-1 text-center font-mono text-xs text-fg focus:outline-none focus:border-purple-400"
            />
          </div>
          <span className="text-[11px] text-muted">
            {settings.durationSeconds === 0
              ? "Video diputar sampai habis (on ended) lalu kembali ke jam."
              : `Tampil selama ${settings.durationSeconds} detik lalu otomatis kembali ke jam.`}
          </span>
        </div>
      </div>

      {/* 3. Audio & Display Options */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface/30 p-2.5 border border-white/5 text-xs">
        {/* Mute Toggle */}
        <button
          type="button"
          onClick={() => updateSettings({ muted: !settings.muted })}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
            settings.muted
              ? "bg-surface border-white/10 text-subtle hover:text-fg"
              : "bg-cyan-500/15 border-cyan-500/30 text-cyan-400 font-medium"
          }`}
        >
          {settings.muted ? (
            <>
              <VolumeX className="size-3.5 text-muted" />
              <span>Audio Dibisukan (Muted)</span>
            </>
          ) : (
            <>
              <Volume2 className="size-3.5 text-cyan-400" />
              <span>Suara Aktif</span>
            </>
          )}
        </button>

        {/* Fit Toggle */}
        <div className="flex items-center gap-1.5">
          <span className="text-muted text-[11px]">Format:</span>
          <button
            type="button"
            onClick={() => updateSettings({ objectFit: "cover" })}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
              settings.objectFit === "cover"
                ? "bg-white/15 text-fg shadow-sm border border-white/20"
                : "text-muted hover:text-subtle"
            }`}
          >
            Penuh (Cover)
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ objectFit: "contain" })}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
              settings.objectFit === "contain"
                ? "bg-white/15 text-fg shadow-sm border border-white/20"
                : "text-muted hover:text-subtle"
            }`}
          >
            Proporsional (Contain)
          </button>
        </div>
      </div>

      {/* 4. Multi-MP4 Input Bar */}
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-fg flex items-center gap-1.5">
              <Shuffle className="size-3.5 text-cyan-400" />
              Daftar Koleksi Video ({settings.videos.length})
            </span>
            {settings.videos.length > 0 && (
              <span className="text-[11px] text-muted">
                • Diputar acak setiap {settings.intervalSeconds}s
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Native Multiselect File Picker */}
            <button
              type="button"
              disabled={isPicking}
              onClick={handlePickFiles}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 active:scale-95 transition-all shadow-sm disabled:opacity-50"
            >
              <FolderOpen className="size-3.5 text-cyan-400" />
              <span>{isPicking ? "Membuka Dialog..." : "📁 Pilih File MP4 (Multi)"}</span>
            </button>

            {/* Demo Sample Button */}
            <button
              type="button"
              onClick={addSampleVideos}
              title="Tambahkan video contoh animasi bawaan"
              className="flex items-center gap-1 rounded-lg border border-white/15 bg-surface px-2.5 py-1.5 text-xs font-medium text-subtle hover:text-fg hover:bg-elevated active:scale-95 transition-all"
            >
              <Sparkles className="size-3.5 text-amber-400" />
              <span>+ Demo Clip</span>
            </button>

            {/* Manual URL / Path button */}
            <button
              type="button"
              onClick={() => setShowManualInput(!showManualInput)}
              title="Input via URL atau path manual"
              className="flex items-center gap-1 rounded-lg border border-white/15 bg-surface px-2 py-1.5 text-xs text-subtle hover:text-fg hover:bg-elevated active:scale-95 transition-all"
            >
              <Plus className="size-3.5" />
            </button>

            {settings.videos.length > 1 && (
              <button
                type="button"
                onClick={clearVideos}
                title="Hapus Semua Video"
                className="flex items-center gap-1 rounded-lg border border-live/20 bg-live/10 px-2 py-1.5 text-xs text-live hover:bg-live/20 active:scale-95 transition-all"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Manual URL Input Form dropdown */}
        <AnimatePresence>
          {showManualInput && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={handleAddManual}
              className="flex flex-col sm:flex-row items-center gap-2 rounded-xl bg-surface/60 p-2.5 border border-white/10"
            >
              <input
                type="text"
                placeholder="Nama Video (opsional)"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                className="w-full sm:w-1/3 rounded-lg bg-surface border border-white/15 px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-cyan-400"
              />
              <input
                type="text"
                required
                placeholder="Path file (C:\...) atau URL (https://...mp4)"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                className="w-full sm:flex-1 rounded-lg bg-surface border border-white/15 px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-cyan-400"
              />
              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                <button
                  type="submit"
                  className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-cyan-400 active:scale-95 transition-all"
                >
                  Tambah
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualInput(false)}
                  className="rounded-lg bg-surface px-2 py-1.5 text-xs text-subtle hover:text-fg"
                >
                  Batal
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* 5. Video List */}
        {settings.videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-surface/20 p-6 text-center">
            <div className="size-10 rounded-full bg-white/5 flex items-center justify-center text-muted">
              <Film className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-subtle">Belum ada video MP4 yang dimasukkan</p>
              <p className="text-[11px] text-muted max-w-sm mt-0.5">
                Klik tombol <strong>Pilih File MP4</strong> untuk memilih satu atau banyak video
                dari komputer Anda, atau klik <strong>+ Demo Clip</strong> untuk mencoba video
                bawaan.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
            {settings.videos.map((vid: VideoItem, index: number) => {
              const isCurrentlyPlaying = activePlayingVideo?.id === vid.id;

              return (
                <div
                  key={vid.id}
                  className={`flex items-center justify-between gap-2 rounded-xl p-2.5 border transition-all ${
                    isCurrentlyPlaying
                      ? "bg-cyan-500/10 border-cyan-500/40 shadow-sm"
                      : "bg-surface/40 border-white/5 hover:border-white/15 hover:bg-surface/60"
                  }`}
                >
                  {/* Left: Index, Icon, Name & Path */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="font-mono text-[11px] text-muted w-4 text-center">
                      {index + 1}
                    </span>
                    <div className="size-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0 text-cyan-400">
                      <Film className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-fg truncate">{vid.name}</span>
                        {isCurrentlyPlaying && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-cyan-400 text-black uppercase">
                            Sedang Tayang
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-muted truncate">{vid.path}</p>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Preview / Stop in Notch button */}
                    {isCurrentlyPlaying ? (
                      <button
                        type="button"
                        onClick={stopPlaying}
                        title="Hentikan tayangan di Notch"
                        className="flex items-center gap-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-1 text-xs font-medium hover:bg-amber-500/30 active:scale-95 transition-all"
                      >
                        <Square className="size-3 fill-current" />
                        <span>Stop</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => testPlayVideo(vid)}
                        title="Putar langsung di Pill Notch sekarang"
                        className="flex items-center gap-1 rounded-lg bg-surface border border-white/15 text-subtle hover:text-cyan-400 hover:border-cyan-500/40 hover:bg-surface/80 px-2 py-1 text-xs font-medium active:scale-95 transition-all"
                      >
                        <Play className="size-3 fill-current" />
                        <span>Test Play</span>
                      </button>
                    )}

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={() => removeVideo(vid.id)}
                      title="Hapus Video Ini"
                      className="size-7 flex items-center justify-center rounded-lg text-muted hover:text-live hover:bg-live/10 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info notice */}
      <div className="flex items-start gap-2 rounded-xl bg-white/5 p-2.5 text-[11px] text-muted border border-white/5">
        <Info className="size-3.5 text-cyan-400 shrink-0 mt-0.5" />
        <span>
          Video otomatis diputar secara bergantian (random) saat notch dalam kondisi idle. Anda
          dapat mengarahkan mouse ke notch saat video tayang untuk melihat judul dan tombol suara.
        </span>
      </div>
    </div>
  );
}
