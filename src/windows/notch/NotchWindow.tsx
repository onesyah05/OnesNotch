import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  events,
  ipc,
  unlistenAll,
  type AppNotification,
  type AutoHideSettings,
  type NotchState,
} from "../../lib/ipc";
import { AnswerPanel } from "../../features/ai/answer-panel";
import { MusicPanel } from "../../features/media/music-panel";
import { NotificationPanel } from "../../features/notifications/notification-panel";
import { ToolsPanel } from "../../features/tools/tools-panel";
import { lastExchange, useAiStore } from "../../stores/useAiStore";
import { useMediaStore } from "../../stores/useMediaStore";
import { useNotchStore, type NotchTab } from "../../stores/useNotchStore";
import { useNotificationStore } from "../../stores/useNotificationStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useThemeStore } from "../../stores/useThemeStore";
import { useClipboardStore } from "../../stores/useClipboardStore";
import { useTimerStore } from "../../stores/useTimerStore";
import { usePomodoroStore } from "../../stores/usePomodoroStore";
import { useVideoStore } from "../../stores/useVideoStore";
import { useWaterStore } from "../../stores/useWaterStore";
import { shouldShowUpdatePill, useUpdateStore } from "../../stores/useUpdateStore";
import { Bell, Eye, EyeOff, Music, Settings, Sparkles, Wrench } from "lucide-react";
import { AnswerChip, type ChipSize } from "./answer-chip";
import { chipLayout, unwrapAnswerText } from "./chip-layout";
import { AuroraGradient } from "../../components/aurora-gradient";
import { LiquidRippleFrame } from "../../components/liquid-ripple-frame";
import { IdleStatus } from "./idle-status";
import { NotificationPill } from "./notification-pill";
import { NotchVideoPlayer } from "./notch-video-player";
import { PeekStatus } from "./peek-status";
import { WaterPill } from "./water-pill";
import { UpdatePill } from "./update-pill";
import { COLLAPSE_LINGER_MS, shouldReveal } from "./auto-hide";

const TABS: NotchTab[] = ["ai", "music", "notifications", "tools"];

const TAB_ICONS: Record<NotchTab, React.ComponentType<{ className?: string }>> = {
  ai: Sparkles,
  music: Music,
  notifications: Bell,
  tools: Wrench,
};

// Spring tuned for a Dynamic-Island-like feel: quick, slight overshoot.
const spring = { type: "spring", stiffness: 420, damping: 32, mass: 0.9 } as const;

/**
 * The notch hangs from the screen edge: square top corners, rounded bottom.
 * Bottom radius defaults to half the height (a pill end) capped at the panel radius.
 */
function shape(width: number, height: number, radius = 28) {
  const bottom = Math.min(radius, height / 2);
  return {
    width,
    height,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: bottom,
    borderBottomRightRadius: bottom,
  };
}

// Keep in sync with `NotchState::pill_size` in src-tauri/src/state.rs.
const SIZES = {
  idle: shape(320, 36),
  peek: shape(480, 72),
  expanded: shape(560, 420),
  // Placeholder until the chip measures its content.
  answer: shape(180, 44),
  popup: shape(440, 72),
  video: shape(320, 72),
  activity: shape(380, 72),
} as const;

const DEFAULT_AUTO_HIDE: AutoHideSettings = { enabled: true, intervalSeconds: 180, showSeconds: 5 };
const WATER_TICK_MS = 30_000;
const STARTUP_REVEAL_MS = 4_000;

export function NotchWindow() {
  const { t } = useTranslation();
  const { state, tab, visibleInCapture, opacity, setTab } = useNotchStore();
  const { activePopup, notifications, settings: notifSettings } = useNotificationStore();
  const { media } = useMediaStore();
  const isTimerRunning = useTimerStore((s) => s.isRunning);
  const isTimerCompleted = useTimerStore((s) => s.isCompleted);
  const isPomodoroRunning = usePomodoroStore((s) => s.isRunning);
  const pomodoroMode = usePomodoroStore((s) => s.mode);
  const {
    settings: videoSettings,
    activePlayingVideo,
    triggerRandomPlay,
    stopPlaying,
  } = useVideoStore();
  const autoHide = useSettingsStore((s) => s.settings?.autoHide) ?? DEFAULT_AUTO_HIDE;
  const waterSettings = useSettingsStore((s) => s.settings?.water);
  const waterActive = useWaterStore((s) => s.reminderActive);

  const hasMediaActivity = media.isPlaying || Boolean(media.title && media.title.length > 0);
  const hasTimerActivity = isTimerRunning || isTimerCompleted || isPomodoroRunning;
  const hasVideoActivity = Boolean(activePlayingVideo);
  const hasPopupActivity = Boolean(activePopup);

  const isShowingNotifPill = state !== "expanded" && hasPopupActivity;
  const isShowingWaterPill =
    !isShowingNotifPill &&
    waterActive &&
    Boolean(waterSettings) &&
    (state === "idle" || state === "peek");
  const updatePending = useUpdateStore(shouldShowUpdatePill);
  const isShowingUpdatePill =
    !isShowingNotifPill &&
    !isShowingWaterPill &&
    updatePending &&
    (state === "idle" || state === "peek");
  // Water and update pills share the popup footprint and block hover-peek.
  const isShowingSidePill = isShowingWaterPill || isShowingUpdatePill;

  // Measured size of the answer chip; drives the pill animation in answer state.
  const [chipSize, setChipSize] = useState<ChipSize | null>(null);
  const onChipSize = useCallback((size: ChipSize) => setChipSize(size), []);

  const lastExchangeItem = useAiStore((s) => lastExchange(s.exchanges));
  const rawLastAnswer = lastExchangeItem?.answer ?? "";
  const cleanLastAnswer = unwrapAnswerText(rawLastAnswer);
  const isLastEssay =
    !lastExchangeItem?.error &&
    Boolean(cleanLastAnswer) &&
    chipLayout(lastExchangeItem?.kind ?? null, cleanLastAnswer) === "essay";

  const idleShape =
    hasPopupActivity || isShowingSidePill
      ? SIZES.popup
      : hasVideoActivity
        ? SIZES.video
        : hasMediaActivity || hasTimerActivity
          ? SIZES.activity
          : SIZES.idle;

  // Forget the measured chip when the notch returns to idle (render-time
  // adjustment instead of an effect, per React's "you might not need an effect").
  const [chipState, setChipState] = useState(state);
  if (chipState !== state) {
    setChipState(state);
    if (state === "idle") setChipSize(null);
  }

  // Keep the backend's click-through rect in step with the pill footprint.
  useEffect(() => {
    if (state === "idle") {
      void ipc.setAnswerSize(idleShape.width, idleShape.height).catch(() => {});
    } else if (state === "peek") {
      const peek = isShowingSidePill ? SIZES.popup : SIZES.peek;
      void ipc.setAnswerSize(peek.width, peek.height).catch(() => {});
    }
  }, [state, idleShape.width, idleShape.height, isShowingSidePill]);

  const changeState = useCallback(
    (next: NotchState) => {
      if (next !== "idle" && useVideoStore.getState().activePlayingVideo) {
        stopPlaying();
      }
      useNotchStore.getState().setState(next);
      void ipc.setNotchState(next).catch(() => {});
    },
    [stopPlaying],
  );

  const toggleCapture = () => {
    const next = !useNotchStore.getState().visibleInCapture;
    useNotchStore.getState().setVisibleInCapture(next);
    void ipc.setVisibleInCapture(next).catch(() => {});
  };

  const handleDismissPopup = useCallback(() => {
    useNotificationStore.getState().dismissPopup();
  }, []);

  const handleOpenApp = (notif: AppNotification) => {
    void useNotificationStore.getState().openApp(notif);
    changeState("idle");
  };

  const handleWaterDone = useCallback(() => {
    if (useNotchStore.getState().state === "peek") {
      changeState("idle");
    }
  }, [changeState]);

  // ---------------------------------------------------------------------------
  // Auto-hide: the notch stays tucked above the screen edge unless something
  // happens. "Pulses" are short timed appearances (periodic, new song, ...).
  // ---------------------------------------------------------------------------
  const [pulsing, setPulsing] = useState(true);
  const pulseUntil = useRef(0);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pulse = useCallback((ms: number) => {
    const until = Date.now() + ms;
    // Never cut a longer appearance short.
    if (until <= pulseUntil.current && pulseTimer.current) return;
    pulseUntil.current = until;
    setPulsing(true);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => {
      pulseTimer.current = null;
      setPulsing(false);
    }, ms);
  }, []);

  useEffect(() => {
    pulse(STARTUP_REVEAL_MS);
    return () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    };
  }, [pulse]);

  // Periodic appearance.
  useEffect(() => {
    if (!autoHide.enabled) return;
    const id = setInterval(
      () => pulse(autoHide.showSeconds * 1000),
      autoHide.intervalSeconds * 1000,
    );
    return () => clearInterval(id);
  }, [autoHide.enabled, autoHide.intervalSeconds, autoHide.showSeconds, pulse]);

  // A new song or a pomodoro phase change is worth a short appearance.
  const showMs = autoHide.showSeconds * 1000;
  const mediaTitle = media.title;
  useEffect(() => {
    if (mediaTitle) pulse(showMs);
  }, [mediaTitle, showMs, pulse]);
  useEffect(() => {
    if (isPomodoroRunning) pulse(showMs);
  }, [pomodoroMode, isPomodoroRunning, showMs, pulse]);

  // Linger briefly after collapsing so the shrink animation is visible.
  const prevState = useRef(state);
  useEffect(() => {
    if (prevState.current !== "idle" && state === "idle") {
      pulse(COLLAPSE_LINGER_MS);
    }
    prevState.current = state;
  }, [state, pulse]);

  const reveal = shouldReveal({
    enabled: autoHide.enabled,
    state,
    hasEvent: hasPopupActivity || hasVideoActivity || isTimerCompleted || isShowingSidePill,
    pulsing,
  });

  useEffect(() => {
    void ipc.setConcealed(!reveal).catch(() => {});
  }, [reveal]);

  // ---------------------------------------------------------------------------
  // Drink reminder
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!waterSettings) return;
    const run = () => useWaterStore.getState().tick(waterSettings);
    run();
    const id = setInterval(run, WATER_TICK_MS);
    return () => clearInterval(id);
  }, [waterSettings]);

  useEffect(() => {
    void useNotchStore.getState().hydrate();
    void useSettingsStore.getState().load();
    void useThemeStore.getState().load();
    void useNotificationStore.getState().load();
    void useMediaStore.getState().load();
    void useClipboardStore.getState().load();
    void useVideoStore.getState().load();
    useWaterStore.getState().load();
    void useUpdateStore.getState().load();

    const pending = [
      events.notchStateChanged(({ state: next }) => useNotchStore.getState().setState(next)),
      events.settingsChanged(() => void useSettingsStore.getState().load()),
      events.themeChanged((theme) => useThemeStore.getState().setTheme(theme)),
      events.clipboardChanged((item) => useClipboardStore.getState().addItem(item)),
      events.aiTrigger(({ target }) => {
        // Hotkey answers land in the compact chip; only a click opens the panel.
        useNotchStore.getState().setTab("ai");
        if (useNotchStore.getState().state !== "expanded") {
          changeState("answer");
        }
        void useAiStore.getState().ask(target);
      }),
      events.stealthChanged(({ visible }) => useNotchStore.getState().setVisibleInCapture(visible)),
      events.opacityChanged(({ opacity: value }) => useNotchStore.getState().setOpacity(value)),
      events.panicChanged(({ active }) => useNotchStore.getState().setPanic(active)),
      events.hoverChanged(({ inside }) => {
        const store = useNotchStore.getState();
        const busy =
          Boolean(useNotificationStore.getState().activePopup) ||
          useWaterStore.getState().reminderActive ||
          shouldShowUpdatePill(useUpdateStore.getState());
        if (inside && store.state === "idle" && !busy) {
          changeState("peek");
        } else if (!inside && store.state === "peek") {
          changeState("idle");
        }
      }),
      events.notificationPopup((notif) => {
        useNotificationStore.getState().setActivePopup(notif);
      }),
      events.notificationUpdated((all) => {
        useNotificationStore.getState().setNotifications(all);
      }),
      events.updateAvailable((info) => useUpdateStore.getState().setInfo(info)),
      events.mediaChanged((m) => {
        useMediaStore.getState().setMedia(m);
      }),
    ];

    return () => unlistenAll(pending);
  }, [changeState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { state: current } = useNotchStore.getState();
      if (event.key === "Escape") {
        if (useNotificationStore.getState().activePopup) {
          handleDismissPopup();
          return;
        }
        if (current === "expanded" || current === "answer") {
          changeState("idle");
        }
      }
    };
    const onBlur = () => {
      if (useNotchStore.getState().state === "expanded") {
        changeState("idle");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [changeState, handleDismissPopup]);

  // Automatic random video interval playback
  useEffect(() => {
    if (!videoSettings.enabled || videoSettings.videos.length === 0) {
      return;
    }

    const intervalMs = Math.max(5, videoSettings.intervalSeconds) * 1000;
    const timer = setInterval(() => {
      const currentState = useNotchStore.getState().state;
      const hasPopup = Boolean(useNotificationStore.getState().activePopup);
      const isPlaying = Boolean(useVideoStore.getState().activePlayingVideo);
      const water = useWaterStore.getState().reminderActive;

      if (currentState === "idle" && !hasPopup && !isPlaying && !water) {
        triggerRandomPlay();
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [
    videoSettings.enabled,
    videoSettings.intervalSeconds,
    videoSettings.videos.length,
    triggerRandomPlay,
  ]);

  const isLiquidIdle =
    state === "idle" &&
    !isShowingNotifPill &&
    !isShowingSidePill &&
    !activePlayingVideo &&
    (hasMediaActivity || hasTimerActivity);

  const target =
    isShowingNotifPill || isShowingSidePill
      ? SIZES.popup
      : state === "answer"
        ? chipSize
          ? shape(chipSize.width, chipSize.height, chipSize.borderRadius)
          : isLastEssay
            ? SIZES.expanded
            : SIZES.answer
        : state === "peek"
          ? SIZES.peek
          : state === "expanded"
            ? SIZES.expanded
            : idleShape;

  const canHoverPeek = !isShowingNotifPill && !isShowingSidePill && !activePlayingVideo;

  return (
    <main
      className="flex h-full justify-center overflow-visible"
      onClick={(e) => {
        if (e.target === e.currentTarget && useNotchStore.getState().state === "expanded") {
          changeState("idle");
        }
      }}
    >
      {/* Auto-hide wrapper: slides the whole notch up out of view and back down. */}
      <motion.div
        initial={false}
        animate={reveal ? { y: 0, opacity: 1 } : { y: "-110%", opacity: 0 }}
        transition={
          reveal
            ? { type: "spring", stiffness: 320, damping: 30 }
            : { duration: 0.35, ease: [0.4, 0, 1, 1] }
        }
        className="h-fit"
        style={{ pointerEvents: reveal ? "auto" : "none" }}
        aria-hidden={!reveal}
      >
        <motion.div
          layout
          initial={false}
          animate={target}
          transition={spring}
          style={{ opacity: opacity / 100 }}
          onHoverStart={() =>
            canHoverPeek && useNotchStore.getState().state === "idle" && changeState("peek")
          }
          onHoverEnd={() =>
            canHoverPeek && useNotchStore.getState().state === "peek" && changeState("idle")
          }
          onClick={(e) => {
            e.stopPropagation();
            if (
              !isShowingNotifPill &&
              !isShowingSidePill &&
              useNotchStore.getState().state !== "expanded"
            ) {
              if (activePlayingVideo) {
                stopPlaying();
              }
              if (media.isPlaying || Boolean(media.title)) {
                setTab("music");
              }
              changeState("expanded");
            }
          }}
          className={`relative text-fg cursor-pointer select-none ${
            isLiquidIdle
              ? "bg-transparent border-0 shadow-none overflow-visible"
              : state === "expanded" || (state === "answer" && isLastEssay)
                ? "overflow-hidden glass-notch expanded-liquid-glow"
                : "overflow-hidden glass-notch"
          }`}
        >
          {!isLiquidIdle && !activePlayingVideo && (
            <AuroraGradient
              variant={state === "expanded" ? "expanded" : state === "answer" ? "chip" : "compact"}
              active={state === "peek" || state === "answer"}
            />
          )}

          {state !== "expanded" &&
            state !== "idle" &&
            !isShowingNotifPill &&
            !isShowingSidePill &&
            visibleInCapture && (
              <span className="absolute top-1/2 right-3 z-20 size-2 -translate-y-1/2 rounded-full bg-live" />
            )}

          <AnimatePresence mode="wait" initial={false}>
            {isShowingNotifPill && activePopup ? (
              <motion.div
                key={`notif-${activePopup.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="relative z-10 h-full w-full rounded-[inherit]"
              >
                <NotificationPill
                  notification={activePopup}
                  autoDismissSeconds={notifSettings.autoDismissSeconds}
                  onDismiss={handleDismissPopup}
                  onOpenApp={handleOpenApp}
                />
              </motion.div>
            ) : isShowingWaterPill && waterSettings ? (
              <motion.div
                key="water"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="relative z-10 h-full w-full rounded-[inherit]"
              >
                <WaterPill settings={waterSettings} onDone={handleWaterDone} />
              </motion.div>
            ) : isShowingUpdatePill ? (
              <motion.div
                key="update"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="relative z-10 h-full w-full rounded-[inherit]"
              >
                <UpdatePill />
              </motion.div>
            ) : state === "idle" ? (
              <motion.div
                key={
                  activePlayingVideo
                    ? `video-${activePlayingVideo.id}`
                    : isLiquidIdle
                      ? "idle-liquid"
                      : "idle-normal"
                }
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="relative z-10 flex h-full w-full items-center justify-center rounded-[inherit]"
              >
                {activePlayingVideo ? (
                  <NotchVideoPlayer
                    video={activePlayingVideo}
                    settings={videoSettings}
                    onFinished={stopPlaying}
                  />
                ) : isLiquidIdle ? (
                  <LiquidRippleFrame>
                    <IdleStatus visibleInCapture={visibleInCapture} />
                  </LiquidRippleFrame>
                ) : (
                  <IdleStatus visibleInCapture={visibleInCapture} />
                )}
              </motion.div>
            ) : state === "peek" ? (
              <motion.div
                key="peek"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="relative z-10 h-full w-full rounded-[inherit]"
              >
                <PeekStatus visibleInCapture={visibleInCapture} />
              </motion.div>
            ) : state === "answer" ? (
              <div className="relative z-10 h-full w-full rounded-[inherit]">
                <AnswerChip key="answer" onSize={onChipSize} />
              </div>
            ) : state === "expanded" ? (
              <motion.div
                key="expanded"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="relative z-10 flex h-full flex-col px-4 pt-3 pb-2"
              >
                <header className="mb-3 flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${visibleInCapture ? "bg-live" : "bg-ok"}`}
                    aria-hidden="true"
                  />
                  <span className="text-xs text-subtle">
                    {t(visibleInCapture ? "notch.visibleInCapture" : "notch.hiddenFromCapture")}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <PillButton
                      label={t("notch.toggleCapture")}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleCapture();
                      }}
                    >
                      {visibleInCapture ? (
                        <Eye className="size-3.5" />
                      ) : (
                        <EyeOff className="size-3.5" />
                      )}
                    </PillButton>
                    <PillButton
                      label={t("notch.openSettings")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void ipc.showSettings().catch(() => {});
                      }}
                    >
                      <Settings className="size-3.5" />
                    </PillButton>
                  </div>
                </header>

                <nav className="flex gap-1 rounded-full glass-surface p-1">
                  {TABS.map((key) => {
                    const TabIcon = TAB_ICONS[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setTab(key);
                        }}
                        className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                          tab === key
                            ? "glass-elevated text-fg shadow-sm"
                            : "text-muted hover:text-subtle"
                        }`}
                      >
                        <TabIcon className="size-3.5 shrink-0" />
                        <span>{t(`tabs.${key}`)}</span>
                        {key === "notifications" && notifications.length > 0 && (
                          <span className="ml-1 inline-flex size-1.5 rounded-full bg-accent" />
                        )}
                        {key === "music" && media.isPlaying && (
                          <span className="ml-1 inline-flex size-1.5 animate-pulse rounded-full bg-accent" />
                        )}
                      </button>
                    );
                  })}
                </nav>

                {tab === "ai" ? (
                  <section className="mt-3 min-h-0 flex-1 rounded-2xl glass-surface p-4">
                    <AnswerPanel />
                  </section>
                ) : tab === "music" ? (
                  <section className="mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl glass-surface">
                    <MusicPanel />
                  </section>
                ) : tab === "notifications" ? (
                  <section className="mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl glass-surface p-4">
                    <NotificationPanel />
                  </section>
                ) : (
                  <section className="mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl glass-surface p-3.5">
                    <ToolsPanel />
                  </section>
                )}

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    changeState("idle");
                  }}
                  className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted/60 transition-colors hover:bg-subtle"
                  aria-label={t("notch.collapse")}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </main>
  );
}

interface PillButtonProps {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}

function PillButton({ label, onClick, children }: PillButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-full glass-surface text-muted transition-all hover:bg-elevated hover:text-fg active:scale-95"
    >
      {children}
    </button>
  );
}
