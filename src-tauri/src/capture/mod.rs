//! Silent screen capture. Never use Windows.Graphics.Capture (yellow border),
//! and never write frames to disk (AGENTS.md rules 3–4).
//!
//! [`grab`] picks the monitor (and, in window mode, the crop rect) from the
//! foreground window, tries DXGI Desktop Duplication first and falls back to
//! GDI `BitBlt`. Windows with `WDA_EXCLUDEFROMCAPTURE` (ours) are left out by
//! the OS in both paths.

#[cfg(windows)]
mod dxgi;
pub(crate) mod encode;
#[cfg(windows)]
mod foreground;
#[cfg(windows)]
mod gdi;

use serde::{Deserialize, Serialize};

/// What to capture. Mirrored in `src/lib/ipc.ts`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureTarget {
    /// The whole monitor that holds the foreground window.
    #[default]
    Screen,
    /// Only the foreground window (cropped from its monitor).
    Window,
}

impl CaptureTarget {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Screen => "screen",
            Self::Window => "window",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("no monitor found")]
    NoMonitor,
    #[error("DXGI duplication failed: {0}")]
    Dxgi(String),
    #[error("GDI capture failed: {0}")]
    Gdi(String),
    #[error("image encoding failed: {0}")]
    Encode(String),
    #[error("screen capture is only supported on Windows")]
    #[cfg_attr(
        windows,
        allow(dead_code, reason = "only built on non-Windows targets")
    )]
    Unsupported,
}

/// Desktop rectangle in physical pixels (right/bottom exclusive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub const fn width(self) -> i32 {
        self.right - self.left
    }

    pub const fn height(self) -> i32 {
        self.bottom - self.top
    }

    pub const fn is_empty(self) -> bool {
        self.width() <= 0 || self.height() <= 0
    }

    pub fn intersect(self, other: Self) -> Option<Self> {
        let rect = Self {
            left: self.left.max(other.left),
            top: self.top.max(other.top),
            right: self.right.min(other.right),
            bottom: self.bottom.min(other.bottom),
        };
        (!rect.is_empty()).then_some(rect)
    }
}

/// A captured frame: tightly packed BGRA rows, top-down.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

// Hand-written so a stray `{:?}` can never dump screen pixels into a log (rule 4).
impl std::fmt::Debug for Frame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Frame")
            .field("width", &self.width)
            .field("height", &self.height)
            .finish_non_exhaustive()
    }
}

impl Frame {
    /// Crops to `rect`, given in the frame's own pixel coordinates.
    /// Returns `None` when the rect does not overlap the frame.
    pub fn crop(&self, rect: Rect) -> Option<Self> {
        let bounds = Rect {
            left: 0,
            top: 0,
            right: self.width as i32,
            bottom: self.height as i32,
        };
        let rect = rect.intersect(bounds)?;
        if rect == bounds {
            return Some(Self {
                width: self.width,
                height: self.height,
                bgra: self.bgra.clone(),
            });
        }

        let width = rect.width() as usize;
        let stride = self.width as usize * 4;
        let mut bgra = Vec::with_capacity(width * rect.height() as usize * 4);
        for y in rect.top as usize..rect.bottom as usize {
            let start = y * stride + rect.left as usize * 4;
            bgra.extend_from_slice(&self.bgra[start..start + width * 4]);
        }
        Some(Self {
            width: width as u32,
            height: rect.height() as u32,
            bgra,
        })
    }
}

/// Captures the monitor (or window) the user is looking at.
#[cfg(windows)]
pub fn grab(target: CaptureTarget) -> Result<Frame, CaptureError> {
    let plan = foreground::resolve(target)?;
    let frame = match dxgi::capture_monitor(plan.monitor) {
        Ok(frame) => frame,
        Err(err) => {
            tracing::warn!("{err}; falling back to GDI");
            gdi::capture_rect(plan.monitor_rect)?
        }
    };

    let Some(crop) = plan.crop else {
        return Ok(frame);
    };
    // The crop rect is in desktop coordinates; shift it into the frame.
    let local = Rect {
        left: crop.left - plan.monitor_rect.left,
        top: crop.top - plan.monitor_rect.top,
        right: crop.right - plan.monitor_rect.left,
        bottom: crop.bottom - plan.monitor_rect.top,
    };
    Ok(frame.crop(local).unwrap_or(frame))
}

#[cfg(not(windows))]
pub fn grab(_target: CaptureTarget) -> Result<Frame, CaptureError> {
    Err(CaptureError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn numbered_frame(width: u32, height: u32) -> Frame {
        // Each pixel stores its index in the blue channel so crops are easy to check.
        let bgra = (0..width * height)
            .flat_map(|i| [i as u8, 0, 0, 255])
            .collect();
        Frame {
            width,
            height,
            bgra,
        }
    }

    #[test]
    fn intersect_clips_and_rejects_disjoint_rects() {
        let a = Rect {
            left: 0,
            top: 0,
            right: 10,
            bottom: 10,
        };
        let b = Rect {
            left: 5,
            top: -5,
            right: 20,
            bottom: 5,
        };
        assert_eq!(
            a.intersect(b),
            Some(Rect {
                left: 5,
                top: 0,
                right: 10,
                bottom: 5
            })
        );
        let far = Rect {
            left: 50,
            top: 50,
            right: 60,
            bottom: 60,
        };
        assert_eq!(a.intersect(far), None);
    }

    #[test]
    fn crop_copies_the_right_pixels() {
        let frame = numbered_frame(4, 3);
        let cropped = frame
            .crop(Rect {
                left: 1,
                top: 1,
                right: 3,
                bottom: 3,
            })
            .unwrap();
        assert_eq!((cropped.width, cropped.height), (2, 2));
        let blues: Vec<u8> = cropped.bgra.chunks(4).map(|px| px[0]).collect();
        assert_eq!(blues, vec![5, 6, 9, 10]);
    }

    #[test]
    fn crop_clamps_to_the_frame() {
        let frame = numbered_frame(4, 4);
        let cropped = frame
            .crop(Rect {
                left: -10,
                top: 2,
                right: 2,
                bottom: 99,
            })
            .unwrap();
        assert_eq!((cropped.width, cropped.height), (2, 2));
        assert!(
            frame
                .crop(Rect {
                    left: 10,
                    top: 10,
                    right: 12,
                    bottom: 12
                })
                .is_none()
        );
    }

    /// Manual check of the PRD §7 budget (capture + encode < 150 ms):
    /// `cargo test --release capture_budget -- --ignored --nocapture`
    #[cfg(windows)]
    #[test]
    #[ignore = "captures the real screen; run manually"]
    fn capture_budget() {
        for target in [CaptureTarget::Screen, CaptureTarget::Window] {
            let started = std::time::Instant::now();
            let frame = grab(target).unwrap();
            let grabbed = started.elapsed();
            let image = encode::to_jpeg(&frame).unwrap();
            println!(
                "{target:?}: {}x{} grab {grabbed:?}, total {:?}, jpeg {} KB",
                image.width,
                image.height,
                started.elapsed(),
                image.jpeg.len() / 1024
            );
        }
    }

    #[test]
    fn debug_never_prints_pixels() {
        let text = format!("{:?}", numbered_frame(2, 2));
        assert!(text.contains("width: 2"));
        assert!(!text.contains("bgra"));
    }
}
