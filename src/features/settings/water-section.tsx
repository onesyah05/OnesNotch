import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlassWater } from "lucide-react";
import { ErrorText } from "../../components/error-text";
import {
  NumberField,
  RowButton,
  SectionTitle,
  SettingsRow,
  ToggleSwitch,
} from "../../components/rows";
import { ipc, type AppError, type WaterSettings } from "../../lib/ipc";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useWaterStore } from "../../stores/useWaterStore";
import {
  dailyTargetMl,
  parseStartMinutes,
  reminderIntervalMs,
  remindersPerDay,
  targetRangeMl,
  WINDOW_HOURS,
} from "../water/schedule";

const GLASS_PRESETS = [150, 200, 250, 300, 350, 500];

function formatLiters(ml: number, locale: string): string {
  return (ml / 1000).toLocaleString(locale, { maximumFractionDigits: 1 });
}

function endTime(startTime: string): string {
  const start = parseStartMinutes(startTime) ?? 7 * 60;
  const end = (start + WINDOW_HOURS * 60) % (24 * 60);
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

export function WaterSection() {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const apply = useSettingsStore((s) => s.apply);
  const progress = useWaterStore((s) => s.progress);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    useWaterStore.getState().load();
  }, []);

  if (!settings) return null;
  const water = settings.water;
  const update = async (patch: Partial<WaterSettings>) => {
    setError(await apply(() => ipc.waterUpdate({ ...water, ...patch })));
  };

  const target = dailyTargetMl(water.weightKg);
  const [low, high] = targetRangeMl(water.weightKg);
  const count = remindersPerDay(target, water.glassMl);
  const intervalMin = Math.round(reminderIntervalMs(target, water.glassMl) / 60000);
  const percent = Math.min(100, Math.round((progress.consumedMl / target) * 100)) || 0;
  const locale = i18n.language;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionTitle title={t("settings.water.title")} />
        <p className="mt-1 max-w-prose text-sm text-subtle">{t("settings.water.description")}</p>
      </div>

      <SettingsRow label={t("settings.water.enable")} hint={t("settings.water.enableHint")}>
        <ToggleSwitch
          checked={water.enabled}
          onChange={() => void update({ enabled: !water.enabled })}
          label={t("settings.water.enable")}
        />
      </SettingsRow>

      {/* Daily goal summary */}
      <div className="flex items-center gap-4 rounded-xl glass-surface px-4 py-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent ring-1 ring-accent/30">
          <GlassWater className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-subtle">{t("settings.water.goal")}</p>
          <p className="text-lg font-semibold text-fg">
            {formatLiters(low, locale)} – {formatLiters(high, locale)} L
          </p>
          <p className="text-xs text-muted">
            {t("settings.water.formula", { weight: water.weightKg, target })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-subtle">{t("settings.water.today")}</p>
          <p className="font-mono text-sm text-fg">
            {progress.consumedMl} / {target} ml
          </p>
          <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-elevated">
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>

      <SettingsRow label={t("settings.water.weight")} hint={t("settings.water.weightHint")}>
        <NumberField
          label={t("settings.water.weight")}
          value={water.weightKg}
          min={20}
          max={250}
          suffix="kg"
          onCommit={(weightKg) => void update({ weightKg })}
        />
      </SettingsRow>

      <SettingsRow
        label={t("settings.water.startTime")}
        hint={t("settings.water.window", {
          start: water.startTime,
          end: endTime(water.startTime),
          hours: WINDOW_HOURS,
        })}
      >
        <input
          type="time"
          aria-label={t("settings.water.startTime")}
          value={water.startTime}
          onChange={(event) => {
            if (parseStartMinutes(event.target.value) != null) {
              void update({ startTime: event.target.value });
            }
          }}
          className="rounded-lg bg-surface px-2 py-1 font-mono text-xs text-fg ring-1 ring-elevated [color-scheme:dark] focus:outline-none focus:ring-accent"
        />
      </SettingsRow>

      <SettingsRow
        label={t("settings.water.glass")}
        hint={t("settings.water.schedule", { count, minutes: intervalMin })}
      >
        <select
          aria-label={t("settings.water.glass")}
          value={water.glassMl}
          onChange={(event) => void update({ glassMl: Number(event.target.value) })}
          className="rounded-lg bg-surface px-2 py-1 text-xs text-fg ring-1 ring-elevated focus:outline-none focus:ring-accent"
        >
          {[...new Set([...GLASS_PRESETS, water.glassMl])]
            .sort((a, b) => a - b)
            .map((ml) => (
              <option key={ml} value={ml}>
                {ml} ml
              </option>
            ))}
        </select>
      </SettingsRow>

      <SettingsRow label={t("settings.water.reset")} hint={t("settings.water.resetHint")}>
        <RowButton
          onClick={() => useWaterStore.getState().resetToday()}
          disabled={progress.consumedMl === 0}
        >
          {t("settings.water.resetButton")}
        </RowButton>
      </SettingsRow>

      {error && <ErrorText error={error} />}
    </div>
  );
}
