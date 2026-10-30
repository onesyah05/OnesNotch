import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorText } from "../../components/error-text";
import { NumberField, SectionTitle, SettingsRow, ToggleSwitch } from "../../components/rows";
import { ipc, type AppError, type AutoHideSettings } from "../../lib/ipc";
import { useSettingsStore } from "../../stores/useSettingsStore";

const SHOW_PRESETS = [3, 5, 8, 10, 15, 30];

/** Startup and visibility behaviour: launch with Windows, auto-hide. */
export function GeneralSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const apply = useSettingsStore((s) => s.apply);
  const [error, setError] = useState<AppError | null>(null);

  if (!settings) return null;
  const autoHide = settings.autoHide;

  const run = async (request: () => ReturnType<typeof ipc.settingsGet>) => {
    setError(await apply(request));
  };

  const updateAutoHide = (patch: Partial<AutoHideSettings>) =>
    void run(() => ipc.autoHideUpdate({ ...autoHide, ...patch }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionTitle title={t("settings.general.title")} />
        <p className="mt-1 max-w-prose text-sm text-subtle">{t("settings.general.description")}</p>
      </div>

      <SettingsRow
        label={t("settings.general.autostart")}
        hint={t("settings.general.autostartHint")}
      >
        <ToggleSwitch
          checked={settings.autostart}
          onChange={() => void run(() => ipc.autostartSet(!settings.autostart))}
          label={t("settings.general.autostart")}
        />
      </SettingsRow>

      <SettingsRow label={t("settings.general.autoHide")} hint={t("settings.general.autoHideHint")}>
        <ToggleSwitch
          checked={autoHide.enabled}
          onChange={() => updateAutoHide({ enabled: !autoHide.enabled })}
          label={t("settings.general.autoHide")}
        />
      </SettingsRow>

      <div
        className={`flex flex-col gap-3 transition-opacity ${autoHide.enabled ? "" : "pointer-events-none opacity-40"}`}
        aria-disabled={!autoHide.enabled}
      >
        <SettingsRow
          label={t("settings.general.interval")}
          hint={t("settings.general.intervalHint")}
        >
          <NumberField
            label={t("settings.general.interval")}
            value={Math.round((autoHide.intervalSeconds / 60) * 10) / 10}
            min={0.5}
            max={60}
            step={0.5}
            suffix={t("common.minutes")}
            onCommit={(minutes) => updateAutoHide({ intervalSeconds: Math.round(minutes * 60) })}
          />
        </SettingsRow>

        <SettingsRow label={t("settings.general.showFor")} hint={t("settings.general.showForHint")}>
          <select
            aria-label={t("settings.general.showFor")}
            value={autoHide.showSeconds}
            onChange={(event) => updateAutoHide({ showSeconds: Number(event.target.value) })}
            className="rounded-lg bg-surface px-2 py-1 text-xs text-fg ring-1 ring-elevated focus:outline-none focus:ring-accent"
          >
            {[...new Set([...SHOW_PRESETS, autoHide.showSeconds])]
              .sort((a, b) => a - b)
              .map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} {t("common.seconds")}
                </option>
              ))}
          </select>
        </SettingsRow>
      </div>

      {error && <ErrorText error={error} />}
    </div>
  );
}
