import { useEffect } from "react";
import { Check, Clipboard, Copy, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClipboardStore } from "../../stores/useClipboardStore";
import { events, type ClipboardItem } from "../../lib/ipc";

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return "";
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "Baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}j lalu`;
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function ClipboardTool() {
  const { t } = useTranslation();
  const {
    items,
    loading,
    searchQuery,
    copiedId,
    load,
    addItem,
    copy,
    deleteItem,
    clearAll,
    setSearchQuery,
  } = useClipboardStore();

  useEffect(() => {
    void load();
    const pending = events.clipboardChanged((item: ClipboardItem) => {
      addItem(item);
    });

    return () => {
      pending.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [load, addItem]);

  const filtered = items.filter((item) =>
    item.text.toLowerCase().includes(searchQuery.toLowerCase().trim()),
  );

  return (
    <div className="flex h-full flex-col gap-3 select-none">
      {/* Header controls: Search & Clear all */}
      <div className="flex items-center gap-2">
        <div className="relative flex flex-1 items-center rounded-xl border border-fg/10 bg-surface/70 px-2.5 py-1.5 focus-within:border-fg/25 transition-colors">
          <Search className="size-3.5 text-muted shrink-0 mr-2" />
          <input
            type="text"
            placeholder={t("tools.clipboard.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-xs text-fg placeholder:text-muted focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-muted hover:text-fg ml-1"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {items.length > 0 && (
          <button
            type="button"
            onClick={() => void clearAll()}
            title={t("tools.clipboard.clearAll")}
            className="flex items-center gap-1.5 rounded-xl border border-fg/10 bg-surface/50 px-2.5 py-1.5 text-xs text-subtle hover:bg-live/15 hover:text-live hover:border-live/30 transition-all active:scale-95 shrink-0"
          >
            <Trash2 className="size-3.5" />
            <span className="hidden sm:inline">{t("tools.clipboard.clear")}</span>
          </button>
        )}
      </div>

      {/* Items List */}
      <div className="flex-1 overflow-y-auto thin-scrollbar pr-1 flex flex-col gap-2 min-h-0">
        {loading && items.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted">
            {t("tools.clipboard.loading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-44 flex-col items-center justify-center gap-2 text-center text-muted">
            <Clipboard className="size-8 opacity-40" />
            <p className="text-xs font-medium">
              {searchQuery ? t("tools.clipboard.noSearchResults") : t("tools.clipboard.emptyTitle")}
            </p>
            <p className="text-[11px] text-muted/80 max-w-[240px]">
              {searchQuery ? t("tools.clipboard.noSearchHint") : t("tools.clipboard.emptyHint")}
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const isCopied = copiedId === item.id;
            return (
              <div
                key={item.id}
                onClick={() => void copy(item)}
                className="group relative flex flex-col gap-1.5 rounded-xl border border-fg/[0.08] bg-surface/40 p-2.5 hover:bg-surface/80 hover:border-fg/15 transition-all cursor-pointer shadow-sm active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-xs text-fg leading-relaxed line-clamp-2 break-all select-text">
                    {item.text}
                  </p>

                  <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void copy(item);
                      }}
                      title={t("tools.clipboard.copy")}
                      className={`flex size-6 items-center justify-center rounded-lg border transition-all ${
                        isCopied
                          ? "border-ok/40 bg-ok/20 text-ok"
                          : "border-fg/10 bg-fg/5 text-subtle hover:bg-fg/15 hover:text-fg"
                      }`}
                    >
                      {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteItem(item.id);
                      }}
                      title={t("tools.clipboard.delete")}
                      className="flex size-6 items-center justify-center rounded-lg border border-transparent text-muted hover:border-live/30 hover:bg-live/15 hover:text-live transition-all"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-muted font-mono pt-0.5 border-t border-fg/5">
                  <span>{formatTimestamp(item.timestamp)}</span>
                  <span>{item.text.length} karakter</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
