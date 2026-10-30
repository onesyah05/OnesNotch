import { motion } from "motion/react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { GlassWater } from "lucide-react";
import type { WaterSettings } from "../../lib/ipc";
import { dailyTargetMl } from "../../features/water/schedule";
import { useWaterStore } from "../../stores/useWaterStore";

interface WaterPillProps {
  settings: WaterSettings;
  onDone: () => void;
}

/** Drink reminder. It stays up until "Drink" (or "Later") is clicked. */
export function WaterPill({ settings, onDone }: WaterPillProps) {
  const { t } = useTranslation();
  const consumed = useWaterStore((s) => s.progress.consumedMl);
  const target = dailyTargetMl(settings.weightKg);
  const percent = target > 0 ? Math.min(100, (consumed / target) * 100) : 0;

  const drink = (event: MouseEvent) => {
    event.stopPropagation();
    useWaterStore.getState().drink(settings);
    onDone();
  };

  const later = (event: MouseEvent) => {
    event.stopPropagation();
    useWaterStore.getState().snooze();
    onDone();
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
        <GlassWater className="size-5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="truncate text-[13px] font-semibold leading-tight text-fg">
          {t("water.reminderTitle")}
        </span>
        <span className="mt-0.5 truncate text-[11.5px] leading-tight text-subtle">
          {t("water.reminderBody", { glass: settings.glassMl, consumed, target })}
        </span>
        <span className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-elevated">
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={later}
          className="rounded-full px-3 py-1.5 text-[11px] font-medium text-subtle transition-colors hover:bg-elevated hover:text-fg"
        >
          {t("water.later")}
        </button>
        <button
          type="button"
          onClick={drink}
          className="rounded-full bg-accent px-3.5 py-1.5 text-[11px] font-semibold text-bg transition-transform hover:brightness-110 active:scale-95"
        >
          {t("water.drink")}
        </button>
      </div>
    </motion.div>
  );
}
