import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorText } from "../../components/error-text";
import { RowButton, SectionTitle, SettingsRow } from "../../components/rows";
import { acceleratorFromEvent, formatAccelerator } from "../../lib/accelerator";
import { HOTKEY_ACTIONS, ipc, type AppError, type HotkeyAction } from "../../lib/ipc";
import { useNotchStore } from "../../stores/useNotchStore";
import { useSettingsStore } from "../../stores/useSettingsStore";

/**
 * The six global hotkeys with re-record rebinding. While the settings window
 * records a combo the global shortcuts are suspended (backend `hotkeys_suspend`),
 * so pressing an existing combo does not fire its action.
 */
export function HotkeySection() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const panic = useNotchStore((s) => s.panic);
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  // While an action is being re-recorded: capture keys and apply the winner.
  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Stop the browser (and text fields) from acting on the combo.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      // Modifiers-only presses keep recording until a real key arrives.
      if (!accelerator) return;
      setRecording(null);
      void useSettingsStore
        .getState()
        .apply(() => ipc.hotkeySet(recording, accelerator))
        .then(setError);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      // Recording ended (Esc, success, or click elsewhere): restore shortcuts.
      void ipc.hotkeysSuspend(false).catch(() => {});
    };
  }, [recording]);

  if (!settings) {
    return <p className="text-sm text-subtle">{t("settings.ai.loading")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title={t("settings.hotkeys.title")} />

      {HOTKEY_ACTIONS.map((action) => {
        const rowRecording = recording === action;
        return (
          <SettingsRow
            key={action}
            label={t(`settings.hotkeys.actions.${action}`)}
            hint={rowRecording ? t("settings.hotkeys.recording") : undefined}
          >
            {rowRecording ? (
              <kbd className="animate-pulse font-mono text-xs text-live">
                {t("settings.hotkeys.press")}
              </kbd>
            ) : (
              <kbd className="font-mono text-xs text-subtle">
                {formatAccelerator(settings.hotkeys[action])}
              </kbd>
            )}
            <RowButton
              disabled={recording !== null}
              onClick={() => {
                setError(null);
                setRecording(action);
                void ipc.hotkeysSuspend(true).catch(() => {});
              }}
            >
              {t("settings.hotkeys.change")}
            </RowButton>
          </SettingsRow>
        );
      })}

      <p className="text-xs text-muted">{t("settings.hotkeys.hint")}</p>

      <RowButton
        onClick={() => {
          void ipc
            .togglePanic()
            .then((active) => useNotchStore.getState().setPanic(active))
            .catch(() => {});
        }}
      >
        {t("settings.panic.button")}
      </RowButton>
      <p className="text-xs text-muted">{t("settings.panic.hint")}</p>
      {panic && <p className="text-xs text-live">{t("settings.panic.active")}</p>}

      {error && <ErrorText error={error} className="mt-4" />}
    </div>
  );
}
