//! System info and utilities.
//! `clipboard.rs` handles copy buttons; Phase 6 adds `battery.rs`
//! (GetSystemPowerStatus, sysinfo) and the clipboard-history listener.

pub(crate) mod autostart;
pub(crate) mod clipboard;
pub(crate) mod ports;
pub(crate) mod runner;
pub(crate) mod stats;
pub(crate) mod updater;

/// Windows build number (e.g. 26100). `WDA_EXCLUDEFROMCAPTURE` needs >= 19041.
#[cfg(windows)]
pub fn os_build() -> Option<u32> {
    use windows::Win32::System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW};
    use windows::core::w;

    let mut buf = [0u16; 16];
    let mut size = std::mem::size_of_val(&buf) as u32;
    // SAFETY: `buf` and `size` outlive the call and `size` is the buffer length in bytes.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"),
            w!("CurrentBuildNumber"),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status.is_err() {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len]).parse().ok()
}

#[cfg(not(windows))]
pub fn os_build() -> Option<u32> {
    None
}

/// `WDA_EXCLUDEFROMCAPTURE` was added in Windows 10 2004 (build 19041).
pub fn supports_capture_exclusion() -> bool {
    os_build().is_some_and(|build| build >= 19_041)
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn reads_a_plausible_build_number() {
        let build = super::os_build().unwrap();
        assert!(build >= 10_240, "unexpected build {build}");
    }
}
