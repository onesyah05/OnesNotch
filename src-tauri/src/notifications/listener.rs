//! Windows notification listener and application window focusing.
//! Uses WinRT `UserNotificationListener` when available, with graceful fallback.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SW_RESTORE, SW_SHOW, SetForegroundWindow,
    ShowWindow,
};
use windows::core::BOOL;

use super::{AppNotification, NotificationSettings};

/// In-memory notification state and manager.
#[derive(Debug)]
pub struct NotificationManager {
    notifications: Vec<AppNotification>,
    settings: NotificationSettings,
    max_history: usize,
}

impl NotificationManager {
    pub fn new(settings: NotificationSettings) -> Self {
        Self {
            notifications: Vec::new(),
            settings,
            max_history: 50,
        }
    }

    pub fn list(&self) -> Vec<AppNotification> {
        self.notifications.clone()
    }

    #[allow(dead_code)]
    pub fn get_settings(&self) -> NotificationSettings {
        self.settings.clone()
    }

    pub fn update_settings(&mut self, settings: NotificationSettings) {
        self.settings = settings;
    }

    /// Checks whether an app is permitted under DND whitelist rules.
    pub fn is_allowed(&self, app_name: &str) -> bool {
        let needle = app_name.trim().to_lowercase();
        self.settings.allowed_apps.iter().any(|allowed| {
            let a = allowed.trim().to_lowercase();
            needle.contains(&a) || a.contains(&needle)
        })
    }

    /// Adds a notification. Returns `(should_popup, added)`.
    pub fn add(&mut self, mut notif: AppNotification) -> (bool, bool) {
        if !self.settings.enabled {
            return (false, false);
        }

        // Deduplicate recent notifications with the same ID or same content
        if self.notifications.iter().any(|n| {
            n.id == notif.id
                || (n.app_name == notif.app_name
                    && n.title == notif.title
                    && n.body == notif.body
                    && notif.timestamp.saturating_sub(n.timestamp) < 3000)
        }) {
            return (false, false);
        }

        if notif.timestamp == 0 {
            notif.timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
        }

        let should_popup = if self.settings.dnd_enabled {
            // Under Do Not Disturb, only allowed apps produce a pop-up pill.
            self.is_allowed(&notif.app_name)
        } else {
            true
        };

        self.notifications.insert(0, notif);
        if self.notifications.len() > self.max_history {
            self.notifications.truncate(self.max_history);
        }

        (should_popup, true)
    }

    pub fn dismiss(&mut self, id: &str) -> bool {
        let initial_len = self.notifications.len();
        self.notifications.retain(|n| n.id != id);
        self.notifications.len() != initial_len
    }

    pub fn clear_all(&mut self) {
        self.notifications.clear();
    }

    #[allow(dead_code)]
    pub fn mark_all_read(&mut self) {
        for n in &mut self.notifications {
            n.read = true;
        }
    }
}

struct EnumSearch {
    target: String,
    found_hwnd: Option<HWND>,
}

// SAFETY: EnumWindows callback to find visible window with matching title.
unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam is a valid pointer to EnumSearch.
    let ctx = unsafe { &mut *(lparam.0 as *mut EnumSearch) };

    // SAFETY: Calling Win32 window APIs.
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let len = GetWindowTextLengthW(hwnd);
        if len == 0 {
            return BOOL(1);
        }
        let mut buf = vec![0u16; (len + 1) as usize];
        let read = GetWindowTextW(hwnd, &mut buf);
        if read > 0 {
            let title = String::from_utf16_lossy(&buf[..read as usize]);
            let lower = title.to_lowercase();
            if lower.contains(&ctx.target) {
                ctx.found_hwnd = Some(hwnd);
                return BOOL(0); // Found match, stop enum
            }
        }
        BOOL(1)
    }
}

/// Attempts to focus/restore the window of the specified application.
/// Falls back to protocol or UWP launch if the window is not currently open.
pub fn open_app_window(app_name: &str, app_id: Option<&str>) -> bool {
    let clean_target = app_name.trim().to_lowercase();
    if clean_target.is_empty() {
        return false;
    }

    let mut search = EnumSearch {
        target: clean_target.clone(),
        found_hwnd: None,
    };

    // SAFETY: Calling EnumWindows with a safe callback and pointer.
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_proc),
            LPARAM(&mut search as *mut EnumSearch as isize),
        );
    }

    if let Some(hwnd) = search.found_hwnd {
        // SAFETY: Window manipulation to bring to foreground.
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            } else {
                let _ = ShowWindow(hwnd, SW_SHOW);
            }

            let fg_hwnd = GetForegroundWindow();
            let fg_thread = GetWindowThreadProcessId(fg_hwnd, None);
            let target_thread = GetWindowThreadProcessId(hwnd, None);
            let current_thread = GetCurrentThreadId();

            let attached_current = AttachThreadInput(current_thread, target_thread, true).as_bool();
            let attached_fg = if fg_thread != 0 && fg_thread != target_thread {
                AttachThreadInput(fg_thread, target_thread, true).as_bool()
            } else {
                false
            };

            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);

            if attached_fg {
                let _ = AttachThreadInput(fg_thread, target_thread, false);
            }
            if attached_current {
                let _ = AttachThreadInput(current_thread, target_thread, false);
            }
        }
        return true;
    }

    // Window not found directly; check for known protocol URLs.
    let protocol = match clean_target.as_str() {
        s if s.contains("whatsapp") => Some("whatsapp:"),
        s if s.contains("discord") => Some("discord:"),
        s if s.contains("telegram") => Some("tg:"),
        s if s.contains("slack") => Some("slack:"),
        s if s.contains("spotify") => Some("spotify:"),
        s if s.contains("teams") => Some("msteams:"),
        s if s.contains("mail") || s.contains("outlook") => Some("mailto:"),
        _ => None,
    };

    if let Some(uri) = protocol
        && std::process::Command::new("cmd")
            .args(["/c", "start", "", uri])
            .spawn()
            .is_ok()
    {
        return true;
    }

    // Try UWP shell:AppsFolder if app_id looks like a package family / app model ID
    if let Some(id) = app_id
        && !id.is_empty()
    {
        let uwp_target = format!("shell:AppsFolder\\{id}");
        if std::process::Command::new("explorer")
            .arg(&uwp_target)
            .spawn()
            .is_ok()
        {
            return true;
        }
    }

    false
}

/// Spawns the notification worker on a dedicated thread with COM MTA and tokio runtime.
pub fn spawn_notification_listener(app: AppHandle, manager: Arc<Mutex<NotificationManager>>) {
    let builder = std::thread::Builder::new().name("notification-listener".into());
    if let Err(err) = builder.spawn(move || {
        // SAFETY: Background worker thread, initialized with MTA.
        unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }

            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(r) => r,
                Err(err) => {
                    tracing::warn!("failed to create notification tokio runtime: {err}");
                    return;
                }
            };

            rt.block_on(async move {
                tracing::info!("Notification listener thread started (COM MTA)");

                // Attempt to query UserNotificationListener
                let listener_res =
                    windows::UI::Notifications::Management::UserNotificationListener::Current();
                let listener = match listener_res {
                    Ok(l) => l,
                    Err(err) => {
                        tracing::info!(
                            "UserNotificationListener::Current() not available ({err}). Running in standby/IPC mode."
                        );
                        return;
                    }
                };

                let access_op = match listener.RequestAccessAsync() {
                    Ok(op) => op,
                    Err(err) => {
                        tracing::info!(
                            "UserNotificationListener RequestAccessAsync error ({err}). Running in standby/IPC mode."
                        );
                        return;
                    }
                };

                let access = match access_op.await {
                    Ok(a) => a,
                    Err(err) => {
                        tracing::info!(
                            "UserNotificationListener access query failed ({err}). Running in standby/IPC mode."
                        );
                        return;
                    }
                };

                if access
                    != windows::UI::Notifications::Management::UserNotificationListenerAccessStatus::Allowed
                {
                    tracing::info!(
                        "UserNotificationListener access status: {:?}. Running in standby/IPC mode.",
                        access
                    );
                    return;
                }

                tracing::info!(
                    "UserNotificationListener access granted: listening for Windows notifications"
                );

                let mut seen_ids: HashSet<u32> = HashSet::new();

                // Initial seed of existing notification IDs so we don't spam old notifications
                if let Ok(initial_op) = listener
                    .GetNotificationsAsync(windows::UI::Notifications::NotificationKinds::Toast)
                    && let Ok(existing) = initial_op.await
                    && let Ok(size) = existing.Size()
                {
                    for i in 0..size {
                        if let Ok(item) = existing.GetAt(i)
                            && let Ok(id) = item.Id()
                        {
                            seen_ids.insert(id);
                        }
                    }
                }

                // Polling loop (every 1 second) for incoming toasts
                loop {
                    tokio::time::sleep(Duration::from_millis(1000)).await;

                    let toasts_op = match listener
                        .GetNotificationsAsync(windows::UI::Notifications::NotificationKinds::Toast)
                    {
                        Ok(op) => op,
                        Err(_) => continue,
                    };

                    let toasts = match toasts_op.await {
                        Ok(t) => t,
                        Err(_) => continue,
                    };

                    let size = match toasts.Size() {
                        Ok(s) => s,
                        Err(_) => continue,
                    };

                    for i in 0..size {
                        let item = match toasts.GetAt(i) {
                            Ok(item) => item,
                            Err(_) => continue,
                        };

                        let id = match item.Id() {
                            Ok(id) => id,
                            Err(_) => continue,
                        };

                        if !seen_ids.insert(id) {
                            continue;
                        }

                        // Extract app display name
                        let app_info = item.AppInfo().ok();
                        let app_name = app_info
                            .as_ref()
                            .and_then(|info| info.DisplayInfo().ok())
                            .and_then(|disp| disp.DisplayName().ok())
                            .map(|h| h.to_string())
                            .unwrap_or_else(|| "Windows".to_string());

                        let app_id = app_info
                            .as_ref()
                            .and_then(|info| info.Id().ok())
                            .map(|h| h.to_string());

                        let (title, body) = extract_toast_text(&item);
                        if title.is_empty() && body.is_empty() {
                            continue;
                        }

                        let new_notif = AppNotification {
                            id: id.to_string(),
                            app_name,
                            app_id,
                            title,
                            body,
                            timestamp: SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64,
                            read: false,
                            icon: None,
                        };

                        let Ok(mut mgr) = manager.lock() else {
                            continue;
                        };
                        let (should_popup, added) = mgr.add(new_notif.clone());

                        if added {
                            let all = mgr.list();
                            drop(mgr);

                            let _ = app.emit("notification://updated", &all);
                            if should_popup {
                                let _ = app.emit("notification://popup", &new_notif);
                            }
                        }
                    }
                }
            });
        })
    {
        tracing::warn!("failed to spawn notification-listener thread: {err}");
    }
}

fn extract_toast_text(item: &windows::UI::Notifications::UserNotification) -> (String, String) {
    let Ok(notif) = item.Notification() else {
        return (String::new(), String::new());
    };
    let Ok(visual) = notif.Visual() else {
        return (String::new(), String::new());
    };
    let Ok(binding) = visual.GetBinding(
        &windows::UI::Notifications::KnownNotificationBindings::ToastGeneric().unwrap_or_default(),
    ) else {
        return (String::new(), String::new());
    };
    let Ok(elements) = binding.GetTextElements() else {
        return (String::new(), String::new());
    };
    let Ok(el_size) = elements.Size() else {
        return (String::new(), String::new());
    };

    let title = if el_size > 0 {
        elements
            .GetAt(0)
            .ok()
            .and_then(|el| el.Text().ok())
            .map(|t| t.to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    let body = if el_size > 1 {
        elements
            .GetAt(1)
            .ok()
            .and_then(|el| el.Text().ok())
            .map(|b| b.to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    (title, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_and_lists_notifications() {
        let mut mgr = NotificationManager::new(NotificationSettings::default());
        let notif = AppNotification {
            id: "1".into(),
            app_name: "WhatsApp".into(),
            app_id: None,
            title: "Test".into(),
            body: "Body".into(),
            timestamp: 1000,
            read: false,
            icon: None,
        };

        let (should_popup, added) = mgr.add(notif);
        assert!(added);
        assert!(should_popup);
        assert_eq!(mgr.list().len(), 1);
    }

    #[test]
    fn respects_dnd_filter_and_whitelist() {
        let settings = NotificationSettings {
            dnd_enabled: true,
            allowed_apps: vec!["WhatsApp".into()],
            ..Default::default()
        };

        let mut mgr = NotificationManager::new(settings);

        // Not allowed app -> no popup, but still recorded
        let (popup_slack, added_slack) = mgr.add(AppNotification {
            id: "slack-1".into(),
            app_name: "Slack".into(),
            app_id: None,
            title: "Channel".into(),
            body: "Msg".into(),
            timestamp: 1000,
            read: false,
            icon: None,
        });
        assert!(added_slack);
        assert!(!popup_slack);

        // Whitelisted app -> produces popup under DND
        let (popup_wa, added_wa) = mgr.add(AppNotification {
            id: "wa-1".into(),
            app_name: "WhatsApp Desktop".into(),
            app_id: None,
            title: "Friend".into(),
            body: "Hey".into(),
            timestamp: 2000,
            read: false,
            icon: None,
        });
        assert!(added_wa);
        assert!(popup_wa);
    }

    #[test]
    fn dismisses_and_clears() {
        let mut mgr = NotificationManager::new(NotificationSettings::default());
        mgr.add(AppNotification {
            id: "n1".into(),
            app_name: "App".into(),
            app_id: None,
            title: "T".into(),
            body: "B".into(),
            timestamp: 1000,
            read: false,
            icon: None,
        });

        assert_eq!(mgr.list().len(), 1);
        assert!(mgr.dismiss("n1"));
        assert_eq!(mgr.list().len(), 0);

        mgr.add(AppNotification {
            id: "n2".into(),
            app_name: "App".into(),
            app_id: None,
            title: "T".into(),
            body: "B".into(),
            timestamp: 2000,
            read: false,
            icon: None,
        });
        mgr.clear_all();
        assert_eq!(mgr.list().len(), 0);
    }
}
