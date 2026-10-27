//! In-memory JPEG encoding for captured frames. Nothing here touches disk.

use image::{
    ExtendedColorType, RgbImage,
    codecs::jpeg::JpegEncoder,
    imageops::{self, FilterType},
};

use super::{CaptureError, Frame};

/// Longest side sent to vision models. Anthropic recommends <= 1568 px, and
/// the other providers downscale larger images themselves anyway.
pub const MAX_SIDE: u32 = 1568;
pub const JPEG_QUALITY: u8 = 85;

/// A JPEG ready for upload.
pub struct EncodedImage {
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

impl std::fmt::Debug for EncodedImage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EncodedImage")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("bytes", &self.jpeg.len())
            .finish()
    }
}

/// Size that fits inside `MAX_SIDE` while keeping the aspect ratio.
pub fn target_size(width: u32, height: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= MAX_SIDE {
        return (width.max(1), height.max(1));
    }
    let scale = f64::from(MAX_SIDE) / f64::from(longest);
    let scaled = |side: u32| ((f64::from(side) * scale).round() as u32).clamp(1, MAX_SIDE);
    (scaled(width), scaled(height))
}

pub fn to_jpeg(frame: &Frame) -> Result<EncodedImage, CaptureError> {
    let expected = frame.width as usize * frame.height as usize * 4;
    if frame.width == 0 || frame.height == 0 || frame.bgra.len() != expected {
        return Err(CaptureError::Encode("frame has an invalid size".into()));
    }

    let mut rgb = Vec::with_capacity(expected / 4 * 3);
    for px in frame.bgra.chunks_exact(4) {
        rgb.extend_from_slice(&[px[2], px[1], px[0]]);
    }
    let image = RgbImage::from_raw(frame.width, frame.height, rgb)
        .ok_or_else(|| CaptureError::Encode("buffer does not match frame size".into()))?;

    let (width, height) = target_size(frame.width, frame.height);
    let image = if (width, height) == (frame.width, frame.height) {
        image
    } else {
        imageops::resize(&image, width, height, FilterType::Triangle)
    };

    let mut jpeg = Vec::with_capacity(width as usize * height as usize / 4);
    JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .encode(image.as_raw(), width, height, ExtendedColorType::Rgb8)
        .map_err(|err| CaptureError::Encode(err.to_string()))?;

    Ok(EncodedImage {
        jpeg,
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, bgra: [u8; 4]) -> Frame {
        Frame {
            width,
            height,
            bgra: bgra.repeat((width * height) as usize),
        }
    }

    #[test]
    fn small_frames_keep_their_size() {
        assert_eq!(target_size(1280, 720), (1280, 720));
        assert_eq!(target_size(1568, 400), (1568, 400));
    }

    #[test]
    fn large_frames_fit_the_longest_side() {
        assert_eq!(target_size(3840, 2160), (1568, 882));
        assert_eq!(target_size(2160, 3840), (882, 1568));
        assert_eq!(target_size(10_000, 1), (1568, 1));
    }

    #[test]
    fn encodes_a_valid_jpeg_with_bgr_order_fixed() {
        // Pure blue in BGRA must come out blue, not red.
        let encoded = to_jpeg(&solid(64, 32, [255, 0, 0, 255])).unwrap();
        assert_eq!((encoded.width, encoded.height), (64, 32));
        assert_eq!(&encoded.jpeg[..2], &[0xFF, 0xD8], "JPEG SOI marker");

        let decoded = image::load_from_memory(&encoded.jpeg).unwrap().to_rgb8();
        let px = decoded.get_pixel(10, 10);
        assert!(px[2] > 200 && px[0] < 60, "expected blue, got {px:?}");
    }

    #[test]
    fn downscales_large_frames() {
        let encoded = to_jpeg(&solid(3200, 1800, [40, 40, 40, 255])).unwrap();
        assert_eq!((encoded.width, encoded.height), (1568, 882));
    }

    #[test]
    fn rejects_mismatched_buffers() {
        let frame = Frame {
            width: 10,
            height: 10,
            bgra: vec![0; 12],
        };
        assert!(to_jpeg(&frame).is_err());
    }
}
