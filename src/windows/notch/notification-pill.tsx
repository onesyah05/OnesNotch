import { motion } from "motion/react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { type AppNotification } from "../../lib/ipc";
import { AppIcon } from "../../components/app-icon";

interface NotificationPillProps {
  notification: AppNotification;
  onDismiss: () => void;
  onOpenApp: (notification: AppNotification) => void;
  autoDismissSeconds?: number;
}

export function NotificationPill({
  notification,
  onDismiss,
  onOpenApp,
  autoDismissSeconds = 5,
}: NotificationPillProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isHovered) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    timerRef.current = setTimeout(() => {
      onDismiss();
    }, autoDismissSeconds * 1000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isHovered, autoDismissSeconds, onDismiss]);

  const handlePillClick = (event: MouseEvent) => {
    event.stopPropagation();
    onOpenApp(notification);
  };

  const handleDismissClick = (event: MouseEvent) => {
    event.stopPropagation();
    onDismiss();
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -6 }}
      transition={{ type: "spring", stiffness: 450, damping: 30 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handlePillClick}
      className="group relative flex h-full w-full items-center justify-between px-5 cursor-pointer select-none"
    >
      <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-3">
        {/* App Icon Badge with subtle accent glow */}
        <AppIcon appName={notification.appName} iconDataUrl={notification.icon} size={38} />

        {/* Content details */}
        <div className="flex flex-col min-w-0 justify-center overflow-hidden">
          <div className="flex items-center gap-1.5 text-[12px] leading-tight">
            <span className="font-semibold text-fg truncate">{notification.appName}</span>
            <span className="text-muted/60">•</span>
            <span className="text-subtle/80 text-[11px]">
              {t("notifications.justNow", "Baru saja")}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5 truncate text-[12.5px] leading-tight mt-1">
            <span className="font-medium text-fg shrink-0">{notification.title}</span>
            <span className="text-subtle/80 truncate text-[11.5px]">{notification.body}</span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 shrink-0 pl-1">
        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-subtle/80 group-hover:text-fg transition-colors bg-white/5 hover:bg-white/10 px-3 py-1 rounded-full ring-1 ring-white/10">
          {t("notifications.open", "Buka")}
          <ExternalArrowIcon />
        </span>

        <button
          type="button"
          onClick={handleDismissClick}
          aria-label={t("notifications.dismiss", "Tutup")}
          className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-fg transition-colors"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Subtle bottom progress bar indicating auto-dismiss */}
      {!isHovered && (
        <motion.div
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: autoDismissSeconds, ease: "linear" }}
          className="absolute bottom-1.5 left-6 right-6 h-[2px] rounded-full bg-cyan-400/50"
        />
      )}
    </motion.div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ExternalArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"
      />
    </svg>
  );
}
