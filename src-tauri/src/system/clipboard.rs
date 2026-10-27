//! Clipboard writes and history monitoring.
//!
//! Copied answers are tagged so Windows leaves them out of clipboard history
//! (Win+V) and cloud clipboard sync; pasting still works normally.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

pub const MAX_TEXT_LEN: usize = 1_000_000;
pub const MAX_HISTORY_LEN: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: String,
    pub text: String,
    pub timestamp: u64,
}

pub struct ClipboardManager {
    items: Mutex<Vec<ClipboardItem>>,
    last_seq: AtomicU32,
    counter: AtomicU64,
}

impl Default for ClipboardManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ClipboardManager {
    pub fn new() -> Self {
        Self {
            items: Mutex::new(Vec::new()),
            last_seq: AtomicU32::new(0),
            counter: AtomicU64::new(1),
        }
    }

    pub fn get_history(&self) -> Vec<ClipboardItem> {
        self.items.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn add_item(&self, text: String) -> Option<ClipboardItem> {
        if text.trim().is_empty() {
            return None;
        }
        let mut guard = self.items.lock().ok()?;
        if let Some(first) = guard.first()
            && first.text == text
        {
            return None;
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let cnt = self.counter.fetch_add(1, Ordering::Relaxed);
        let item = ClipboardItem {
            id: format!("clip_{now}_{cnt}"),
            text,
            timestamp: now,
        };
        guard.insert(0, item.clone());
        if guard.len() > MAX_HISTORY_LEN {
            guard.truncate(MAX_HISTORY_LEN);
        }
        Some(item)
    }

    pub fn delete_item(&self, id: &str) -> bool {
        if let Ok(mut guard) = self.items.lock() {
            let before = guard.len();
            guard.retain(|i| i.id != id);
            guard.len() < before
        } else {
            false
        }
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.items.lock() {
            guard.clear();
        }
    }
}

pub fn read_text() -> AppResult<Option<String>> {
    #[cfg(windows)]
    {
        platform::read_text()
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

pub fn write_text(text: &str) -> AppResult<()> {
    if text.len() > MAX_TEXT_LEN {
        return Err(AppError::InvalidInput("text is too long to copy".into()));
    }
    #[cfg(windows)]
    {
        platform::write_text(text)
    }
    #[cfg(not(windows))]
    {
        Err(AppError::Internal(
            "clipboard is only supported on Windows".into(),
        ))
    }
}

#[cfg(windows)]
pub fn sequence_number() -> u32 {
    platform::sequence_number()
}

#[cfg(not(windows))]
pub fn sequence_number() -> u32 {
    0
}

pub fn spawn_clipboard_listener(app: AppHandle, manager: Arc<ClipboardManager>) {
    tauri::async_runtime::spawn(async move {
        // Initial check
        if let Ok(Some(initial)) = read_text() {
            manager.add_item(initial);
        }
        manager.last_seq.store(sequence_number(), Ordering::SeqCst);

        let mut interval = tokio::time::interval(Duration::from_millis(500));
        loop {
            interval.tick().await;

            let current_seq = sequence_number();
            let last = manager.last_seq.load(Ordering::SeqCst);
            if current_seq != 0 && current_seq != last {
                manager.last_seq.store(current_seq, Ordering::SeqCst);
                if let Ok(Some(text)) = read_text()
                    && let Some(item) = manager.add_item(text)
                {
                    let _ = app.emit("clipboard://changed", &item);
                }
            }
        }
    });
}

#[cfg(windows)]
mod platform {
    use std::time::Duration;

    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber,
        OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock};
    use windows::Win32::System::Ole::CF_UNICODETEXT;
    use windows::core::w;

    use super::MAX_TEXT_LEN;
    use crate::error::{AppError, AppResult};

    const OPEN_ATTEMPTS: u32 = 5;

    struct OpenGuard;

    impl Drop for OpenGuard {
        fn drop(&mut self) {
            // SAFETY: only constructed after OpenClipboard succeeded on this thread.
            let _ = unsafe { CloseClipboard() };
        }
    }

    fn clipboard_error(context: &str, err: impl std::fmt::Display) -> AppError {
        AppError::Internal(format!("clipboard {context}: {err}"))
    }

    fn open() -> AppResult<OpenGuard> {
        let mut last = None;
        for _ in 0..OPEN_ATTEMPTS {
            // SAFETY: `None` associates the clipboard with this thread's task.
            match unsafe { OpenClipboard(None) } {
                Ok(()) => return Ok(OpenGuard),
                // Another app is holding it; it usually lets go within milliseconds.
                Err(err) => last = Some(err),
            }
            std::thread::sleep(Duration::from_millis(15));
        }
        Err(clipboard_error(
            "is busy",
            last.map(|err| err.to_string()).unwrap_or_default(),
        ))
    }

    pub(super) fn sequence_number() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    pub(super) fn read_text() -> AppResult<Option<String>> {
        let _guard = open()?;
        let handle = match unsafe { GetClipboardData(u32::from(CF_UNICODETEXT.0)) } {
            Ok(h) => h,
            Err(_) => return Ok(None),
        };
        if handle.is_invalid() {
            return Ok(None);
        }
        let ptr = unsafe { GlobalLock(HGLOBAL(handle.0)) };
        if ptr.is_null() {
            return Ok(None);
        }
        let wide_slice = unsafe {
            let mut len = 0;
            let p = ptr.cast::<u16>();
            while *p.add(len) != 0 && len < MAX_TEXT_LEN {
                len += 1;
            }
            std::slice::from_raw_parts(p, len)
        };
        let text = String::from_utf16_lossy(wide_slice);
        let _ = unsafe { GlobalUnlock(HGLOBAL(handle.0)) };
        Ok(Some(text))
    }

    /// Copies `bytes` into a movable global block that the clipboard can own.
    fn global_copy(bytes: &[u8]) -> AppResult<HGLOBAL> {
        // SAFETY: allocation with documented flags; freed below or owned by the clipboard.
        let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }
            .map_err(|err| clipboard_error("alloc", err))?;
        // SAFETY: `handle` is a live movable block of `bytes.len()` bytes.
        let target = unsafe { GlobalLock(handle) };
        if target.is_null() {
            // SAFETY: the block is still ours.
            let _ = unsafe { GlobalFree(Some(handle)) };
            return Err(clipboard_error("lock", "GlobalLock failed"));
        }
        // SAFETY: `target` points to at least `bytes.len()` writable bytes.
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), target.cast(), bytes.len()) };
        // SAFETY: balances the GlobalLock above. A "not locked" result is expected.
        let _ = unsafe { GlobalUnlock(handle) };
        Ok(handle)
    }

    fn set(format: u32, bytes: &[u8]) -> AppResult<()> {
        let handle = global_copy(bytes)?;
        // SAFETY: the clipboard is open and `handle` is a movable global block.
        if let Err(err) = unsafe { SetClipboardData(format, Some(HANDLE(handle.0))) } {
            // Ownership only transfers on success.
            // SAFETY: the block is still ours.
            let _ = unsafe { GlobalFree(Some(handle)) };
            return Err(clipboard_error("write", err));
        }
        Ok(())
    }

    pub(super) fn write_text(text: &str) -> AppResult<()> {
        let utf16: Vec<u8> = text
            .encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(u16::to_le_bytes)
            .collect();

        let _guard = open()?;
        // SAFETY: the clipboard is open on this thread.
        unsafe { EmptyClipboard() }.map_err(|err| clipboard_error("clear", err))?;
        set(u32::from(CF_UNICODETEXT.0), &utf16)?;

        // Documented opt-outs; a DWORD of 0 means "do not include".
        for name in [
            w!("CanIncludeInClipboardHistory"),
            w!("CanUploadToCloudClipboard"),
        ] {
            // SAFETY: `name` is a static, NUL-terminated UTF-16 string.
            let format = unsafe { RegisterClipboardFormatW(name) };
            if format != 0
                && let Err(err) = set(format, &0u32.to_le_bytes())
            {
                tracing::debug!("clipboard history opt-out not set: {err}");
            }
        }
        Ok(())
    }
}
