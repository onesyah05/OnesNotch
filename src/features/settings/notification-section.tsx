import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Plus } from "lucide-react";
import { SectionTitle, SettingsRow, ToggleSwitch } from "../../components/rows";
import { useNotificationStore } from "../../stores/useNotificationStore";

const PRESET_APPS = [
  "WhatsApp",
  "Telegram",
  "Discord",
  "Slack",
  "Teams",
  "Spotify",
  "Chrome",
  "Outlook",
];

export function NotificationSection() {
  const { t } = useTranslation();
  const { settings, updateSettings, simulateNotification } = useNotificationStore();
  const [customApp, setCustomApp] = useState("");

  const handleToggleApp = (appName: string) => {
    const exists = settings.allowedApps.some((a) => a.toLowerCase() === appName.toLowerCase());
    const next = exists
      ? settings.allowedApps.filter((a) => a.toLowerCase() !== appName.toLowerCase())
      : [...settings.allowedApps, appName];
    void updateSettings({ allowedApps: next });
  };

  const handleAddApp = () => {
    const trimmed = customApp.trim();
    if (!trimmed) return;
    if (!settings.allowedApps.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
      void updateSettings({
        allowedApps: [...settings.allowedApps, trimmed],
      });
    }
    setCustomApp("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddApp();
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionTitle title={t("settings.notifications.title", "Smart Notifications")} />
        <p className="mt-1 max-w-prose text-sm text-subtle">
          {t(
            "settings.notifications.desc",
            "Menampilkan notifikasi Windows sebagai pill Dynamic Island di atas layar dengan preview pesan, pembuka aplikasi otomatis, dan filter Jangan Ganggu.",
          )}
        </p>
      </div>

      {/* Enable notifications */}
      <SettingsRow
        label={t("settings.notifications.enable", "Aktifkan Notifikasi")}
        hint={t(
          "settings.notifications.enableDesc",
          "Tampilkan pop-up pill saat ada notifikasi masuk",
        )}
      >
        <ToggleSwitch
          checked={settings.enabled}
          onChange={() => void updateSettings({ enabled: !settings.enabled })}
          label={t("settings.notifications.enable", "Aktifkan Notifikasi")}
        />
      </SettingsRow>

      {/* Do Not Disturb */}
      <SettingsRow
        label={t("settings.notifications.dnd", "Mode Jangan Ganggu (DND)")}
        hint={t(
          "settings.notifications.dndDesc",
          "Hanya aplikasi di daftar putih yang diizinkan memunculkan pill pop-up",
        )}
      >
        <ToggleSwitch
          checked={settings.dndEnabled}
          onChange={() => void updateSettings({ dndEnabled: !settings.dndEnabled })}
          label={t("settings.notifications.dnd", "Mode Jangan Ganggu")}
        />
      </SettingsRow>

      {/* Auto-dismiss duration slider */}
      <div className="flex flex-col gap-2 rounded-2xl bg-surface/40 p-4 ring-1 ring-fg/5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-fg">
            {t("settings.notifications.duration", "Durasi Pop-up Pill")}
          </span>
          <span className="font-mono text-xs text-subtle">
            {settings.autoDismissSeconds} {t("common.seconds", "detik")}
          </span>
        </div>
        <input
          type="range"
          min={3}
          max={15}
          value={settings.autoDismissSeconds}
          onChange={(e) => void updateSettings({ autoDismissSeconds: Number(e.target.value) })}
          className="accent-accent"
        />
        <p className="text-xs text-muted">
          {t(
            "settings.notifications.durationHint",
            "Pill akan hilang otomatis jika kursor tidak diarahkan ke pill.",
          )}
        </p>
      </div>

      {/* Allowed Apps Whitelist */}
      <div className="flex flex-col gap-3 rounded-2xl bg-surface/40 p-4 ring-1 ring-fg/5">
        <div>
          <span className="text-sm font-medium text-fg">
            {t("settings.notifications.allowedApps", "Aplikasi Yang Diizinkan (Whitelist DND)")}
          </span>
          <p className="text-xs text-muted mt-0.5">
            {t(
              "settings.notifications.allowedAppsDesc",
              "Aplikasi ini tetap diizinkan memunculkan pill di layar bahkan saat DND aktif.",
            )}
          </p>
        </div>

        {/* Preset chips */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {PRESET_APPS.map((app) => {
            const active = settings.allowedApps.some((a) => a.toLowerCase() === app.toLowerCase());
            return (
              <button
                key={app}
                type="button"
                onClick={() => handleToggleApp(app)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all flex items-center gap-1.5 ${
                  active
                    ? "bg-accent/20 text-accent ring-1 ring-accent/40 shadow-sm"
                    : "bg-surface/60 text-muted hover:text-subtle ring-1 ring-fg/5"
                }`}
              >
                <span>{app}</span>
                <span className="opacity-80">
                  {active ? <Check className="size-3" /> : <Plus className="size-3" />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Custom app input */}
        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={customApp}
            onChange={(e) => setCustomApp(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t(
              "settings.notifications.customAppPlaceholder",
              "Nama aplikasi lainnya...",
            )}
            className="flex-1 rounded-xl bg-bg/80 px-3 py-1.5 text-xs text-fg placeholder:text-muted/60 ring-1 ring-fg/10 focus:outline-none focus:ring-accent/50"
          />
          <button
            type="button"
            onClick={handleAddApp}
            className="rounded-xl bg-accent/30 hover:bg-accent/50 text-accent px-3 py-1.5 text-xs font-medium ring-1 ring-accent/30 transition-all"
          >
            {t("common.add", "Tambah")}
          </button>
        </div>
      </div>

      {/* Test simulation button */}
      <div className="flex items-center justify-between rounded-2xl bg-surface/40 p-4 ring-1 ring-fg/5">
        <div>
          <span className="text-sm font-medium text-fg">
            {t("settings.notifications.testTitle", "Uji Coba Notifikasi")}
          </span>
          <p className="text-xs text-muted mt-0.5">
            {t(
              "settings.notifications.testDesc",
              "Kirim notifikasi simulasi untuk menguji tampilan pill di layar atas.",
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void simulateNotification(
              "WhatsApp",
              "Sarah Wijaya",
              "Halo, bagaimana progres fiturnya?",
            );
          }}
          className="rounded-xl bg-accent/20 hover:bg-accent/30 text-accent px-4 py-2 text-xs font-medium ring-1 ring-accent/40 transition-all shadow-sm"
        >
          {t("settings.notifications.sendTest", "Kirim Notifikasi")}
        </button>
      </div>
    </div>
  );
}
