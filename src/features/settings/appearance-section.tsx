import { useState, type ChangeEvent } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { SectionTitle } from "../../components/rows";
import { ipc } from "../../lib/ipc";
import { useNotchStore } from "../../stores/useNotchStore";
import {
  ACCENT_PRESETS,
  BG_PRESETS,
  DEFAULT_THEME,
  useThemeStore,
} from "../../stores/useThemeStore";
import { NotchVideoSettings } from "./notch-video-settings";

const MIN_OPACITY = 30;

function isValidHex(hex: string): boolean {
  return /^#([0-9A-Fa-f]{3}){1,2}$/.test(hex);
}

function normalizeHex(hex: string): string {
  if (!hex.startsWith("#")) {
    hex = `#${hex}`;
  }
  return hex.toUpperCase();
}

export function AppearanceSection() {
  const { t } = useTranslation();
  const opacity = useNotchStore((state) => state.opacity);
  const { theme, setBackgroundColor, setAccentColor, resetDefaults } = useThemeStore();

  const [bgInput, setBgInput] = useState(theme.backgroundColor);
  const [accentInput, setAccentInput] = useState(theme.accentColor);

  const changeOpacity = (value: number) => {
    const clamped = Math.min(100, Math.max(MIN_OPACITY, value));
    useNotchStore.getState().setOpacity(clamped);
    void ipc.setOpacity(clamped).catch(() => {});
  };

  const handleBgColorPicker = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setBgInput(val);
    void setBackgroundColor(val);
  };

  const handleBgHexChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setBgInput(raw);
    const normalized = normalizeHex(raw);
    if (isValidHex(normalized)) {
      void setBackgroundColor(normalized);
    }
  };

  const handleAccentColorPicker = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setAccentInput(val);
    void setAccentColor(val);
  };

  const handleAccentHexChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setAccentInput(raw);
    const normalized = normalizeHex(raw);
    if (isValidHex(normalized)) {
      void setAccentColor(normalized);
    }
  };

  const isDefaultTheme =
    theme.backgroundColor.toLowerCase() === DEFAULT_THEME.backgroundColor.toLowerCase() &&
    theme.accentColor.toLowerCase() === DEFAULT_THEME.accentColor.toLowerCase();

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title={t("settings.appearance.title")} />

      {/* 1. Live Mini Notch Preview */}
      <div className="flex flex-col gap-2 rounded-2xl glass-surface p-4 border border-white/10">
        <div className="flex items-center justify-between text-xs text-subtle font-medium">
          <span>{t("settings.appearance.preview")}</span>
          <span className="text-[11px] text-muted">{t("settings.appearance.previewSubtitle")}</span>
        </div>

        <div className="relative flex h-28 items-center justify-center rounded-xl bg-black/40 p-4 overflow-hidden border border-white/5">
          {/* Simulated Mini Notch Pill */}
          <div
            className="relative flex h-9 w-72 max-w-full items-center justify-between px-3 rounded-full border border-white/15 shadow-notch transition-colors duration-200"
            style={{ backgroundColor: theme.backgroundColor || DEFAULT_THEME.backgroundColor }}
          >
            {/* Left: Music info */}
            <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
              <div className="size-5 rounded-md bg-white/10 flex items-center justify-center shrink-0">
                <svg className="size-3 text-fg opacity-85" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
              <div className="flex items-center gap-1.5 min-w-0 text-[11px] font-medium truncate">
                <span className="text-fg truncate">Midnight Waves</span>
                <span className="text-subtle text-[10px] opacity-75 truncate">• Lo-Fi</span>
              </div>
            </div>

            {/* Right: Sound Rhythm Animated Equalizer */}
            <div className="flex items-end gap-[2px] h-3.5 px-0.5 shrink-0">
              <motion.span
                animate={{ height: ["3px", "12px", "5px", "13px", "3px"] }}
                transition={{ duration: 1.0, repeat: Infinity, ease: "easeInOut" }}
                className="w-[2px] rounded-full"
                style={{ backgroundColor: theme.accentColor || DEFAULT_THEME.accentColor }}
              />
              <motion.span
                animate={{ height: ["7px", "3px", "13px", "6px", "7px"] }}
                transition={{ duration: 0.85, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
                className="w-[2px] rounded-full"
                style={{ backgroundColor: theme.accentColor || DEFAULT_THEME.accentColor }}
              />
              <motion.span
                animate={{ height: ["4px", "11px", "3px", "12px", "4px"] }}
                transition={{ duration: 1.15, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
                className="w-[2px] rounded-full"
                style={{ backgroundColor: theme.accentColor || DEFAULT_THEME.accentColor }}
              />
              <motion.span
                animate={{ height: ["5px", "13px", "7px", "3px", "5px"] }}
                transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: 0.1 }}
                className="w-[2px] rounded-full"
                style={{ backgroundColor: theme.accentColor || DEFAULT_THEME.accentColor }}
              />
            </div>

            {/* Bottom Progress Bar */}
            <div className="absolute inset-x-5 bottom-0.5 h-[2px] rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: "55%",
                  backgroundColor: theme.accentColor || DEFAULT_THEME.accentColor,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 2. Accent & Rhythm Color */}
      <div className="flex flex-col gap-3 rounded-2xl glass-surface p-4 border border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">
              {t("settings.appearance.accentColor")}
            </span>
            {theme.accentColor.toLowerCase() === DEFAULT_THEME.accentColor.toLowerCase() && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-subtle">
                {t("settings.appearance.defaultBadge")}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-subtle">{t("settings.appearance.accentColorDesc")}</p>
        </div>

        {/* Preset Swatches */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {ACCENT_PRESETS.map((preset) => {
            const isSelected = theme.accentColor.toLowerCase() === preset.value.toLowerCase();
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => {
                  setAccentInput(preset.value);
                  void setAccentColor(preset.value);
                }}
                title={`${preset.name} (${preset.value})`}
                className={`relative flex size-8 items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 ${
                  isSelected
                    ? "ring-2 ring-white ring-offset-2 ring-offset-[#111522] scale-105 shadow-md"
                    : "border border-white/20 hover:border-white/50"
                }`}
                style={{ backgroundColor: preset.value }}
              >
                {isSelected && (
                  <svg
                    className="size-3.5 text-black drop-shadow"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        {/* Custom Color Picker & HEX Input */}
        <div className="flex items-center gap-3 pt-2">
          {/* Native Color Picker Trigger */}
          <label
            title={t("settings.appearance.pickColor")}
            className="flex items-center gap-2.5 rounded-xl border border-white/15 bg-surface/70 px-3 py-1.5 cursor-pointer hover:bg-surface hover:border-white/30 transition-all text-xs font-medium text-fg shadow-sm"
          >
            <span
              className="size-5 rounded-md border border-white/25 shadow-inner"
              style={{ backgroundColor: theme.accentColor }}
            />
            <span>{t("settings.appearance.pickColor")}</span>
            <input
              type="color"
              value={theme.accentColor}
              onChange={handleAccentColorPicker}
              className="sr-only"
            />
          </label>

          {/* HEX Text Input */}
          <div className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-surface/50 px-2.5 py-1.5">
            <span className="text-xs font-mono text-muted">#</span>
            <input
              type="text"
              maxLength={7}
              placeholder="22D3EE"
              value={accentInput.replace(/^#/, "")}
              onChange={handleAccentHexChange}
              className="w-20 bg-transparent text-xs font-mono uppercase tracking-wider text-fg focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* 3. Notch Background Color */}
      <div className="flex flex-col gap-3 rounded-2xl glass-surface p-4 border border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">
              {t("settings.appearance.backgroundColor")}
            </span>
            {theme.backgroundColor.toLowerCase() ===
              DEFAULT_THEME.backgroundColor.toLowerCase() && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-subtle">
                {t("settings.appearance.defaultBadge")}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-subtle">{t("settings.appearance.backgroundColorDesc")}</p>
        </div>

        {/* Preset Swatches */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {BG_PRESETS.map((preset) => {
            const isSelected = theme.backgroundColor.toLowerCase() === preset.value.toLowerCase();
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => {
                  setBgInput(preset.value);
                  void setBackgroundColor(preset.value);
                }}
                title={`${preset.name} (${preset.value})`}
                className={`relative flex size-8 items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 ${
                  isSelected
                    ? "ring-2 ring-white ring-offset-2 ring-offset-[#111522] scale-105 shadow-md"
                    : "border border-white/20 hover:border-white/50"
                }`}
                style={{ backgroundColor: preset.value }}
              >
                {isSelected && (
                  <svg
                    className="size-3.5 text-white drop-shadow"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        {/* Custom Color Picker & HEX Input */}
        <div className="flex items-center gap-3 pt-2">
          {/* Native Color Picker Trigger */}
          <label
            title={t("settings.appearance.pickColor")}
            className="flex items-center gap-2.5 rounded-xl border border-white/15 bg-surface/70 px-3 py-1.5 cursor-pointer hover:bg-surface hover:border-white/30 transition-all text-xs font-medium text-fg shadow-sm"
          >
            <span
              className="size-5 rounded-md border border-white/25 shadow-inner"
              style={{ backgroundColor: theme.backgroundColor }}
            />
            <span>{t("settings.appearance.pickColor")}</span>
            <input
              type="color"
              value={theme.backgroundColor}
              onChange={handleBgColorPicker}
              className="sr-only"
            />
          </label>

          {/* HEX Text Input */}
          <div className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-surface/50 px-2.5 py-1.5">
            <span className="text-xs font-mono text-muted">#</span>
            <input
              type="text"
              maxLength={7}
              placeholder="111522"
              value={bgInput.replace(/^#/, "")}
              onChange={handleBgHexChange}
              className="w-20 bg-transparent text-xs font-mono uppercase tracking-wider text-fg focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* 4. Reset to Default Button */}
      {!isDefaultTheme && (
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-surface/40 p-3">
          <span className="text-xs text-subtle">{t("settings.appearance.resetDefaults")}</span>
          <button
            type="button"
            onClick={() => {
              setBgInput(DEFAULT_THEME.backgroundColor);
              setAccentInput(DEFAULT_THEME.accentColor);
              void resetDefaults();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-surface px-3 py-1.5 text-xs font-medium text-fg hover:bg-elevated hover:border-white/25 active:scale-95 transition-all shadow-sm"
          >
            <svg
              className="size-3.5 text-subtle"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>{t("settings.appearance.resetDefaults")}</span>
          </button>
        </div>
      )}

      {/* 5. Opacity Slider */}
      <div className="flex flex-col gap-2 rounded-2xl glass-surface p-4 border border-white/10">
        <label className="flex flex-col gap-2 text-sm">
          <span className="flex items-center justify-between">
            <span className="font-semibold text-fg">{t("settings.appearance.opacity")}</span>
            <span className="font-mono text-xs text-subtle">{opacity}%</span>
          </span>
          <input
            type="range"
            min={MIN_OPACITY}
            max={100}
            value={opacity}
            onChange={(event) => changeOpacity(Number(event.target.value))}
            className="accent-cyan-400 cursor-pointer"
          />
        </label>
        <p className="text-xs text-muted">{t("settings.appearance.opacityHint")}</p>
      </div>

      {/* 6. Video Notch MP4 Player Settings */}
      <NotchVideoSettings />
    </div>
  );
}
