import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { motion, AnimatePresence } from "motion/react";
import {
  Camera,
  CameraOff,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Monitor,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc } from "../../lib/ipc";

export interface ScanItem {
  id: string;
  text: string;
  format: string;
  timestamp: number;
  isUrl: boolean;
}

const STORAGE_SCAN_HISTORY = "notch_scanner_history";
const STORAGE_SCAN_AUTO_OPEN = "notch_scanner_auto_open";

function playBeep() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(987.77, ctx.currentTime); // B5 note
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch {
    // AudioContext might be unavailable or restricted by browser policy
  }
}

function checkIsUrl(raw: string): boolean {
  const str = raw.trim();
  if (/^https?:\/\//i.test(str)) return true;
  if (/^www\.[a-z0-9-]+\.[a-z]{2,}/i.test(str)) return true;
  // Domain with valid TLD check
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+([\/?#].*)?$/i.test(str);
}

function formatBarcodeName(fmt: BarcodeFormat | number): string {
  const map: Record<number, string> = {
    [BarcodeFormat.QR_CODE]: "QR Code",
    [BarcodeFormat.MICRO_QR_CODE]: "Micro QR",
    [BarcodeFormat.EAN_13]: "EAN-13",
    [BarcodeFormat.EAN_8]: "EAN-8",
    [BarcodeFormat.UPC_A]: "UPC-A",
    [BarcodeFormat.UPC_E]: "UPC-E",
    [BarcodeFormat.CODE_128]: "Code 128",
    [BarcodeFormat.CODE_39]: "Code 39",
    [BarcodeFormat.CODE_93]: "Code 93",
    [BarcodeFormat.CODABAR]: "Codabar",
    [BarcodeFormat.DATA_MATRIX]: "Data Matrix",
    [BarcodeFormat.AZTEC]: "Aztec",
    [BarcodeFormat.ITF]: "ITF",
    [BarcodeFormat.PDF_417]: "PDF 417",
  };
  return map[fmt] || "Barcode";
}

function getStoredHistory(): ScanItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_SCAN_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getStoredAutoOpen(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_SCAN_AUTO_OPEN);
    return val === null ? true : val === "true";
  } catch {
    return true;
  }
}

export function ScannerTool() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<ScanItem[]>(getStoredHistory);
  const [autoOpen, setAutoOpen] = useState<boolean>(getStoredAutoOpen);
  const [isScanning, setIsScanning] = useState(false);
  const [scanningSource, setScanningSource] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<ScanItem | null>(() => history[0] ?? null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Save auto open setting
  const toggleAutoOpen = () => {
    setAutoOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_SCAN_AUTO_OPEN, String(next));
      return next;
    });
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleScanSuccess = useCallback(
    (text: string, format: string) => {
      playBeep();
      const isUrl = checkIsUrl(text);
      const newItem: ScanItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: text.trim(),
        format,
        timestamp: Date.now(),
        isUrl,
      };

      setLatestResult(newItem);
      setErrorMsg(null);

      setHistory((prev) => {
        // Filter duplicate if same text scanned within last 3 items
        const filtered = prev.filter((p) => p.text !== newItem.text);
        const next = [newItem, ...filtered].slice(0, 30);
        localStorage.setItem(STORAGE_SCAN_HISTORY, JSON.stringify(next));
        return next;
      });

      if (autoOpen) {
        void ipc.openUrlOrSearch(newItem.text);
        showToast(
          isUrl
            ? t("tools.scanner.openedUrl", "Link otomatis dibuka di browser!")
            : t("tools.scanner.searchedQuery", "Pencarian barcode dibuka di browser!"),
        );
      } else {
        showToast(t("tools.scanner.scannedSuccess", "Barcode berhasil dipindai!"));
      }
    },
    [autoOpen, t],
  );

  // Decode from Image element
  const decodeImageSource = async (dataUrl: string, sourceLabel: string) => {
    setIsScanning(true);
    setScanningSource(sourceLabel);
    setErrorMsg(null);

    try {
      const hints = new Map();
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = dataUrl;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Gagal memuat gambar"));
      });

      const res = await reader.decodeFromImageElement(img);
      const text = res.getText();
      const format = formatBarcodeName(res.getBarcodeFormat());
      handleScanSuccess(text, format);
    } catch {
      setErrorMsg(
        t(
          "tools.scanner.noCodeFound",
          "Tidak ditemukan QR Code atau Barcode yang jelas pada gambar.",
        ),
      );
    } finally {
      setIsScanning(false);
      setScanningSource(null);
    }
  };

  // 1. Screen Capture Scanner
  const handleScanScreen = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanningSource(t("tools.scanner.screen", "Layar"));
    setErrorMsg(null);

    try {
      // Capture the current monitor silently
      const base64 = await ipc.captureScreenBase64("screen");
      await decodeImageSource(base64, t("tools.scanner.screen", "Layar"));
    } catch (err) {
      setErrorMsg(
        t("tools.scanner.captureFailed", "Gagal mengambil tangkapan layar untuk pemindaian."),
      );
      setIsScanning(false);
      setScanningSource(null);
    }
  };

  // 2. File Upload Scanner
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        void decodeImageSource(reader.result, file.name);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // 3. Clipboard Paste Scanner (Ctrl+V)
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                void decodeImageSource(reader.result, "Clipboard");
              }
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      }
    },
    [],
  );

  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  // 4. Camera Live Scanner
  const startCamera = async () => {
    try {
      setIsCameraActive(true);
      setErrorMsg(null);
      const hints = new Map();
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);
      codeReaderRef.current = reader;

      if (!videoRef.current) return;

      await reader.decodeFromVideoDevice(
        null,
        videoRef.current,
        (result, _err) => {
          if (result) {
            const text = result.getText();
            const format = formatBarcodeName(result.getBarcodeFormat());
            stopCamera();
            handleScanSuccess(text, format);
          }
        },
      );
    } catch {
      setErrorMsg(t("tools.scanner.cameraError", "Gagal mengakses kamera atau izin ditolak."));
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const handleCopy = (item: ScanItem) => {
    void navigator.clipboard.writeText(item.text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1800);
    showToast(t("tools.scanner.copied", "Tersalin ke clipboard!"));
  };

  const handleOpenBrowser = (text: string) => {
    void ipc.openUrlOrSearch(text);
  };

  const handleDeleteHistory = (id: string) => {
    setHistory((prev) => {
      const next = prev.filter((item) => item.id !== id);
      localStorage.setItem(STORAGE_SCAN_HISTORY, JSON.stringify(next));
      return next;
    });
    if (latestResult?.id === id) {
      setLatestResult(null);
    }
  };

  const handleClearAllHistory = () => {
    setHistory([]);
    setLatestResult(null);
    localStorage.removeItem(STORAGE_SCAN_HISTORY);
  };

  return (
    <div className="flex h-full flex-col gap-3.5 select-none overflow-hidden">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Top Banner / Actions Area */}
      <div className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-surface/80 p-3.5 backdrop-blur-md shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-7.5 items-center justify-center rounded-xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-400 shadow-sm">
              <ScanLine className="size-4" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-fg flex items-center gap-1.5">
                <span>{t("tools.scanner.title", "QR & Barcode Scanner")}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 font-medium">
                  Auto Search
                </span>
              </div>
              <div className="text-[10.5px] text-subtle">
                {t(
                  "tools.scanner.subtitle",
                  "Pindai dari layar, file gambar, atau kamera lalu buka otomatis di browser",
                )}
              </div>
            </div>
          </div>

          {/* Auto open toggle */}
          <label className="flex items-center gap-2 cursor-pointer text-[11px] text-subtle hover:text-fg transition-colors">
            <span className="hidden sm:inline">
              {t("tools.scanner.autoOpen", "Buka otomatis di browser")}
            </span>
            <input
              type="checkbox"
              checked={autoOpen}
              onChange={toggleAutoOpen}
              className="accent-cyan-400 size-3.5 cursor-pointer rounded"
            />
          </label>
        </div>

        {/* Action Buttons Row */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          {/* 1. Screen Scan */}
          <button
            type="button"
            disabled={isScanning}
            onClick={handleScanScreen}
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 active:scale-[0.98] border border-cyan-400/40 text-cyan-200 text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
          >
            {isScanning && scanningSource === t("tools.scanner.screen", "Layar") ? (
              <RefreshCw className="size-3.5 animate-spin text-cyan-300" />
            ) : (
              <Monitor className="size-3.5 text-cyan-300" />
            )}
            <span>{t("tools.scanner.scanScreen", "Pindai Layar")}</span>
          </button>

          {/* 2. File Upload */}
          <button
            type="button"
            disabled={isScanning}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-[0.98] border border-white/10 text-fg text-xs font-medium transition-all disabled:opacity-50"
          >
            <Upload className="size-3.5 text-subtle" />
            <span>{t("tools.scanner.uploadImage", "Pilih Gambar")}</span>
          </button>

          {/* 3. Live Camera Toggle */}
          <button
            type="button"
            disabled={isScanning}
            onClick={isCameraActive ? stopCamera : startCamera}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-medium transition-all ${
              isCameraActive
                ? "bg-live/20 border-live/40 text-live"
                : "bg-white/5 hover:bg-white/10 border-white/10 text-fg"
            }`}
          >
            {isCameraActive ? (
              <>
                <CameraOff className="size-3.5 text-live" />
                <span>{t("tools.scanner.stopCamera", "Tutup Kamera")}</span>
              </>
            ) : (
              <>
                <Camera className="size-3.5 text-subtle" />
                <span>{t("tools.scanner.openCamera", "Kamera")}</span>
              </>
            )}
          </button>
        </div>

        {/* Live Camera Viewport if active */}
        {isCameraActive && (
          <div className="relative mt-2 overflow-hidden rounded-xl border border-cyan-500/30 bg-black/80 aspect-video flex items-center justify-center">
            <video ref={videoRef} className="size-full object-cover" />
            <div className="absolute inset-x-12 inset-y-6 border-2 border-dashed border-cyan-400/70 rounded-xl pointer-events-none animate-pulse flex items-center justify-center">
              <span className="text-[10px] text-cyan-200 bg-black/60 px-2 py-0.5 rounded-full font-mono">
                Arahkan QR / Barcode ke sini
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Status Notifications / Error / Toast Banner */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2 rounded-xl bg-ok/15 border border-ok/30 px-3 py-1.5 text-xs text-ok font-medium shadow-sm"
          >
            <Check className="size-3.5 shrink-0" />
            <span>{toastMsg}</span>
          </motion.div>
        )}

        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2 rounded-xl bg-live/15 border border-live/30 px-3 py-1.5 text-xs text-live font-medium shadow-sm"
          >
            <span>{errorMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Latest Result Card (if any) */}
      {latestResult && (
        <div className="flex flex-col gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
                <Sparkles className="size-3.5" />
                {t("tools.scanner.lastResult", "Hasil Pemindaian Terakhir")}
              </span>
              <span className="rounded-md bg-cyan-400/15 border border-cyan-400/25 px-2 py-0.5 text-[10px] font-mono font-semibold text-cyan-200">
                {latestResult.format}
              </span>
            </div>

            <span className="text-[10px] text-subtle font-mono">
              {new Date(latestResult.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>

          {/* Result Content Box */}
          <div className="relative rounded-xl border border-white/10 bg-surface/90 p-2.5 text-xs font-mono break-all text-fg select-text leading-relaxed">
            {latestResult.text}
          </div>

          {/* Result Action Buttons */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleOpenBrowser(latestResult.text)}
                className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 text-xs font-semibold transition-all active:scale-95"
              >
                {latestResult.isUrl ? (
                  <>
                    <Globe className="size-3.5 text-cyan-300" />
                    <span>{t("tools.scanner.openUrl", "Buka Link")}</span>
                  </>
                ) : (
                  <>
                    <Search className="size-3.5 text-cyan-300" />
                    <span>{t("tools.scanner.searchGoogle", "Cari di Google")}</span>
                  </>
                )}
                <ExternalLink className="size-3 opacity-70" />
              </button>

              <button
                type="button"
                onClick={() => handleCopy(latestResult)}
                className="flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-fg text-xs font-medium transition-all active:scale-95"
              >
                {copiedId === latestResult.id ? (
                  <>
                    <Check className="size-3.5 text-ok" />
                    <span className="text-ok">{t("tools.scanner.copied", "Tersalin")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5 text-subtle" />
                    <span>{t("tools.scanner.copy", "Salin")}</span>
                  </>
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={handleScanScreen}
              className="flex items-center gap-1 text-[11px] text-subtle hover:text-fg transition-colors"
            >
              <RefreshCw className="size-3" />
              <span>{t("tools.scanner.scanAgain", "Pindai Lagi")}</span>
            </button>
          </div>
        </div>
      )}

      {/* Scan History Section */}
      <div className="flex flex-1 flex-col min-h-0">
        <div className="flex items-center justify-between pb-1.5 px-0.5">
          <span className="text-xs font-semibold text-subtle">
            {t("tools.scanner.historyTitle", "Riwayat Pemindaian")} ({history.length})
          </span>
          {history.length > 0 && (
            <button
              type="button"
              onClick={handleClearAllHistory}
              className="text-[10.5px] text-muted hover:text-live flex items-center gap-1 transition-colors"
            >
              <Trash2 className="size-3" />
              <span>{t("tools.scanner.clearHistory", "Hapus Semua")}</span>
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-muted">
            <QrCode className="size-8 text-muted/40 mb-2" />
            <p className="font-medium text-subtle">
              {t("tools.scanner.emptyHistory", "Belum ada kode yang dipindai")}
            </p>
            <p className="text-[11px] text-muted/80 mt-1 max-w-[280px]">
              {t(
                "tools.scanner.emptyHistoryHint",
                "Klik 'Pindai Layar' atau tekan Ctrl+V saat ada QR / barcode di clipboard",
              )}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {history.map((item) => (
              <div
                key={item.id}
                className="group flex items-center justify-between rounded-xl border border-white/5 bg-surface/50 hover:bg-surface/80 p-2.5 transition-all text-xs"
              >
                <div className="flex flex-col min-w-0 flex-1 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9.5px] font-mono font-semibold text-cyan-300">
                      {item.format}
                    </span>
                    <span className="text-[10px] text-muted font-mono">
                      {new Date(item.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {item.isUrl && (
                      <span className="text-[9.5px] text-ok/80 flex items-center gap-0.5">
                        <Globe className="size-2.5" />
                        URL
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11.5px] text-fg mt-1">
                    {item.text}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleOpenBrowser(item.text)}
                    title={item.isUrl ? "Buka Link" : "Cari di Google"}
                    className="flex size-7 items-center justify-center rounded-lg hover:bg-white/10 text-cyan-300 transition-colors"
                  >
                    <ExternalLink className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(item)}
                    title="Salin Teks"
                    className="flex size-7 items-center justify-center rounded-lg hover:bg-white/10 text-subtle hover:text-fg transition-colors"
                  >
                    {copiedId === item.id ? (
                      <Check className="size-3.5 text-ok" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteHistory(item.id)}
                    title="Hapus"
                    className="flex size-7 items-center justify-center rounded-lg hover:bg-live/15 hover:text-live text-muted transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
