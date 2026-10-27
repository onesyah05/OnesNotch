//! DXGI Desktop Duplication: one frame from one output, copied to a CPU buffer.
//!
//! A duplication is created per capture. That costs a few tens of milliseconds
//! but keeps no GPU objects alive between hotkey presses. Auto-detect (Phase 3)
//! can cache it if the budget gets tight.

use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ,
    D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_MODE_ROTATION_IDENTITY, DXGI_MODE_ROTATION_UNSPECIFIED,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, DXGI_ERROR_NOT_FOUND, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
    IDXGIAdapter1, IDXGIFactory1, IDXGIOutput, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
};
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::core::Interface;

use super::{CaptureError, Frame};

const FIRST_FRAME_TIMEOUT_MS: u32 = 500;
const RETRY_FRAME_TIMEOUT_MS: u32 = 60;

fn dxgi_err(context: &str, err: windows::core::Error) -> CaptureError {
    CaptureError::Dxgi(format!("{context}: {err}"))
}

pub(super) fn capture_monitor(monitor: HMONITOR) -> Result<Frame, CaptureError> {
    let (adapter, output) = find_output(monitor)?;
    let (device, context) = create_device(&adapter)?;

    let output1: IDXGIOutput1 = output
        .cast()
        .map_err(|err| dxgi_err("IDXGIOutput1 unavailable", err))?;
    // SAFETY: `device` is a live D3D11 device created on the adapter that owns `output1`.
    let duplication = unsafe { output1.DuplicateOutput(&device) }
        .map_err(|err| dxgi_err("DuplicateOutput", err))?;

    // SAFETY: plain getter on a live duplication object.
    let desc = unsafe { duplication.GetDesc() };
    // The duplicated surface is in the panel's native orientation. GDI already
    // returns rotated desktops correctly, so let the caller fall back to it.
    let rotation = desc.Rotation;
    if rotation != DXGI_MODE_ROTATION_IDENTITY && rotation != DXGI_MODE_ROTATION_UNSPECIFIED {
        return Err(CaptureError::Dxgi("rotated output".into()));
    }

    let mut frame = acquire(&duplication, &device, &context, FIRST_FRAME_TIMEOUT_MS)?
        .ok_or_else(|| CaptureError::Dxgi("no frame within timeout".into()))?;

    // The very first frame after `DuplicateOutput` can be empty on some drivers.
    // One short retry usually gets a composed frame.
    if frame.1 == 0
        && let Ok(Some(next)) = acquire(&duplication, &device, &context, RETRY_FRAME_TIMEOUT_MS)
    {
        frame = next;
    }

    let frame = frame.0;
    if frame.bgra.iter().all(|&byte| byte == 0) {
        return Err(CaptureError::Dxgi("frame is empty".into()));
    }
    Ok(frame)
}

fn find_output(monitor: HMONITOR) -> Result<(IDXGIAdapter1, IDXGIOutput), CaptureError> {
    // SAFETY: creates a new factory; no preconditions.
    let factory: IDXGIFactory1 =
        unsafe { CreateDXGIFactory1() }.map_err(|err| dxgi_err("CreateDXGIFactory1", err))?;

    for adapter_index in 0.. {
        // SAFETY: enumeration on a live factory; NOT_FOUND ends the list.
        let adapter = match unsafe { factory.EnumAdapters1(adapter_index) } {
            Ok(adapter) => adapter,
            Err(err) if err.code() == DXGI_ERROR_NOT_FOUND => break,
            Err(err) => return Err(dxgi_err("EnumAdapters1", err)),
        };
        for output_index in 0.. {
            // SAFETY: enumeration on a live adapter; NOT_FOUND ends the list.
            let output = match unsafe { adapter.EnumOutputs(output_index) } {
                Ok(output) => output,
                Err(err) if err.code() == DXGI_ERROR_NOT_FOUND => break,
                Err(err) => return Err(dxgi_err("EnumOutputs", err)),
            };
            // SAFETY: plain getter on a live output.
            let desc = unsafe { output.GetDesc() }.map_err(|err| dxgi_err("GetDesc", err))?;
            if desc.Monitor == monitor {
                return Ok((adapter, output));
            }
        }
    }
    Err(CaptureError::Dxgi("no DXGI output for this monitor".into()))
}

fn create_device(
    adapter: &IDXGIAdapter1,
) -> Result<(ID3D11Device, ID3D11DeviceContext), CaptureError> {
    let mut device = None;
    let mut context = None;
    // SAFETY: an explicit adapter requires D3D_DRIVER_TYPE_UNKNOWN and no software
    // module; the out-pointers live on this stack frame for the whole call.
    unsafe {
        D3D11CreateDevice(
            adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
    }
    .map_err(|err| dxgi_err("D3D11CreateDevice", err))?;

    match (device, context) {
        (Some(device), Some(context)) => Ok((device, context)),
        _ => Err(CaptureError::Dxgi(
            "D3D11CreateDevice returned no device".into(),
        )),
    }
}

/// Acquires one frame and copies it to the CPU. Returns the frame plus its
/// `LastPresentTime` (0 means the OS reported no new desktop image), or `None`
/// on timeout.
fn acquire(
    duplication: &IDXGIOutputDuplication,
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    timeout_ms: u32,
) -> Result<Option<(Frame, i64)>, CaptureError> {
    let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
    let mut resource: Option<IDXGIResource> = None;
    // SAFETY: both out-pointers are valid for the duration of the call.
    match unsafe { duplication.AcquireNextFrame(timeout_ms, &mut info, &mut resource) } {
        Ok(()) => {}
        Err(err) if err.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(None),
        Err(err) => return Err(dxgi_err("AcquireNextFrame", err)),
    }

    let copied = resource
        .ok_or_else(|| CaptureError::Dxgi("frame has no resource".into()))
        .and_then(|resource| copy_to_cpu(&resource, device, context));

    // The frame must be released even when the copy failed, or the next
    // duplication on this output stalls.
    // SAFETY: a frame was acquired above and has not been released yet.
    if let Err(err) = unsafe { duplication.ReleaseFrame() } {
        tracing::debug!("ReleaseFrame failed: {err}");
    }

    copied.map(|frame| Some((frame, info.LastPresentTime)))
}

fn copy_to_cpu(
    resource: &IDXGIResource,
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
) -> Result<Frame, CaptureError> {
    let texture: ID3D11Texture2D = resource
        .cast()
        .map_err(|err| dxgi_err("frame is not a texture", err))?;
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    // SAFETY: `desc` is a valid out-pointer.
    unsafe { texture.GetDesc(&mut desc) };
    if desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM {
        return Err(CaptureError::Dxgi(format!(
            "unsupported format {:?}",
            desc.Format
        )));
    }

    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: desc.Width,
        Height: desc.Height,
        MipLevels: 1,
        ArraySize: 1,
        Format: desc.Format,
        SampleDesc: desc.SampleDesc,
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut staging: Option<ID3D11Texture2D> = None;
    // SAFETY: `staging_desc` describes a CPU-readable copy of a valid texture.
    unsafe { device.CreateTexture2D(&staging_desc, None, Some(&mut staging)) }
        .map_err(|err| dxgi_err("CreateTexture2D", err))?;
    let staging = staging.ok_or_else(|| CaptureError::Dxgi("no staging texture".into()))?;

    // SAFETY: both textures share size and format, as required by CopyResource.
    unsafe { context.CopyResource(&staging, &texture) };

    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    // SAFETY: `staging` was created with CPU read access; `mapped` is a valid out-pointer.
    unsafe { context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }
        .map_err(|err| dxgi_err("Map", err))?;

    let width = desc.Width as usize;
    let height = desc.Height as usize;
    let row_bytes = width * 4;
    let pitch = mapped.RowPitch as usize;
    let mut bgra = Vec::with_capacity(row_bytes * height);
    if !mapped.pData.is_null() && pitch >= row_bytes {
        let base = mapped.pData.cast::<u8>();
        for y in 0..height {
            // SAFETY: while mapped, row `y` starts at `pData + y * RowPitch` and
            // holds at least `row_bytes` (= Width * 4) bytes of BGRA pixels.
            let row = unsafe { std::slice::from_raw_parts(base.add(y * pitch), row_bytes) };
            bgra.extend_from_slice(row);
        }
    }
    // SAFETY: the subresource was mapped above and the slice is no longer used.
    unsafe { context.Unmap(&staging, 0) };

    if bgra.len() != row_bytes * height {
        return Err(CaptureError::Dxgi("mapped texture is unreadable".into()));
    }
    Ok(Frame {
        width: desc.Width,
        height: desc.Height,
        bgra,
    })
}
