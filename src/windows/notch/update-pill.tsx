import { motion } from "motion/react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { ErrorText } from "../../components/error-text";
import { useUpdateStore } from "../../stores/useUpdateStore";

/** "Update available" pill. Stays until the user updates or picks "Later". */
export function UpdatePill() {
  const { t } = useTranslation();
  const info = useUpdateStore((s) => s.info);
  const phase = useUpdateStore((s) => s.phase);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  if (!info) return null;

  const busy = phase === "downloading" || phase === "installing";
  const percent = progress == null ? null : Math.round(progress * 100);

  const update = (event: MouseEvent) => {
    event.stopPropagation();
    void useUpdateStore.getState().install();
  };

  const later = (event: MouseEvent) => {
    event.stopPropagation();
    useUpdateStore.getState().dismiss();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      onClick={(event) => event.stopPropagation()}
      className="relative flex h-full w-full items-center gap-3 px-5 select-none"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent ring-1 ring-accent/30">
        <Download className={`size-5 ${busy ? "animate-pulse" : ""}`} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="truncate text-[13px] font-semibold leading-tight text-fg">
          {phase === "installing"
            ? t("update.installing")
            : phase === "downloading"
              ? t("update.downloading", { percent: percent ?? "…" })
              : t("update.available", { version: info.version })}
        </span>
        {busy ? (
          <span className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-elevated">
            <span
              className={`block h-full rounded-full bg-accent transition-[width] duration-300 ${percent == null ? "w-1/3 animate-pulse" : ""}`}
              style={percent == null ? undefined : { width: `${percent}%` }}
            />
          </span>
        ) : error ? (
          <ErrorText error={error} className="mt-0.5 truncate" />
        ) : (
          <span className="mt-0.5 truncate text-[11.5px] leading-tight text-subtle">
            {t("update.current", { version: info.currentVersion })}
          </span>
        )}
      </div>

      {!busy && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={later}
            className="rounded-full px-3 py-1.5 text-[11px] font-medium text-subtle transition-colors hover:bg-elevated hover:text-fg"
          >
            {t("update.later")}
          </button>
          <button
            type="button"
            onClick={update}
            className="rounded-full bg-accent px-3.5 py-1.5 text-[11px] font-semibold text-bg transition-transform hover:brightness-110 active:scale-95"
          >
            {t("update.install")}
          </button>
        </div>
      )}
    </motion.div>
  );
}
