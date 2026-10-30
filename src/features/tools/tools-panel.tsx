import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Flame,
  GlassWater,
  GripVertical,
  Network,
  QrCode,
  RotateCcw,
  SquareTerminal,
  Timer,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ClipboardTool } from "./clipboard-tool";
import { TimerTool } from "./timer-tool";
import { StopwatchTool } from "./stopwatch-tool";
import { PomodoroTool } from "./pomodoro-tool";
import { PortsTool } from "./ports-tool";
import { RunnerTool } from "./runner-tool";
import { ScannerTool } from "./scanner-tool";
import { WaterTool } from "./water-tool";
import { useTimerStore } from "../../stores/useTimerStore";
import { useStopwatchStore } from "../../stores/useStopwatchStore";
import { usePomodoroStore } from "../../stores/usePomodoroStore";
import { useClipboardStore } from "../../stores/useClipboardStore";
import { usePortStore } from "../../stores/usePortStore";
import { useRunnerStore } from "../../stores/useRunnerStore";
import { useWaterStore } from "../../stores/useWaterStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { dailyTargetMl } from "../water/schedule";

export type ToolType =
  "clipboard" | "timer" | "stopwatch" | "pomodoro" | "ports" | "runner" | "scanner" | "water";

const DEFAULT_TOOL_ORDER: ToolType[] = [
  "clipboard",
  "timer",
  "stopwatch",
  "pomodoro",
  "ports",
  "runner",
  "scanner",
  "water",
];

const STORAGE_ORDER_KEY = "notch_tools_order";

function getInitialOrder(): ToolType[] {
  if (typeof window === "undefined" || !window.localStorage) return DEFAULT_TOOL_ORDER;
  try {
    const raw = localStorage.getItem(STORAGE_ORDER_KEY);
    if (!raw) return DEFAULT_TOOL_ORDER;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((id) =>
        DEFAULT_TOOL_ORDER.includes(id as ToolType),
      ) as ToolType[];
      for (const defId of DEFAULT_TOOL_ORDER) {
        if (!valid.includes(defId)) {
          valid.push(defId);
        }
      }
      return valid;
    }
    return DEFAULT_TOOL_ORDER;
  } catch {
    return DEFAULT_TOOL_ORDER;
  }
}

function formatSeconds(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ToolsPanel() {
  const { t } = useTranslation();
  const [activeTool, setActiveTool] = useState<ToolType | null>(null);
  const [toolOrder, setToolOrder] = useState<ToolType[]>(getInitialOrder);
  const [draggingId, setDraggingId] = useState<ToolType | null>(null);

  // Drag tracking refs
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const currentDragIdRef = useRef<ToolType | null>(null);

  const clipboardItems = useClipboardStore((s) => s.items);

  const isTimerRunning = useTimerStore((s) => s.isRunning);
  const isTimerCompleted = useTimerStore((s) => s.isCompleted);
  const timerRemaining = useTimerStore((s) => s.remainingSeconds);
  const timerDuration = useTimerStore((s) => s.durationSeconds);

  const isStopwatchRunning = useStopwatchStore((s) => s.isRunning);

  const isPomodoroRunning = usePomodoroStore((s) => s.isRunning);
  const pomodoroRemaining = usePomodoroStore((s) => s.remainingSeconds);
  const pomodoroMode = usePomodoroStore((s) => s.mode);
  const pomodoroCycle = usePomodoroStore((s) => s.cycle);

  const ports = usePortStore((s) => s.ports);
  const loadPorts = usePortStore((s) => s.loadPorts);

  const runnerApps = useRunnerStore((s) => s.apps);

  const waterConsumed = useWaterStore((s) => s.progress.consumedMl);
  const waterReminder = useWaterStore((s) => s.reminderActive);
  const waterSettings = useSettingsStore((s) => s.settings?.water);

  useEffect(() => {
    void loadPorts();
  }, [loadPorts]);

  const TOOLS_LIST = [
    {
      id: "clipboard" as const,
      title: t("tools.nav.clipboard"),
      icon: ClipboardList,
      badge:
        clipboardItems.length > 0
          ? t("tools.status.itemsCount", { count: clipboardItems.length })
          : t("tools.status.ready"),
      activeDot: clipboardItems.length > 0,
    },
    {
      id: "timer" as const,
      title: t("tools.nav.timer"),
      icon: Timer,
      badge: isTimerCompleted
        ? t("tools.status.completed")
        : isTimerRunning
          ? `${formatSeconds(timerRemaining)} · ${t("tools.status.running")}`
          : `${Math.round(timerDuration / 60)}m`,
      activeDot: isTimerRunning || isTimerCompleted,
      isAlert: isTimerCompleted,
    },
    {
      id: "stopwatch" as const,
      title: t("tools.nav.stopwatch"),
      icon: Clock,
      badge: isStopwatchRunning ? t("tools.status.running") : t("tools.status.ready"),
      activeDot: isStopwatchRunning,
    },
    {
      id: "pomodoro" as const,
      title: t("tools.nav.pomodoro"),
      icon: Flame,
      badge: isPomodoroRunning
        ? `${t(pomodoroMode === "work" ? "tools.status.focus" : "tools.status.break")} · ${formatSeconds(pomodoroRemaining)}`
        : t("tools.status.session", { cycle: pomodoroCycle }),
      activeDot: isPomodoroRunning,
    },
    {
      id: "ports" as const,
      title: t("tools.nav.ports"),
      icon: Network,
      badge:
        ports.length > 0
          ? t("tools.status.portsCount", { count: ports.length })
          : t("tools.status.ready"),
      activeDot: ports.length > 0,
    },
    {
      id: "runner" as const,
      title: t("tools.nav.runner"),
      icon: SquareTerminal,
      badge:
        runnerApps.length > 0
          ? t("tools.status.appsCount", { count: runnerApps.length })
          : t("tools.status.ready"),
      activeDot: runnerApps.some((a) => Boolean(a.runningPid)),
    },
    {
      id: "scanner" as const,
      title: t("tools.nav.scanner"),
      icon: QrCode,
      badge: t("tools.status.ready"),
      activeDot: false,
    },
    {
      id: "water" as const,
      title: t("tools.nav.water"),
      icon: GlassWater,
      badge: waterSettings
        ? `${Math.round((waterConsumed / Math.max(1, dailyTargetMl(waterSettings.weightKg))) * 100)}%`
        : t("tools.status.ready"),
      activeDot: waterConsumed > 0,
      isAlert: waterReminder,
    },
  ];

  // Quick move with arrows
  const moveTool = (id: ToolType, direction: "left" | "right") => {
    setToolOrder((prev) => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const targetIdx = direction === "left" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      if (moved) {
        next.splice(targetIdx, 0, moved);
      }
      try {
        localStorage.setItem(STORAGE_ORDER_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage write issues
      }
      return next;
    });
  };

  // Pointer drag reorder handlers
  const handlePointerDown = (e: React.PointerEvent, id: ToolType) => {
    // Left click only
    if (e.button !== 0) return;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;
    currentDragIdRef.current = id;

    const onPointerMove = (moveEvt: PointerEvent) => {
      if (!dragStartPos.current || !currentDragIdRef.current) return;
      const dist = Math.hypot(
        moveEvt.clientX - dragStartPos.current.x,
        moveEvt.clientY - dragStartPos.current.y,
      );

      if (dist > 5) {
        isDraggingRef.current = true;
        setDraggingId(currentDragIdRef.current);

        // Find element under cursor
        const elem = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
        const targetSlot = elem?.closest("[data-tool-slot]") as HTMLElement | null;
        if (targetSlot) {
          const targetId = targetSlot.dataset.toolSlot as ToolType;
          if (targetId && targetId !== currentDragIdRef.current) {
            const dragId = currentDragIdRef.current;
            setToolOrder((prev) => {
              const from = prev.indexOf(dragId);
              const to = prev.indexOf(targetId);
              if (from === -1 || to === -1 || from === to) return prev;
              const next = [...prev];
              next.splice(from, 1);
              next.splice(to, 0, dragId);
              try {
                localStorage.setItem(STORAGE_ORDER_KEY, JSON.stringify(next));
              } catch {
                // Ignore storage write issues
              }
              return next;
            });
          }
        }
      }
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);

      if (!isDraggingRef.current && currentDragIdRef.current) {
        // It was a click!
        setActiveTool(currentDragIdRef.current);
      }

      dragStartPos.current = null;
      isDraggingRef.current = false;
      currentDragIdRef.current = null;
      setDraggingId(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleResetOrder = () => {
    setToolOrder(DEFAULT_TOOL_ORDER);
    try {
      localStorage.removeItem(STORAGE_ORDER_KEY);
    } catch {
      // Ignore storage write issues
    }
  };

  const isCustomOrder = JSON.stringify(toolOrder) !== JSON.stringify(DEFAULT_TOOL_ORDER);

  // Map the current toolOrder to tool definitions
  const orderedTools = toolOrder
    .map((id) => TOOLS_LIST.find((t) => t.id === id))
    .filter((t): t is (typeof TOOLS_LIST)[number] => Boolean(t));

  return (
    <div className="flex h-full flex-col select-none">
      <AnimatePresence mode="wait">
        {activeTool == null ? (
          /* =========================================================
           * MENU VIEW: 3-Column Grid with Fluid Drag & Live Reorder
           * ========================================================= */
          <motion.div
            key="tools-grid-menu"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col h-full overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2.5 px-1 shrink-0">
              <div>
                <h3 className="text-xs font-semibold tracking-wide text-fg">
                  {t("tools.menuTitle")}
                </h3>
                <p className="text-[11px] text-subtle">{t("tools.reorderHint")}</p>
              </div>

              <div className="flex items-center gap-1.5">
                {isCustomOrder && (
                  <button
                    type="button"
                    onClick={handleResetOrder}
                    title={t("tools.resetOrder")}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-fg/5 hover:bg-fg/10 text-muted hover:text-fg text-[10px] border border-fg/10 transition-colors"
                  >
                    <RotateCcw className="size-2.5" />
                    <span>{t("common.reset")}</span>
                  </button>
                )}
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-fg/10 text-subtle border border-fg/10">
                  {t("tools.count", { count: TOOLS_LIST.length })}
                </span>
              </div>
            </div>

            {/* 3-Column Grid of Tool Cards */}
            <div className="grid grid-cols-3 gap-2.5 flex-1 min-h-0 items-start overflow-y-auto thin-scrollbar pr-1 pb-2">
              {orderedTools.map((tool, index) => {
                const Icon = tool.icon;
                const isDragging = draggingId === tool.id;
                const canMoveLeft = index > 0;
                const canMoveRight = index < orderedTools.length - 1;

                return (
                  <motion.div
                    key={tool.id}
                    layout
                    data-tool-slot={tool.id}
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                    onPointerDown={(e) => handlePointerDown(e, tool.id)}
                    className={`group relative flex flex-col justify-between text-left rounded-2xl glass-surface p-3 border transition-all duration-200 cursor-pointer overflow-hidden min-h-[102px] select-none ${
                      isDragging
                        ? "opacity-50 border-accent ring-2 ring-accent/50 shadow-2xl scale-[1.03] z-30"
                        : "border-fg/10 hover:border-fg/25 hover:glass-elevated hover:shadow-lg active:scale-[0.98]"
                    }`}
                  >
                    {/* Background subtle hover glow */}
                    <div className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-accent/15 blur-2xl opacity-0 group-hover:opacity-75 transition-opacity duration-300" />

                    {/* Quick Move Arrows & Drag Handle (Visible on hover) */}
                    <div
                      className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-md rounded-lg p-0.5 border border-fg/10 z-20"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canMoveLeft && (
                        <button
                          type="button"
                          onClick={() => moveTool(tool.id, "left")}
                          title={t("tools.moveLeft")}
                          className="size-4 flex items-center justify-center rounded text-muted hover:text-fg hover:bg-fg/10"
                        >
                          <ChevronLeft className="size-3" />
                        </button>
                      )}
                      <GripVertical className="size-3 text-muted/60 cursor-grab active:cursor-grabbing" />
                      {canMoveRight && (
                        <button
                          type="button"
                          onClick={() => moveTool(tool.id, "right")}
                          title={t("tools.moveRight")}
                          className="size-4 flex items-center justify-center rounded text-muted hover:text-fg hover:bg-fg/10"
                        >
                          <ChevronRight className="size-3" />
                        </button>
                      )}
                    </div>

                    {/* Card Top: Icon & Live Badge */}
                    <div className="flex items-center justify-between w-full pointer-events-none">
                      <div className="flex items-center justify-center size-8 rounded-xl bg-accent/15 border border-fg/10 group-hover:scale-105 transition-transform">
                        <Icon className="size-4 text-accent" />
                      </div>

                      {tool.badge && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-medium border font-mono ${
                            tool.isAlert
                              ? "bg-live/20 border-live/40 text-live animate-pulse"
                              : tool.activeDot
                                ? "bg-fg/15 border-fg/20 text-fg"
                                : "bg-fg/5 border-fg/10 text-subtle"
                          }`}
                        >
                          {tool.activeDot && !tool.isAlert && (
                            <span className="size-1 rounded-full shrink-0 animate-pulse bg-accent" />
                          )}
                          <span className="truncate max-w-[70px]">{tool.badge}</span>
                        </span>
                      )}
                    </div>

                    {/* Card Bottom: Title */}
                    <div className="mt-2.5 pointer-events-none">
                      <h4 className="text-[13px] font-semibold text-fg tracking-tight group-hover:text-fg transition-colors truncate">
                        {tool.title}
                      </h4>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        ) : (
          /* =========================================================
           * FEATURE VIEW: Active Tool with "Back to Tools" Header
           * ========================================================= */
          <motion.div
            key={`tool-view-${activeTool}`}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col h-full overflow-hidden"
          >
            {/* Top Navigation Bar: Back Button & Tool Header */}
            <header className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-fg/10 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTool(null)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-fg/5 hover:bg-fg/12 text-xs font-medium text-subtle hover:text-fg border border-fg/10 transition-colors active:scale-95"
              >
                <ArrowLeft className="size-3.5" />
                <span>{t("tools.backToMenu")}</span>
              </button>

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-fg">
                  {TOOLS_LIST.find((t) => t.id === activeTool)?.title}
                </span>
                <span className="size-1.5 rounded-full bg-accent" />
              </div>
            </header>

            {/* Active Tool Content */}
            <div className="relative flex-1 min-h-0 overflow-hidden">
              {activeTool === "clipboard" && <ClipboardTool />}
              {activeTool === "timer" && <TimerTool />}
              {activeTool === "stopwatch" && <StopwatchTool />}
              {activeTool === "pomodoro" && <PomodoroTool />}
              {activeTool === "ports" && <PortsTool />}
              {activeTool === "runner" && <RunnerTool />}
              {activeTool === "scanner" && <ScannerTool />}
              {activeTool === "water" && <WaterTool />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
