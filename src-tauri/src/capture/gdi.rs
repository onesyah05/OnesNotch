//! GDI `BitBlt` fallback for when DXGI duplication is unavailable
//! (remote sessions, some hybrid-GPU drivers, rotated outputs).
//!
//! `CAPTUREBLT` is deliberately not used: it makes layered windows and the
//! cursor flicker, which would give the capture away (AGENTS.md rule 3).

use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC,
    DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HBITMAP, HDC, HGDIOBJ, ReleaseDC,
    SRCCOPY, SelectObject,
};

use super::{CaptureError, Frame, Rect};

struct ScreenDc(HDC);

impl Drop for ScreenDc {
    fn drop(&mut self) {
        // SAFETY: the DC came from `GetDC(None)` and is released exactly once.
        unsafe { ReleaseDC(None, self.0) };
    }
}

struct MemoryDc(HDC);

impl Drop for MemoryDc {
    fn drop(&mut self) {
        // SAFETY: the DC came from `CreateCompatibleDC` and is deleted exactly once.
        let _ = unsafe { DeleteDC(self.0) };
    }
}

struct Bitmap(HBITMAP);

impl Drop for Bitmap {
    fn drop(&mut self) {
        // SAFETY: the bitmap is not selected into any DC by the time it drops.
        let _ = unsafe { DeleteObject(HGDIOBJ(self.0.0)) };
    }
}

pub(super) fn capture_rect(rect: Rect) -> Result<Frame, CaptureError> {
    if rect.is_empty() {
        return Err(CaptureError::Gdi("empty capture rect".into()));
    }
    let (width, height) = (rect.width(), rect.height());

    // SAFETY: `None` requests the DC for the whole virtual screen.
    let screen = ScreenDc(unsafe { GetDC(None) });
    if screen.0.is_invalid() {
        return Err(CaptureError::Gdi("GetDC failed".into()));
    }
    // SAFETY: `screen.0` is a valid DC.
    let memory = MemoryDc(unsafe { CreateCompatibleDC(Some(screen.0)) });
    if memory.0.is_invalid() {
        return Err(CaptureError::Gdi("CreateCompatibleDC failed".into()));
    }
    // SAFETY: `screen.0` is a valid DC and both dimensions are positive.
    let bitmap = Bitmap(unsafe { CreateCompatibleBitmap(screen.0, width, height) });
    if bitmap.0.is_invalid() {
        return Err(CaptureError::Gdi("CreateCompatibleBitmap failed".into()));
    }

    // SAFETY: both handles are valid; the previous object is restored below.
    let previous = unsafe { SelectObject(memory.0, HGDIOBJ(bitmap.0.0)) };
    // SAFETY: both DCs are valid and the destination bitmap is `width x height`.
    let blit = unsafe {
        BitBlt(
            memory.0,
            0,
            0,
            width,
            height,
            Some(screen.0),
            rect.left,
            rect.top,
            SRCCOPY,
        )
    };
    // GetDIBits requires the bitmap to be deselected first.
    // SAFETY: restores the object that was selected before.
    unsafe { SelectObject(memory.0, previous) };
    blit.map_err(|err| CaptureError::Gdi(format!("BitBlt: {err}")))?;

    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            // Negative height asks for top-down rows.
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bgra = vec![0u8; width as usize * height as usize * 4];
    // SAFETY: `bgra` holds exactly `height` rows of 32-bit pixels as described by `info`.
    let lines = unsafe {
        GetDIBits(
            screen.0,
            bitmap.0,
            0,
            height as u32,
            Some(bgra.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    if lines != height {
        return Err(CaptureError::Gdi(format!(
            "GetDIBits copied {lines} of {height} rows"
        )));
    }

    // 32-bit DIBs leave alpha undefined.
    for px in bgra.chunks_exact_mut(4) {
        px[3] = 255;
    }
    Ok(Frame {
        width: width as u32,
        height: height as u32,
        bgra,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_a_small_region_of_the_desktop() {
        let frame = match capture_rect(Rect {
            left: 0,
            top: 0,
            right: 32,
            bottom: 16,
        }) {
            Ok(frame) => frame,
            Err(CaptureError::Gdi(msg)) if msg.contains("0x80070006") => {
                // Non-interactive or headless session without an active desktop station.
                return;
            }
            Err(other) => panic!("unexpected capture error: {other:?}"),
        };
        assert_eq!((frame.width, frame.height), (32, 16));
        assert_eq!(frame.bgra.len(), 32 * 16 * 4);
    }
}
