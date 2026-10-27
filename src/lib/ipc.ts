/**
 * Typed bridge to the Rust backend.
 * This is the ONLY module allowed to call `invoke()` or `listen()` (see AGENTS.md).
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirrors `AppError` in src-tauri/src/error.rs. */
export interface AppError {
  code: string;
  message: string;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AppError).code === "string" &&
    typeof (value as AppError).message === "string"
  );
}

/** Normalizes anything thrown by `invoke()` into an `AppError`. */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  return { code: "internal", message: value instanceof Error ? value.message : String(value) };
}

/** Mirrors `AppInfo` in src-tauri/src/commands.rs. */
export interface AppInfo {
  name: string;
  version: string;
  osBuild: number | null;
}

export type NotchState = "idle" | "peek" | "expanded" | "answer";

/** Mirrors `AppStatus` in src-tauri/src/commands.rs. */
export interface AppStatus {
  visibleInCapture: boolean;
  panic: boolean;
  opacity: number;
  state: NotchState;
}

/** Mirrors `CaptureTarget` in src-tauri/src/capture/mod.rs. */
export type CaptureTarget = "screen" | "window";

/** Mirrors `ProviderId` in src-tauri/src/ai/mod.rs. */
export type ProviderId = "anthropic" | "openai" | "gemini" | "ollama" | "openai_compatible";

/** Mirrors `KeyPolicy` in src-tauri/src/ai/mod.rs. */
export type KeyPolicy = "required" | "optional" | "none";

/** Mirrors `UiLanguage` in src-tauri/src/ai/prompts.rs. */
export type UiLanguage = "en" | "id";

/** Mirrors `HotkeyAction` in src-tauri/src/hotkeys.rs. */
export type HotkeyAction =
  "answerScreen" | "answerWindow" | "cancel" | "toggleExpand" | "panic" | "toggleCapture";

export const HOTKEY_ACTIONS: HotkeyAction[] = [
  "answerScreen",
  "answerWindow",
  "cancel",
  "toggleExpand",
  "panic",
  "toggleCapture",
];

export type HotkeySettings = Record<HotkeyAction, string>;

/** Mirrors `AnswerKind` in src-tauri/src/ai/prompts.rs. */
export type AnswerKind = "pg" | "essay";

/** Mirrors `AiEvent` in src-tauri/src/ai/session.rs. */
export type AiEvent =
  | { type: "started"; sessionId: number; provider: ProviderId; model: string }
  | { type: "captured"; width: number; height: number; captureMs: number }
  | { type: "answer"; kind: AnswerKind; text: string }
  | { type: "done"; elapsedMs: number; firstTokenMs: number | null }
  | { type: "cancelled" }
  | { type: "error"; error: AppError };

/** Mirrors `ProviderView` in src-tauri/src/commands.rs. */
export interface ProviderView {
  id: ProviderId;
  keyPolicy: KeyPolicy;
  hasKey: boolean;
  /** Custom model, or null when the default is used. */
  model: string | null;
  defaultModel: string;
  baseUrl: string | null;
  baseUrlEditable: boolean;
}

export interface AppNotification {
  id: string;
  appName: string;
  appId?: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  icon?: string;
}

export interface NotificationSettings {
  enabled: boolean;
  dndEnabled: boolean;
  autoDismissSeconds: number;
  allowedApps: string[];
}

/** Mirrors `ThemeSettings` in src-tauri/src/storage/settings.rs. */
export interface ThemeSettings {
  backgroundColor: string;
  accentColor: string;
}

/** Mirrors `SettingsView` in src-tauri/src/commands.rs. */
export interface SettingsView {
  provider: ProviderId;
  captureMode: CaptureTarget;
  historyEnabled: boolean;
  providers: ProviderView[];
  hotkeys: HotkeySettings;
  hotkeyDefaults: HotkeySettings;
  opacity: number;
  notifications: NotificationSettings;
  theme: ThemeSettings;
}

/** Mirrors `SettingsPatch` in src-tauri/src/commands.rs. */
export interface SettingsPatch {
  provider?: ProviderId;
  captureMode?: CaptureTarget;
  historyEnabled?: boolean;
}

/** Mirrors `HistoryEntry` in src-tauri/src/storage/db.rs. */
export interface HistoryEntry {
  id: number;
  createdAt: number;
  provider: ProviderId;
  model: string;
  target: CaptureTarget;
  prompt: string | null;
  answer: string;
}

export interface StealthEvent {
  visible: boolean;
}

export interface NotchStateEvent {
  state: NotchState;
}

export interface HoverEvent {
  inside: boolean;
}

export interface OpacityEvent {
  opacity: number;
}

export interface PanicEvent {
  active: boolean;
}

export interface TriggerEvent {
  target: CaptureTarget;
}

export interface BatteryInfo {
  level: number | null;
  charging: boolean;
  acOnline: boolean;
}

export interface NetworkSpeed {
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxMbps: number;
  txMbps: number;
  totalMbps: number;
}

export interface TopProcess {
  name: string;
  cpuUsage: number;
  memoryMb: number;
}

export interface HardwareStats {
  cpuUsage: number;
  cpuTemp: number;
  isTempEstimated: boolean;
  ramUsedBytes: number;
  ramTotalBytes: number;
  ramUsagePercent: number;
  topProcess: TopProcess | null;
  isHeavyLoad: boolean;
}

export interface SystemStats {
  battery: BatteryInfo;
  network: NetworkSpeed;
  hardware: HardwareStats;
}

function channel(onEvent: (event: AiEvent) => void): Channel<AiEvent> {
  // The handler must be set before the channel reaches the backend.
  return new Channel<AiEvent>(onEvent);
}

export const ipc = {
  appInfo: () => invoke<AppInfo>("app_info"),
  appStatus: () => invoke<AppStatus>("app_status"),
  setNotchState: (state: NotchState) => invoke<void>("set_notch_state", { state }),
  /** Reports the measured answer-chip size so click-through follows it. */
  setAnswerSize: (width: number, height: number) =>
    invoke<void>("set_answer_size", { width, height }),
  setVisibleInCapture: (visible: boolean) => invoke<void>("set_visible_in_capture", { visible }),
  setOpacity: (opacity: number) => invoke<number>("set_opacity", { opacity }),
  showSettings: () => invoke<void>("show_settings"),
  hideSettings: () => invoke<void>("hide_settings"),
  togglePanic: () => invoke<boolean>("toggle_panic"),
  clipboardWrite: (text: string) => invoke<void>("clipboard_write", { text }),
  getSystemStats: () => invoke<SystemStats>("get_system_stats"),

  aiAnswer: (target: CaptureTarget, lang: UiLanguage, onEvent: (event: AiEvent) => void) =>
    invoke<number>("ai_answer", { target, lang, onEvent: channel(onEvent) }),
  aiFollowup: (sessionId: number, text: string, onEvent: (event: AiEvent) => void) =>
    invoke<number>("ai_followup", { sessionId, text, onEvent: channel(onEvent) }),
  aiRetry: (sessionId: number, onEvent: (event: AiEvent) => void) =>
    invoke<number>("ai_retry", { sessionId, onEvent: channel(onEvent) }),
  aiCancel: (sessionId: number) => invoke<void>("ai_cancel", { sessionId }),

  settingsGet: () => invoke<SettingsView>("settings_get"),
  settingsUpdate: (patch: SettingsPatch) => invoke<SettingsView>("settings_update", { patch }),
  themeSet: (backgroundColor?: string, accentColor?: string) =>
    invoke<ThemeSettings>("theme_set", { backgroundColor, accentColor }),
  /** `null` leaves a field unchanged; an empty string resets it to the default. */
  providerUpdate: (id: ProviderId, model: string | null, baseUrl: string | null) =>
    invoke<SettingsView>("provider_update", { id, model, baseUrl }),
  /** The key goes straight to the OS credential store; it is never read back. */
  providerSetKey: (id: ProviderId, key: string) =>
    invoke<SettingsView>("provider_set_key", { id, key }),
  providerDeleteKey: (id: ProviderId) => invoke<SettingsView>("provider_delete_key", { id }),
  providerTest: (id: ProviderId) => invoke<string[]>("provider_test", { id }),
  hotkeySet: (action: HotkeyAction, accelerator: string) =>
    invoke<SettingsView>("hotkey_set", { action, accelerator }),
  hotkeysSuspend: (suspended: boolean) => invoke<void>("hotkeys_suspend", { suspended }),

  historyList: (limit: number, before: number | null) =>
    invoke<HistoryEntry[]>("history_list", { limit, before }),
  historyDelete: (id: number) => invoke<boolean>("history_delete", { id }),
  historyClear: () => invoke<number>("history_clear"),

  notificationList: () => invoke<AppNotification[]>("notification_list"),
  notificationDismiss: (id: string) => invoke<boolean>("notification_dismiss", { id }),
  notificationClearAll: () => invoke<void>("notification_clear_all"),
  notificationOpenApp: (appName: string, appId?: string) =>
    invoke<boolean>("notification_open_app", { appName, appId }),
  notificationSimulate: (notification: AppNotification) =>
    invoke<void>("notification_simulate", { notification }),
  notificationUpdateSettings: (settings: NotificationSettings) =>
    invoke<NotificationSettings>("notification_update_settings", { settings }),

  mediaGetState: () => invoke<MediaState>("media_get_state"),
  mediaTogglePlayPause: () => invoke<void>("media_toggle_play_pause"),
  mediaPlay: () => invoke<void>("media_play"),
  mediaPause: () => invoke<void>("media_pause"),
  mediaNext: () => invoke<void>("media_next"),
  mediaPrevious: () => invoke<void>("media_previous"),
  mediaSeek: (positionMs: number) => invoke<void>("media_seek", { positionMs }),
  mediaSetVolume: (volume: number) => invoke<void>("media_set_volume", { volume }),
  mediaToggleMute: () => invoke<boolean>("media_toggle_mute"),

  clipboardGetHistory: () => invoke<ClipboardItem[]>("clipboard_get_history"),
  clipboardDeleteItem: (id: string) => invoke<boolean>("clipboard_delete_item", { id }),
  clipboardClearHistory: () => invoke<void>("clipboard_clear_history"),

  portsGetActive: () => invoke<PortInfo[]>("ports_get_active"),
  portsKillProcess: (pid: number) => invoke<void>("ports_kill_process", { pid }),

  runnerExecute: (req: RunRequest) => invoke<RunResponse>("runner_execute", { req }),
  runnerOpenDirectory: (directory: string) => invoke<void>("runner_open_directory", { directory }),
  runnerStopProcess: (pid: number) => invoke<void>("runner_stop_process", { pid }),
  runnerStopApp: (req: StopRequest) => invoke<RunResponse>("runner_stop_app", { req }),
  runnerPickDirectory: () => invoke<string | null>("runner_pick_directory"),
  videoPickFiles: () => invoke<string[]>("video_pick_files"),
  captureScreenBase64: (target?: CaptureTarget) =>
    invoke<string>("capture_screen_base64", { target }),
  openUrlOrSearch: (query: string) =>
    invoke<boolean>("open_url_or_search", { query }),
};

export interface RunRequest {
  command: string;
  commandStop?: string;
  directory?: string;
  terminal?: "auto" | "wt" | "powershell" | "cmd";
  mode?: "terminal" | "background";
}

export interface StopRequest {
  pid?: number;
  commandStop?: string;
  directory?: string;
}

export interface RunResponse {
  success: boolean;
  message: string;
  pid?: number;
}

export interface PortInfo {
  port: number;
  protocol: string;
  localAddress: string;
  state: string;
  pid: number;
  processName: string;
}

export interface ClipboardItem {
  id: string;
  text: string;
  timestamp: number;
}

export interface MediaState {
  isPlaying: boolean;
  title: string;
  artist: string;
  album: string;
  appName: string;
  coverUrl: string | null;
  positionMs: number;
  durationMs: number;
  volume: number;
  isMuted: boolean;
  canPlayPause: boolean;
  canSkipNext: boolean;
  canSkipPrevious: boolean;
  canSeek: boolean;
}

export const events = {
  stealthChanged: (handler: (payload: StealthEvent) => void): Promise<UnlistenFn> =>
    listen<StealthEvent>("stealth://changed", (event) => handler(event.payload)),
  notchStateChanged: (handler: (payload: NotchStateEvent) => void): Promise<UnlistenFn> =>
    listen<NotchStateEvent>("notch://state", (event) => handler(event.payload)),
  hoverChanged: (handler: (payload: HoverEvent) => void): Promise<UnlistenFn> =>
    listen<HoverEvent>("notch://hover", (event) => handler(event.payload)),
  opacityChanged: (handler: (payload: OpacityEvent) => void): Promise<UnlistenFn> =>
    listen<OpacityEvent>("appearance://opacity", (event) => handler(event.payload)),
  themeChanged: (handler: (payload: ThemeSettings) => void): Promise<UnlistenFn> =>
    listen<ThemeSettings>("appearance://theme", (event) => handler(event.payload)),
  panicChanged: (handler: (payload: PanicEvent) => void): Promise<UnlistenFn> =>
    listen<PanicEvent>("panic://changed", (event) => handler(event.payload)),
  aiTrigger: (handler: (payload: TriggerEvent) => void): Promise<UnlistenFn> =>
    listen<TriggerEvent>("ai://trigger", (event) => handler(event.payload)),
  settingsChanged: (handler: () => void): Promise<UnlistenFn> =>
    listen("settings://changed", () => handler()),
  systemStats: (handler: (payload: SystemStats) => void): Promise<UnlistenFn> =>
    listen<SystemStats>("system://stats", (event) => handler(event.payload)),
  notificationPopup: (handler: (payload: AppNotification) => void): Promise<UnlistenFn> =>
    listen<AppNotification>("notification://popup", (event) => handler(event.payload)),
  notificationUpdated: (handler: (payload: AppNotification[]) => void): Promise<UnlistenFn> =>
    listen<AppNotification[]>("notification://updated", (event) => handler(event.payload)),
  mediaChanged: (handler: (payload: MediaState) => void): Promise<UnlistenFn> =>
    listen<MediaState>("media://changed", (event) => handler(event.payload)),
  clipboardChanged: (handler: (payload: ClipboardItem) => void): Promise<UnlistenFn> =>
    listen<ClipboardItem>("clipboard://changed", (event) => handler(event.payload)),
};

/** Resolves every pending `listen()` when the component unmounts. */
export function unlistenAll(pending: Array<Promise<UnlistenFn>>): void {
  for (const promise of pending) {
    promise.then((unlisten) => unlisten()).catch(() => {});
  }
}
