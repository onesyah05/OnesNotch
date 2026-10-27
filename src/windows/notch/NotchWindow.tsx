import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { events, ipc, unlistenAll, type AppNotification, type NotchState } from "../../lib/ipc";
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
import { Bell, Eye, EyeOff, Music, Settings, Sparkles, Wrench } from "lucide-react";
import { AnswerChip, type ChipSize } from "./answer-chip";
import { chipLayout, unwrapAnswerText } from "./chip-layout";
import { AuroraGradient } from "../../components/aurora-gradient";
import { LiquidRippleFrame } from "../../components/liquid-ripple-frame";
import { IdleStatus } from "./idle-status";
import { NotificationPill } from "./notification-pill";
import { NotchVideoPlayer } from "./notch-video-player";
import { PeekStatus } from "./peek-status";

const TABS: NotchTab[] = ["ai", "music", "notifications", "tools"];

const TAB_ICONS: Record<NotchTab, React.ComponentType<{ className?: string }>> = {
  ai: Sparkles,
  music: Music,
  notifications: Bell,
  tools: Wrench,
};

// Spring tuned for a Dynamic-Island-like feel: quick, slight overshoot.
const spring = { type: "spring", stiffness: 420, damping: 32, mass: 0.9 } as const;

// Keep in sync with `NotchState::pill_size` in src-tauri/src/state.rs.
const SIZES = {
  idle: { width: 320, height: 36, borderRadius: 9999 },
  peek: { width: 480, height: 72, borderRadius: 9999 },
  expanded: { width: 560, height: 420, borderRadius: 28 },
  // Placeholder until the chip measures its content.
  answer: { width: 180, height: 44, borderRadius: 9999 },
} as const;

export function NotchWindow() {
  const { t } = useTranslation();
  const { state, tab, visibleInCapture, opacity, setTab } = useNotchStore();
  const { activePopup, notifications, settings: notifSettings } = useNotificationStore();
  const { media } = useMediaStore();
  const isTimerRunning = useTimerStore((s) => s.isRunning);
  const isTimerCompleted = useTimerStore((s) => s.isCompleted);
  const isPomodoroRunning = usePomodoroStore((s) => s.isRunning);
  const {
    settings: videoSettings,
    activePlayingVideo,
    triggerRandomPlay,
    stopPlaying,
  } = useVideoStore();

  const hasMediaActivity = media.isPlaying || Boolean(media.title && media.title.length > 0);
  const hasTimerActivity = isTimerRunning || isTimerCompleted || isPomodoroRunning;
  const hasVideoActivity = Boolean(activePlayingVideo);
  const hasPopupActivity = Boolean(activePopup);

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

  useEffect(() => {
    if (state === "idle") {
      setChipSize(null);
    }
  }, [state]);

  // Synchronize dynamic hit-testing and pill footprint with Rust
  useEffect(() => {
    if (state === "idle") {
      if (hasPopupActivity) {
        void ipc.setAnswerSize(440, 72).catch(() => {});
      } else if (hasVideoActivity) {
        void ipc.setAnswerSize(320, 72).catch(() => {});
      } else if (hasMediaActivity || hasTimerActivity) {
        void ipc.setAnswerSize(380, 72).catch(() => {});
      } else {
        void ipc.setAnswerSize(320, 36).catch(() => {});
      }
    } else if (state === "peek") {
      void ipc.setAnswerSize(480, 72).catch(() => {});
    }
  }, [state, hasPopupActivity, hasVideoActivity, hasMediaActivity, hasTimerActivity]);

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

  const handleDismissPopup = () => {
    useNotificationStore.getState().dismissPopup();
    if (useNotchStore.getState().state === "idle") {
      const isMedia = useMediaStore.getState().media.isPlaying;
      const isTimer =
        useTimerStore.getState().isRunning ||
        useTimerStore.getState().isCompleted ||
        usePomodoroStore.getState().isRunning;
      const isVideo = Boolean(useVideoStore.getState().activePlayingVideo);
      const isWide = isMedia || isTimer;
      void ipc.setAnswerSize(isWide ? 380 : 320, isWide || isVideo ? 72 : 36).catch(() => {});
    }
  };

  const handleOpenApp = (notif: AppNotification) => {
    void useNotificationStore.getState().openApp(notif);
    const isMedia = useMediaStore.getState().media.isPlaying;
    const isTimer =
      useTimerStore.getState().isRunning ||
      useTimerStore.getState().isCompleted ||
      usePomodoroStore.getState().isRunning;
    const isVideo = Boolean(useVideoStore.getState().activePlayingVideo);
    const isWide = isMedia || isTimer;
    void ipc.setAnswerSize(isWide ? 380 : 320, isWide || isVideo ? 72 : 36).catch(() => {});
    changeState("idle");
  };

  useEffect(() => {
    void useNotchStore.getState().hydrate();
    void useSettingsStore.getState().load();
    void useThemeStore.getState().load();
    void useNotificationStore.getState().load();
    void useMediaStore.getState().load();
    void useClipboardStore.getState().load();
    void useVideoStore.getState().load();

    const pending = [
      events.notchStateChanged(({ state: next }) => useNotchStore.getState().setState(next)),
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
        if (inside && store.state === "idle" && !useNotificationStore.getState().activePopup) {
          changeState("peek");
        } else if (!inside && store.state === "peek") {
          changeState("idle");
        }
      }),
      events.notificationPopup((notif) => {
        useNotificationStore.getState().setActivePopup(notif);
        if (useNotchStore.getState().state !== "expanded") {
          void ipc.setAnswerSize(440, 72).catch(() => {});
        }
      }),
      events.notificationUpdated((all) => {
        useNotificationStore.getState().setNotifications(all);
      }),
      events.mediaChanged((m) => {
        useMediaStore.getState().setMedia(m);
      }),
    ];

    return () => unlistenAll(pending);
  }, []);

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
      const { state: current } = useNotchStore.getState();
      if (current === "expanded") {
        changeState("idle");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

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

      if (currentState === "idle" && !hasPopup && !isPlaying) {
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

  const isShowingNotifPill = state !== "expanded" && Boolean(activePopup);

  return (
    <main
      className="flex h-full justify-center pt-3 overflow-visible"
      onClick={(e) => {
        if (e.target === e.currentTarget && useNotchStore.getState().state === "expanded") {
          changeState("idle");
        }
      }}
    >
      <motion.div
        layout
        initial={false}
        animate={
          isShowingNotifPill
            ? { width: 440, height: 72, borderRadius: 9999 }
            : state === "answer"
              ? chipSize
                ? {
                    width: chipSize.width,
                    height: chipSize.height,
                    borderRadius: chipSize.borderRadius,
                  }
                : isLastEssay
                  ? { width: 560, height: 420, borderRadius: 28 }
                  : SIZES.answer
              : state === "peek"
                ? SIZES.peek
                : state === "expanded"
                  ? SIZES.expanded
                  : state === "idle" && hasVideoActivity
                    ? { width: 320, height: 72, borderRadius: 9999 }
                    : state === "idle" && (hasMediaActivity || hasTimerActivity)
                      ? { width: 380, height: 72, borderRadius: 9999 }
                      : SIZES.idle
        }
        transition={spring}
        style={{ opacity: opacity / 100 }}
        onHoverStart={() =>
          !isShowingNotifPill &&
          !activePlayingVideo &&
          useNotchStore.getState().state === "idle" &&
          changeState("peek")
        }
        onHoverEnd={() =>
          !isShowingNotifPill &&
          !activePlayingVideo &&
          useNotchStore.getState().state === "peek" &&
          changeState("idle")
        }
        onClick={(e) => {
          e.stopPropagation();
          if (!isShowingNotifPill && useNotchStore.getState().state !== "expanded") {
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
          state === "idle" && (hasMediaActivity || hasTimerActivity) && !activePlayingVideo
            ? "bg-transparent border-0 shadow-none overflow-visible"
            : state === "expanded" || (state === "answer" && isLastEssay)
              ? "overflow-hidden glass-notch expanded-liquid-glow"
              : "overflow-hidden glass-notch"
        }`}
      >
        {/* Organic fluid aurora gradient layer matching reference */}
        {!(state === "idle" && (hasMediaActivity || hasTimerActivity)) && !activePlayingVideo && (
          <AuroraGradient
            variant={state === "expanded" ? "expanded" : state === "answer" ? "chip" : "compact"}
            active={state === "peek" || state === "answer"}
          />
        )}

        {state !== "expanded" && state !== "idle" && !isShowingNotifPill && visibleInCapture && (
          <span className="absolute top-1/2 right-3 z-20 size-2 -translate-y-1/2 rounded-full bg-live" />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {isShowingNotifPill && activePopup ? (
            <motion.div
              key={`notif-${activePopup.id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative z-10 h-full w-full"
            >
              <NotificationPill
                notification={activePopup}
                autoDismissSeconds={notifSettings.autoDismissSeconds}
                onDismiss={handleDismissPopup}
                onOpenApp={handleOpenApp}
              />
            </motion.div>
          ) : state === "idle" ? (
            <motion.div
              key={
                activePlayingVideo
                  ? `video-${activePlayingVideo.id}`
                  : hasMediaActivity || hasTimerActivity
                    ? "idle-liquid"
                    : "idle-normal"
              }
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative z-10 h-full w-full flex items-center justify-center"
            >
              {activePlayingVideo ? (
                <NotchVideoPlayer
                  video={activePlayingVideo}
                  settings={videoSettings}
                  onFinished={stopPlaying}
                />
              ) : hasMediaActivity || hasTimerActivity ? (
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
              className="relative z-10 h-full w-full"
            >
              <PeekStatus visibleInCapture={visibleInCapture} />
            </motion.div>
          ) : state === "answer" ? (
            <div className="relative z-10 h-full w-full">
              <AnswerChip key="answer" onSize={onChipSize} />
            </div>
          ) : state === "expanded" ? (
            <motion.div
              key="expanded"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="relative z-10 flex h-full flex-col p-4"
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
                      className={`relative flex-1 flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                        tab === key
                          ? "glass-elevated text-fg shadow-sm"
                          : "text-muted hover:text-subtle"
                      }`}
                    >
                      <TabIcon className="size-3.5 shrink-0" />
                      <span>{t(`tabs.${key}`)}</span>
                      {key === "notifications" && notifications.length > 0 && (
                        <span className="ml-1 inline-flex size-1.5 rounded-full bg-cyan-400" />
                      )}
                      {key === "music" && media.isPlaying && (
                        <span className="ml-1 inline-flex size-1.5 rounded-full bg-cyan-400 animate-pulse" />
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
                <section className="mt-3 min-h-0 flex-1 rounded-2xl glass-surface overflow-hidden">
                  <MusicPanel />
                </section>
              ) : tab === "notifications" ? (
                <section className="mt-3 min-h-0 flex-1 rounded-2xl glass-surface p-4 overflow-hidden">
                  <NotificationPanel />
                </section>
              ) : (
                <section className="mt-3 min-h-0 flex-1 rounded-2xl glass-surface p-3.5 overflow-hidden">
                  <ToolsPanel />
                </section>
              )}

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  changeState("idle");
                }}
                className="mx-auto mt-3 h-1 w-10 rounded-full bg-muted/60 hover:bg-subtle transition-colors"
                aria-label={t("notch.collapse")}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
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
      className="flex size-7 items-center justify-center rounded-full glass-surface text-muted transition-all hover:bg-elevated hover:text-fg hover:border-white/20 active:scale-95"
    >
      {children}
    </button>
  );
}
