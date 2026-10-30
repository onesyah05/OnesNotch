import { AnimatePresence, motion } from "motion/react";
import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { type AppNotification } from "../../lib/ipc";
import { useNotificationStore } from "../../stores/useNotificationStore";
import { AppIcon } from "../../components/app-icon";
import { Check, Plus } from "lucide-react";

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

export function NotificationPanel() {
  const { t } = useTranslation();
  const {
    notifications,
    settings,
    dismissNotification,
    clearAll,
    openApp,
    toggleDnd,
    updateSettings,
    simulateNotification,
  } = useNotificationStore();

  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [customAppInput, setCustomAppInput] = useState("");

  const handleAddCustomApp = () => {
    const trimmed = customAppInput.trim();
    if (!trimmed) return;
    if (!settings.allowedApps.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
      void updateSettings({
        allowedApps: [...settings.allowedApps, trimmed],
      });
    }
    setCustomAppInput("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddCustomApp();
    }
  };

  const toggleAllowedApp = (appName: string) => {
    const exists = settings.allowedApps.some((a) => a.toLowerCase() === appName.toLowerCase());
    const next = exists
      ? settings.allowedApps.filter((a) => a.toLowerCase() !== appName.toLowerCase())
      : [...settings.allowedApps, appName];
    void updateSettings({ allowedApps: next });
  };

  return (
    <div className="flex h-full flex-col select-none">
      {/* Header with DND toggle, Filter, and Clear */}
      <div className="flex items-center justify-between pb-3 border-b border-fg/[0.08]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">
            {t("notifications.title", "Notifikasi")}
          </span>
          {notifications.length > 0 && (
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-subtle ring-1 ring-fg/10">
              {notifications.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* DND Toggle Button */}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void toggleDnd();
            }}
            title={
              settings.dndEnabled
                ? t(
                    "notifications.dndOnHint",
                    "Jangan Ganggu Aktif (Hanya aplikasi diizinkan yang muncul)",
                  )
                : t("notifications.dndOffHint", "Jangan Ganggu Nonaktif")
            }
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
              settings.dndEnabled
                ? "bg-accent/20 text-accent ring-1 ring-accent/40 shadow-sm"
                : "bg-surface/60 text-subtle hover:bg-surface hover:text-fg ring-1 ring-fg/5"
            }`}
          >
            <MoonIcon />
            <span>
              {settings.dndEnabled
                ? t("notifications.dndActive", "DND Aktif")
                : t("notifications.dnd", "DND")}
            </span>
          </button>

          {/* Allowed Apps Filter Button */}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setFilterModalOpen(!filterModalOpen);
            }}
            title={t("notifications.filterApps", "Kelola Aplikasi Diizinkan")}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
              filterModalOpen
                ? "bg-accent/20 text-accent ring-1 ring-accent/40"
                : "bg-surface/60 text-subtle hover:bg-surface hover:text-fg ring-1 ring-fg/5"
            }`}
          >
            <ShieldCheckIcon />
            <span>{t("notifications.allowed", "Diizinkan")}</span>
          </button>

          {/* Clear All Button */}
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void clearAll();
              }}
              className="flex items-center justify-center rounded-full p-1.5 text-muted hover:bg-fg/10 hover:text-live transition-colors"
              title={t("notifications.clearAll", "Hapus Semua")}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>

      {/* Allowed Apps Configuration Drawer */}
      <AnimatePresence>
        {filterModalOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-b border-fg/[0.08] bg-surface/40 backdrop-blur-md px-3 py-3 rounded-xl mt-2"
          >
            <div className="flex items-center justify-between pb-2">
              <span className="text-xs font-medium text-fg">
                {t("notifications.allowedWhitelist", "Aplikasi Lolos Filter DND")}
              </span>
              <span className="text-[10px] text-muted">
                {t("notifications.whitelistHint", "Pill tetap tampil saat DND aktif")}
              </span>
            </div>

            {/* Preset Tags */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PRESET_APPS.map((app) => {
                const active = settings.allowedApps.some(
                  (a) => a.toLowerCase() === app.toLowerCase(),
                );
                return (
                  <button
                    key={app}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleAllowedApp(app);
                    }}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all flex items-center gap-1 ${
                      active
                        ? "bg-accent/20 text-accent ring-1 ring-accent/40"
                        : "bg-surface/80 text-muted hover:text-subtle ring-1 ring-fg/5"
                    }`}
                  >
                    <span>{app}</span>
                    <span className="opacity-80">
                      {active ? <Check className="size-2.5" /> : <Plus className="size-2.5" />}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Custom App Input */}
            <div className="mt-2.5 flex items-center gap-2">
              <input
                type="text"
                value={customAppInput}
                onChange={(e) => setCustomAppInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                placeholder={t(
                  "notifications.addAppPlaceholder",
                  "Tambah nama aplikasi lain (Enter)...",
                )}
                className="flex-1 rounded-lg bg-bg/80 px-2.5 py-1 text-xs text-fg placeholder:text-muted/60 ring-1 ring-fg/10 focus:outline-none focus:ring-accent/50"
              />
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleAddCustomApp();
                }}
                className="rounded-lg bg-accent/30 hover:bg-accent/50 text-accent px-2.5 py-1 text-xs font-medium ring-1 ring-accent/30 transition-all"
              >
                {t("common.add", "Tambah")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notifications List */}
      <div className="flex-1 overflow-y-auto pt-2 space-y-2 pr-1 custom-scrollbar">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4">
            <div className="size-11 rounded-full bg-surface/60 flex items-center justify-center text-muted ring-1 ring-fg/5 mb-2">
              <BellOffIcon />
            </div>
            <p className="text-xs font-medium text-fg/80">
              {t("notifications.empty", "Belum ada notifikasi baru")}
            </p>
            <p className="text-[11px] text-muted max-w-xs mt-1">
              {t(
                "notifications.emptyDesc",
                "Notifikasi Windows yang masuk akan muncul sebagai pill di atas layar dan tersimpan di sini.",
              )}
            </p>

            {/* Test Simulation Button */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void simulateNotification(
                  "WhatsApp",
                  "Budi Santoso",
                  "Halo! Dokumen proposal sudah siap dikirim ya.",
                );
              }}
              className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-accent/15 hover:bg-accent/25 text-accent px-3 py-1 text-xs font-medium ring-1 ring-accent/30 transition-all"
            >
              <SparklesIcon />
              <span>{t("notifications.testSimulate", "Kirim Notifikasi Uji Coba")}</span>
            </button>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {notifications.map((notif) => (
              <NotificationCard
                key={notif.id}
                notification={notif}
                onOpenApp={() => void openApp(notif)}
                onDismiss={() => void dismissNotification(notif.id)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Footer simulation shortcuts if notifications exist */}
      {notifications.length > 0 && (
        <div className="mt-2 pt-2 border-t border-fg/[0.06] flex items-center justify-between text-[11px] text-muted">
          <span>{t("notifications.clickToOpenHint", "Klik kartu untuk membuka aplikasi")}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void simulateNotification(
                "Discord",
                "#general",
                "Server update scheduled for 22:00 UTC.",
              );
            }}
            className="text-accent hover:text-accent transition-colors"
          >
            + {t("notifications.testAnother", "Uji Coba Lain")}
          </button>
        </div>
      )}
    </div>
  );
}

interface NotificationCardProps {
  notification: AppNotification;
  onOpenApp: () => void;
  onDismiss: () => void;
}

function NotificationCard({ notification, onOpenApp, onDismiss }: NotificationCardProps) {
  const { t } = useTranslation();
  const timeFormatted = formatRelativeTime(notification.timestamp);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.2 }}
      onClick={(e) => {
        e.stopPropagation();
        onOpenApp();
      }}
      className="group relative flex items-start gap-3 rounded-2xl bg-surface/50 hover:bg-surface/80 p-3 ring-1 ring-fg/5 hover:ring-fg/10 transition-all cursor-pointer"
    >
      {/* App badge icon */}
      <AppIcon
        appName={notification.appName}
        iconDataUrl={notification.icon}
        size={28}
        className="mt-0.5"
      />

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-fg/90 truncate">
            {notification.appName}
          </span>
          <span className="text-[10px] text-muted shrink-0">{timeFormatted}</span>
        </div>

        <div className="text-xs font-medium text-fg mt-0.5 truncate">{notification.title}</div>

        <p className="text-[11px] text-subtle/80 line-clamp-2 mt-0.5 leading-snug">
          {notification.body}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenApp();
          }}
          title={t("notifications.openApp", "Buka Aplikasi")}
          className="rounded-full p-1.5 text-subtle hover:bg-fg/10 hover:text-fg transition-colors"
        >
          <ExternalLinkIcon />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          title={t("notifications.dismiss", "Hapus")}
          className="rounded-full p-1.5 text-muted hover:bg-fg/10 hover:text-live transition-colors"
        >
          <CloseIconSmall />
        </button>
      </div>
    </motion.div>
  );
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "Baru saja";
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 45) return "Baru saja";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} mnt`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} jam`;
  return `${Math.floor(diffSec / 86400)} hari`;
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="size-3.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
      />
    </svg>
  );
}

function BellOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3l18 18M13.73 21a2 2 0 01-3.46 0m-.44-3.08A5.98 5.98 0 016 13.5V9a6 6 0 012.34-4.8m8.74 8.74c.58 1.05 1.57 2.08 2.92 2.56H6.36M18 9a6 6 0 00-4.48-5.8"
      />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
      />
    </svg>
  );
}

function CloseIconSmall() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
