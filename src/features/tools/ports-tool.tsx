import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, Check, Loader2, Network, PowerOff, RotateCcw, Search, X } from "lucide-react";
import { usePortStore } from "../../stores/usePortStore";
import { AppIcon } from "../../components/app-icon";

export function PortsTool() {
  const { t } = useTranslation();
  const { ports, isLoading, error, searchQuery, setSearchQuery, loadPorts, killPortProcess } =
    usePortStore();

  const [killingPid, setKillingPid] = useState<number | null>(null);
  const [successPid, setSuccessPid] = useState<number | null>(null);

  useEffect(() => {
    void loadPorts();
  }, [loadPorts]);

  const filteredPorts = useMemo(() => {
    if (!searchQuery.trim()) return ports;
    const q = searchQuery.toLowerCase().trim();
    return ports.filter(
      (p) =>
        p.port.toString().includes(q) ||
        p.processName.toLowerCase().includes(q) ||
        p.pid.toString().includes(q) ||
        p.localAddress.toLowerCase().includes(q),
    );
  }, [ports, searchQuery]);

  const handleKill = async (pid: number) => {
    if (pid === 0 || pid === 4) return;
    setKillingPid(pid);
    const ok = await killPortProcess(pid);
    setKillingPid(null);
    if (ok) {
      setSuccessPid(pid);
      setTimeout(() => {
        setSuccessPid((curr) => (curr === pid ? null : curr));
      }, 1800);
    }
  };

  return (
    <div className="flex h-full flex-col select-none overflow-hidden">
      {/* 1. Top Controls: Search & Refresh */}
      <div className="flex items-center gap-2 pb-2.5 shrink-0">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("tools.ports.searchPlaceholder")}
            className="h-8 w-full rounded-xl border border-white/10 bg-surface/60 pl-8 pr-7 text-xs text-fg placeholder:text-muted focus:border-cyan-400/50 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 transition-all font-mono"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => void loadPorts()}
          disabled={isLoading}
          title={t("tools.ports.refresh")}
          className="flex size-8 items-center justify-center rounded-xl border border-white/10 bg-surface/60 text-subtle hover:bg-surface hover:text-fg disabled:opacity-50 active:scale-95 transition-all shadow-sm shrink-0"
        >
          <RotateCcw className={`size-3.5 ${isLoading ? "animate-spin text-cyan-400" : ""}`} />
        </button>

        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/5 border border-white/10 font-mono text-[11px] text-subtle shrink-0">
          <Network className="size-3 text-cyan-400" />
          <span>{filteredPorts.length}</span>
        </span>
      </div>

      {/* Error alert if any */}
      {error && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-live/15 border border-live/30 px-3 py-1.5 text-xs text-live shrink-0">
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* 2. Scrollable Ports List */}
      <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar pr-1 space-y-1.5">
        {isLoading && ports.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-xs text-muted">
            <Loader2 className="size-5 animate-spin text-cyan-400" />
            <span>{t("tools.ports.loading")}</span>
          </div>
        ) : filteredPorts.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-1.5 text-center text-xs text-muted">
            <Network className="size-6 text-muted/40 mb-1" />
            <span>{searchQuery ? t("tools.ports.noMatch") : t("tools.ports.empty")}</span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filteredPorts.map((item) => {
              const isSystem = item.pid === 0 || item.pid === 4;
              const isKilling = killingPid === item.pid;
              const isSuccess = successPid === item.pid;

              return (
                <motion.div
                  key={`${item.port}-${item.pid}-${item.localAddress}`}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="group relative flex items-center justify-between rounded-xl border border-white/10 bg-surface/50 p-2.5 hover:border-white/20 hover:bg-surface/80 transition-all"
                >
                  {/* Left: Port Pill + App Icon & Name */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                    {/* Port Tag */}
                    <div className="flex items-center gap-1 rounded-lg bg-cyan-500/15 border border-cyan-400/30 px-2 py-1 font-mono text-xs font-bold text-cyan-300 shrink-0">
                      <span>:{item.port}</span>
                    </div>

                    {/* App Thumbnail / Icon */}
                    <div className="size-6 shrink-0 overflow-hidden rounded-md bg-surface ring-1 ring-white/10 flex items-center justify-center">
                      <AppIcon appName={item.processName} size={18} />
                    </div>

                    {/* Process info */}
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-fg truncate">
                          {item.processName}
                        </span>
                        <span className="text-[10px] font-mono text-muted shrink-0">
                          PID: {item.pid}
                        </span>
                      </div>
                      <span className="text-[10px] text-subtle font-mono truncate">
                        {item.localAddress}
                      </span>
                    </div>
                  </div>

                  {/* Right: Kill Button */}
                  <div className="shrink-0 flex items-center gap-1">
                    {isSuccess ? (
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-ok/20 border border-ok/40 text-[11px] font-medium text-ok">
                        <Check className="size-3" />
                        <span>{t("tools.ports.killed")}</span>
                      </span>
                    ) : isSystem ? (
                      <span
                        className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] font-mono text-muted/60"
                        title={t("tools.ports.systemProcess")}
                      >
                        System
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleKill(item.pid)}
                        disabled={isKilling}
                        title={t("tools.ports.killTooltip", {
                          process: item.processName,
                          pid: item.pid,
                          port: item.port,
                        })}
                        className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/25 hover:border-red-500/50 hover:text-red-300 active:scale-95 transition-all disabled:opacity-50"
                      >
                        {isKilling ? (
                          <Loader2 className="size-3 animate-spin text-red-400" />
                        ) : (
                          <PowerOff className="size-3" />
                        )}
                        <span>{t("tools.ports.kill")}</span>
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
