import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Download, RefreshCw } from "lucide-react";
import { ErrorText } from "../../components/error-text";
import { RowButton, SettingsRow, ToggleSwitch } from "../../components/rows";
import { events, ipc, unlistenAll } from "../../lib/ipc";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUpdateStore } from "../../stores/useUpdateStore";

/** Version status, manual check, install and the auto-check switch (Settings → About). */
export function UpdateSection({ currentVersion }: { currentVersion: string | null }) {
  const { t, i18n } = useTranslation();
  const { info, phase, progress, error, checkedAt } = useUpdateStore();
  const settings = useSettingsStore((s) => s.settings);
  const apply = useSettingsStore((s) => s.apply);

  useEffect(() => {
    void useUpdateStore.getState().load();
    const pending = [events.updateAvailable((next) => useUpdateStore.getState().setInfo(next))];
    return () => unlistenAll(pending);
  }, []);

  const busy = phase !== "idle";
  const percent = progress == null ? null : Math.round(progress * 100);
  const published =
    info?.dateMs != null
      ? new Date(info.dateMs).toLocaleDateString(i18n.language, { dateStyle: "medium" })
      : null;

  return (
    <div className="flex flex-col gap-3">
      <SettingsRow
        label={t("update.title")}
        hint={
          info
            ? t("update.availableHint", { version: info.version, current: info.currentVersion })
            : checkedAt
              ? t("update.upToDate", { version: currentVersion ?? "" })
              : t("update.autoHint")
        }
      >
        {info ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void useUpdateStore.getState().install()}
            className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-bg transition-transform hover:brightness-110 active:scale-95 disabled:opacity-60"
          >
            <Download className="size-3.5" />
            {phase === "installing"
              ? t("update.installing")
              : phase === "downloading"
                ? t("update.downloading", { percent: percent ?? "…" })
                : t("update.installVersion", { version: info.version })}
          </button>
        ) : (
          <RowButton onClick={() => void useUpdateStore.getState().check()} disabled={busy}>
            <span className="flex items-center gap-1.5">
              <RefreshCw className={`size-3 ${phase === "checking" ? "animate-spin" : ""}`} />
              {phase === "checking" ? t("update.checking") : t("update.check")}
            </span>
          </RowButton>
        )}
      </SettingsRow>

      {info?.notes && (
        <div className="rounded-xl glass-surface px-4 py-3">
          <p className="mb-1.5 text-xs font-medium text-subtle">
            {t("update.notes", { version: info.version })}
            {published && <span className="text-muted"> · {published}</span>}
          </p>
          <pre className="thin-scrollbar max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-fg">
            {info.notes}
          </pre>
        </div>
      )}

      {error && <ErrorText error={error} />}

      {settings && (
        <SettingsRow label={t("update.auto")} hint={t("update.autoHint")}>
          <ToggleSwitch
            checked={settings.updates.autoCheck}
            onChange={() => void apply(() => ipc.updateSetAutoCheck(!settings.updates.autoCheck))}
            label={t("update.auto")}
          />
        </SettingsRow>
      )}
    </div>
  );
}
