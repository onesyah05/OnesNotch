import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionTitle, SettingsRow, ToggleSwitch } from "../../components/rows";
import { events, ipc, unlistenAll, type AppInfo } from "../../lib/ipc";
import { useNotchStore } from "../../stores/useNotchStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useThemeStore } from "../../stores/useThemeStore";
import { AppearanceSection } from "../../features/settings/appearance-section";
import { HotkeySection } from "../../features/settings/hotkey-section";
import { ProviderSection } from "../../features/settings/provider-section";
import { X } from "lucide-react";
import { AuroraGradient } from "../../components/aurora-gradient";
import { NotificationSection } from "../../features/settings/notification-section";
import { GeneralSection } from "../../features/settings/general-section";
import { WaterSection } from "../../features/settings/water-section";
import { UpdateSection } from "../../features/settings/update-section";

const SECTIONS = [
  "general",
  "stealth",
  "ai",
  "notifications",
  "water",
  "appearance",
  "hotkeys",
  "about",
] as const;
type Section = (typeof SECTIONS)[number];

const MIN_SUPPORTED_BUILD = 19_041;

export function SettingsWindow() {
  const { t } = useTranslation();
  const visibleInCapture = useNotchStore((state) => state.visibleInCapture);
  const [section, setSection] = useState<Section>("general");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void useNotchStore.getState().hydrate();
    void useSettingsStore.getState().load();
    void useThemeStore.getState().load();
    void ipc
      .appInfo()
      .then(setAppInfo)
      .catch(() => {});

    const pending = [
      events.stealthChanged(({ visible }) => useNotchStore.getState().setVisibleInCapture(visible)),
      events.opacityChanged(({ opacity: value }) => useNotchStore.getState().setOpacity(value)),
      events.themeChanged((theme) => useThemeStore.getState().setTheme(theme)),
      events.panicChanged(({ active }) => useNotchStore.getState().setPanic(active)),
      events.settingsChanged(() => void useSettingsStore.getState().load()),
    ];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void ipc.hideSettings().catch(() => {});
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unlistenAll(pending);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const toggleCapture = () => {
    const next = !useNotchStore.getState().visibleInCapture;
    useNotchStore.getState().setVisibleInCapture(next);
    void ipc.setVisibleInCapture(next).catch(() => {
      useNotchStore.getState().setVisibleInCapture(!next);
    });
  };

  const oldBuild = appInfo?.osBuild != null && appInfo.osBuild < MIN_SUPPORTED_BUILD;

  return (
    <main className="relative flex h-full flex-col bg-bg text-fg overflow-hidden select-none">
      {/* Fluid atmospheric aurora gradient backdrop */}
      <AuroraGradient variant="settings" />

      <header className="relative z-10 flex h-12 shrink-0 items-center justify-between px-6 text-sm font-semibold border-b border-fg/[0.08] bg-surface/35 backdrop-blur-md">
        <span>{t("settings.title")}</span>
        <button
          type="button"
          onClick={() => {
            void ipc.hideSettings().catch(() => {});
          }}
          className="flex items-center justify-center size-7 rounded-lg text-muted hover:bg-fg/[0.08] hover:text-fg transition-colors"
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1">
        <nav className="flex w-44 shrink-0 flex-col gap-1.5 border-r border-fg/[0.08] bg-surface/25 backdrop-blur-md p-3">
          {SECTIONS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={`rounded-xl px-3 py-2 text-left text-sm transition-all ${
                section === key
                  ? "glass-elevated text-fg shadow-sm font-medium"
                  : "text-subtle hover:bg-surface/40 hover:text-fg"
              }`}
            >
              {t(`settings.nav.${key}`)}
            </button>
          ))}
        </nav>

        <section className="flex-1 overflow-y-auto p-6">
          {section === "general" && <GeneralSection />}

          {section === "stealth" && (
            <div className="flex flex-col gap-4">
              <SectionTitle title={t("settings.stealth.title")} />
              <p className="max-w-prose text-sm text-subtle">{t("settings.stealth.description")}</p>
              <SettingsRow
                label={t(visibleInCapture ? "settings.stealth.visible" : "settings.stealth.hidden")}
              >
                <ToggleSwitch
                  checked={visibleInCapture}
                  onChange={toggleCapture}
                  label={t("notch.toggleCapture")}
                />
              </SettingsRow>
              <p className="text-xs text-muted">{t("settings.stealth.alwaysOff")}</p>
            </div>
          )}

          {section === "ai" && <ProviderSection />}

          {section === "notifications" && <NotificationSection />}

          {section === "water" && <WaterSection />}

          {section === "appearance" && <AppearanceSection />}

          {section === "hotkeys" && <HotkeySection />}

          {section === "about" && (
            <div className="flex flex-col gap-4">
              <SectionTitle title={t("settings.about.title")} />
              <SettingsRow label={appInfo?.name ?? "OnesNotch"}>
                <kbd className="font-mono text-xs text-subtle">
                  {t("settings.about.version")} {appInfo?.version ?? "…"}
                </kbd>
              </SettingsRow>
              <p className="text-sm text-subtle">{t("settings.about.tagline")}</p>
              <UpdateSection currentVersion={appInfo?.version ?? null} />
              {oldBuild && (
                <p className="rounded-lg bg-surface p-3 text-xs text-live">
                  {t("settings.stealth.oldBuild")}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
