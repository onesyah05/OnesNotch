import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  Copy,
  FolderOpen,
  Loader2,
  Pencil,
  Play,
  Plus,
  PowerOff,
  Search,
  SquareTerminal,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useRunnerStore, type AppPreset } from "../../stores/useRunnerStore";

const COLOR_OPTIONS = [
  { name: "Cyan", value: "#22d3ee" },
  { name: "Emerald", value: "#10b981" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Purple", value: "#a855f7" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Blue", value: "#3b82f6" },
];

const TEMPLATE_COMMANDS = [
  { label: "npm run dev", start: "npm run dev", stop: "" },
  { label: "pnpm dev", start: "pnpm dev", stop: "" },
  { label: "cargo tauri dev", start: "cargo tauri dev", stop: "" },
  { label: "cargo run", start: "cargo run", stop: "" },
  { label: "docker compose", start: "docker compose up", stop: "docker compose down" },
  { label: "python main.py", start: "python main.py", stop: "" },
];

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return "Belum pernah";
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "Baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}j lalu`;
  return `${Math.floor(diffHour / 24)}h lalu`;
}

export function RunnerTool() {
  const { t } = useTranslation();
  const {
    apps,
    searchQuery,
    executingId,
    error,
    setSearchQuery,
    addApp,
    updateApp,
    deleteApp,
    runApp,
    stopApp,
    openAppDirectory,
    pickDirectory,
  } = useRunnerStore();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recentSuccessId, setRecentSuccessId] = useState<string | null>(null);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  // Form states
  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState(""); // Command Start
  const [formCommandStop, setFormCommandStop] = useState(""); // Command Stop (optional; default: Ctrl+C)
  const [formDirectory, setFormDirectory] = useState("");
  const [formTerminal, setFormTerminal] = useState<"auto" | "wt" | "powershell" | "cmd">("auto");
  const [formMode, setFormMode] = useState<"terminal" | "background">("terminal");
  const [formColor, setFormColor] = useState("#22d3ee");

  const filteredApps = useMemo(() => {
    if (!searchQuery.trim()) return apps;
    const q = searchQuery.toLowerCase().trim();
    return apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.command.toLowerCase().includes(q) ||
        (a.commandStop && a.commandStop.toLowerCase().includes(q)) ||
        (a.directory && a.directory.toLowerCase().includes(q)),
    );
  }, [apps, searchQuery]);

  const handleOpenCreate = () => {
    setEditingId(null);
    setFormName("");
    setFormCommand("");
    setFormCommandStop("");
    setFormDirectory("");
    setFormTerminal("auto");
    setFormMode("terminal");
    setFormColor("#22d3ee");
    setIsFormOpen(true);
  };

  const handleOpenEdit = (app: AppPreset) => {
    setEditingId(app.id);
    setFormName(app.name);
    setFormCommand(app.command);
    setFormCommandStop(app.commandStop ?? "");
    setFormDirectory(app.directory ?? "");
    setFormTerminal(app.terminal ?? "auto");
    setFormMode(app.mode ?? "terminal");
    setFormColor(app.color ?? "#22d3ee");
    setIsFormOpen(true);
  };

  const handleBrowseFolder = async () => {
    setIsPickingFolder(true);
    const selected = await pickDirectory();
    setIsPickingFolder(false);
    if (selected) {
      setFormDirectory(selected);
    }
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formCommand.trim()) return;

    if (editingId) {
      updateApp(editingId, {
        name: formName.trim(),
        command: formCommand.trim(),
        commandStop: formCommandStop.trim() || undefined,
        directory: formDirectory.trim() || undefined,
        terminal: formTerminal,
        mode: formMode,
        color: formColor,
      });
    } else {
      addApp({
        name: formName.trim(),
        command: formCommand.trim(),
        commandStop: formCommandStop.trim() || undefined,
        directory: formDirectory.trim() || undefined,
        terminal: formTerminal,
        mode: formMode,
        color: formColor,
      });
    }
    setIsFormOpen(false);
  };

  const handleRun = async (id: string) => {
    const ok = await runApp(id);
    if (ok) {
      setRecentSuccessId(id);
      setTimeout(() => {
        setRecentSuccessId((curr) => (curr === id ? null : curr));
      }, 2000);
    }
  };

  const handleStop = async (id: string) => {
    setStoppingId(id);
    await stopApp(id);
    setStoppingId(null);
  };

  const handleCopyCommand = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((curr) => (curr === id ? null : curr));
    }, 1500);
  };

  return (
    <div className="flex h-full flex-col select-none overflow-hidden">
      <AnimatePresence mode="wait">
        {isFormOpen ? (
          /* =========================================================
           * FORM VIEW: Dedicated Scrollable Add/Edit Form
           * ========================================================= */
          <motion.div
            key="runner-form-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="flex h-full flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-fg/10 shrink-0">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-fg/5 hover:bg-fg/10 text-xs font-medium text-subtle hover:text-fg border border-fg/10 transition-colors"
              >
                <ArrowLeft className="size-3.5" />
                <span>{t("tools.runner.cancel", "Batal")}</span>
              </button>

              <span className="text-xs font-semibold text-fg">
                {editingId
                  ? t("tools.runner.editTitle", "Edit Shortcut App")
                  : t("tools.runner.createTitle", "Tambah Shortcut App Baru")}
              </span>

              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="text-subtle hover:text-fg p-1"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <form
              onSubmit={handleSaveForm}
              className="flex-1 min-h-0 overflow-y-auto thin-scrollbar pr-1.5 space-y-3 pb-3"
            >
              {/* App Name */}
              <div>
                <label className="block text-[10.5px] font-medium text-subtle mb-1">
                  {t("tools.runner.appName", "Nama Aplikasi")} *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Antares / Vite Dev Server"
                  className="w-full h-8 rounded-xl border border-fg/10 bg-surface/70 px-2.5 text-xs text-fg focus:border-accent focus:outline-none"
                />
              </div>

              {/* Command Start & Command Stop Inputs */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10.5px] font-medium text-subtle flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-accent" />
                      {t("tools.runner.commandStart", "Command Start")} *
                    </label>
                  </div>
                  <input
                    type="text"
                    required
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                    placeholder="e.g. npm run dev / antares"
                    className="w-full h-8 rounded-xl border border-fg/10 bg-surface/70 px-2.5 font-mono text-xs text-accent focus:border-accent focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10.5px] font-medium text-subtle flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-live" />
                      {t("tools.runner.commandStop", "Command Stop (Opsional)")}
                    </label>
                    <span className="text-[9px] text-muted font-mono">default: Ctrl+C</span>
                  </div>
                  <input
                    type="text"
                    value={formCommandStop}
                    onChange={(e) => setFormCommandStop(e.target.value)}
                    placeholder={t(
                      "tools.runner.commandStopPlaceholder",
                      "Default: Ctrl+C (atau isi misal docker compose down)",
                    )}
                    className="w-full h-8 rounded-xl border border-fg/10 bg-surface/70 px-2.5 font-mono text-xs text-live/90 focus:border-live focus:outline-none placeholder:text-muted/60"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted -mt-1">
                {t(
                  "tools.runner.commandStopHelp",
                  "Jika dikosongkan, default nya Ctrl+C untuk menghentikan proses.",
                )}
              </p>

              {/* Template Chips */}
              <div>
                <span className="block text-[10px] text-muted mb-1.5">Template Cepat:</span>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_COMMANDS.map((tpl) => (
                    <button
                      key={tpl.label}
                      type="button"
                      onClick={() => {
                        setFormCommand(tpl.start);
                        setFormCommandStop(tpl.stop);
                        if (!formName) setFormName(tpl.label);
                      }}
                      className="rounded-lg bg-fg/5 hover:bg-fg/15 border border-fg/10 px-2.5 py-1 text-[10px] font-mono text-subtle hover:text-fg active:scale-95 transition-all"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Directory Picker with "Pilih Folder" Button */}
              <div>
                <label className="block text-[10.5px] font-medium text-subtle mb-1">
                  {t("tools.runner.directory", "Working Directory (Opsional)")}
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={formDirectory}
                      onChange={(e) => setFormDirectory(e.target.value)}
                      placeholder={t(
                        "tools.runner.noDirectory",
                        "Kosongkan untuk default direktori terminal",
                      )}
                      className="w-full h-8 rounded-xl border border-fg/10 bg-surface/70 pl-3 pr-7 font-mono text-xs text-fg focus:border-accent focus:outline-none"
                    />
                    {formDirectory && (
                      <button
                        type="button"
                        onClick={() => setFormDirectory("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>

                  {/* Native Windows Folder Picker Button */}
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    disabled={isPickingFolder}
                    className="flex h-8 items-center gap-1.5 px-3 rounded-xl bg-accent/20 hover:bg-accent/30 border border-accent/40 text-accent text-xs font-semibold active:scale-95 transition-all shrink-0 disabled:opacity-50"
                  >
                    {isPickingFolder ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <FolderOpen className="size-3.5" />
                    )}
                    <span>{t("tools.runner.browseFolder", "Pilih Folder...")}</span>
                  </button>
                </div>
                <p className="text-[10px] text-muted mt-1">
                  Klik tombol <b>Pilih Folder...</b> untuk memilih direktori project dari Windows
                  Explorer.
                </p>
              </div>

              {/* Mode & Color */}
              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-fg/10">
                {/* Execution Mode */}
                <div>
                  <label className="block text-[10.5px] font-medium text-subtle mb-1.5">
                    Mode Eksekusi:
                  </label>
                  <div className="flex rounded-xl bg-fg/5 p-0.5 border border-fg/10 w-fit">
                    <button
                      type="button"
                      onClick={() => setFormMode("terminal")}
                      className={`px-2.5 py-1 rounded-lg text-[10.5px] font-medium transition-colors ${
                        formMode === "terminal" ? "bg-fg/15 text-fg shadow-sm" : "text-muted"
                      }`}
                    >
                      Terminal Window
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormMode("background")}
                      className={`px-2.5 py-1 rounded-lg text-[10.5px] font-medium transition-colors ${
                        formMode === "background" ? "bg-fg/15 text-fg shadow-sm" : "text-muted"
                      }`}
                    >
                      Background
                    </button>
                  </div>
                </div>

                {/* Color Tag */}
                <div>
                  <label className="block text-[10.5px] font-medium text-subtle mb-1.5">
                    Warna Label:
                  </label>
                  <div className="flex items-center gap-1.5">
                    {COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setFormColor(c.value)}
                        className={`size-5 rounded-full transition-transform ${
                          formColor === c.value
                            ? "ring-2 ring-fg scale-110 shadow-md"
                            : "opacity-60 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: c.value }}
                        title={c.name}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Action Buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-fg/10">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-fg/10 bg-fg/5 hover:bg-fg/10 text-xs text-subtle hover:text-fg transition-colors"
                >
                  {t("tools.runner.cancel", "Batal")}
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-accent hover:bg-accent text-xs font-semibold text-ink-950 transition-colors shadow active:scale-95"
                >
                  <Check className="size-3.5 stroke-[2.5]" />
                  <span>{t("tools.runner.save", "Simpan Shortcut")}</span>
                </button>
              </div>
            </form>
          </motion.div>
        ) : (
          /* =========================================================
           * LIST VIEW: App Shortcuts List
           * ========================================================= */
          <motion.div
            key="runner-list-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex h-full flex-col overflow-hidden"
          >
            {/* Top Bar: Search & Add App Button */}
            <div className="flex items-center gap-2 pb-2.5 shrink-0">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("tools.runner.searchPlaceholder", "Cari app atau command...")}
                  className="h-8 w-full rounded-xl border border-fg/10 bg-surface/60 pl-8 pr-7 text-xs text-fg placeholder:text-muted focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/30 transition-all font-mono"
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
                onClick={handleOpenCreate}
                className="flex h-8 items-center gap-1.5 px-3 rounded-xl bg-accent/20 hover:bg-accent/30 border border-accent/40 text-xs font-semibold text-accent active:scale-95 transition-all shadow-sm shrink-0"
              >
                <Plus className="size-3.5" />
                <span>{t("tools.runner.addApp", "Tambah App")}</span>
              </button>

              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-fg/5 border border-fg/10 font-mono text-[11px] text-subtle shrink-0">
                <SquareTerminal className="size-3 text-accent" />
                <span>{filteredApps.length}</span>
              </span>
            </div>

            {/* Error banner if any */}
            {error && (
              <div className="mb-2 flex items-center justify-between rounded-xl bg-live/15 border border-live/30 px-3 py-1.5 text-xs text-live shrink-0">
                <span className="truncate">{error}</span>
                <button
                  type="button"
                  onClick={() => useRunnerStore.setState({ error: null })}
                  className="text-live hover:text-fg"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}

            {/* Apps List */}
            <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar pr-1 space-y-2 pb-2">
              {filteredApps.length === 0 ? (
                <div className="flex h-44 flex-col items-center justify-center gap-2 text-center text-xs text-muted">
                  <SquareTerminal className="size-8 text-muted/30 mb-1" />
                  <p>
                    {searchQuery
                      ? "Tidak ada shortcut yang cocok"
                      : "Belum ada aplikasi yang disimpan"}
                  </p>
                  {!searchQuery && (
                    <button
                      type="button"
                      onClick={handleOpenCreate}
                      className="mt-1 text-accent hover:underline font-medium text-[11px]"
                    >
                      + Tambah Shortcut Pertama
                    </button>
                  )}
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {filteredApps.map((app) => {
                    const isExecuting = executingId === app.id;
                    const isRecentSuccess = recentSuccessId === app.id;
                    const isRunning = Boolean(app.isRunning || app.runningPid);
                    const isStopping = stoppingId === app.id;

                    return (
                      <motion.div
                        key={app.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="group relative flex items-center justify-between rounded-xl border border-fg/10 bg-surface/50 p-3 hover:border-fg/20 hover:bg-surface/80 transition-all"
                      >
                        {/* Left: Icon, Details, and Commands */}
                        <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                          <div
                            className="flex items-center justify-center size-9 rounded-xl border border-fg/10 shrink-0"
                            style={{
                              backgroundColor: `${app.color ?? "#22d3ee"}20`,
                              borderColor: `${app.color ?? "#22d3ee"}40`,
                            }}
                          >
                            <Terminal
                              className="size-4"
                              style={{ color: app.color ?? "#22d3ee" }}
                            />
                          </div>

                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs text-fg truncate">
                                {app.name}
                              </span>
                              {isRunning ? (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-ok/20 text-ok text-[10px] font-mono border border-ok/30">
                                  <span className="size-1.5 rounded-full bg-ok animate-pulse" />
                                  RUNNING {app.runningPid ? `PID ${app.runningPid}` : ""}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted shrink-0">
                                  {formatTimeAgo(app.lastRunAt)}
                                </span>
                              )}
                            </div>

                            {/* Commands Row: Start & Stop */}
                            <div className="flex items-center flex-wrap gap-1.5 mt-1.5 min-w-0">
                              {/* Start Command Badge */}
                              <div className="flex items-center gap-1 rounded-md bg-black/40 border border-fg/10 px-2 py-0.5 font-mono text-[11px] text-accent max-w-[200px]">
                                <span className="text-[9px] font-bold text-accent/80 uppercase tracking-wider">
                                  Start
                                </span>
                                <span className="truncate">{app.command}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyCommand(`start-${app.id}`, app.command)}
                                  title={t("tools.runner.copyStart")}
                                  className="text-muted hover:text-fg shrink-0 ml-0.5"
                                >
                                  {copiedId === `start-${app.id}` ? (
                                    <Check className="size-2.5 text-ok" />
                                  ) : (
                                    <Copy className="size-2.5" />
                                  )}
                                </button>
                              </div>

                              {/* Stop Command Badge */}
                              <div className="flex items-center gap-1 rounded-md bg-black/40 border border-fg/10 px-2 py-0.5 font-mono text-[11px] text-subtle max-w-[200px]">
                                <span className="text-[9px] font-bold text-live/80 uppercase tracking-wider">
                                  Stop
                                </span>
                                <span className="truncate text-live/80">
                                  {app.commandStop?.trim() ? app.commandStop : "Ctrl+C"}
                                </span>
                                {app.commandStop?.trim() && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleCopyCommand(`stop-${app.id}`, app.commandStop!)
                                    }
                                    title={t("tools.runner.copyStop")}
                                    className="text-muted hover:text-fg shrink-0 ml-0.5"
                                  >
                                    {copiedId === `stop-${app.id}` ? (
                                      <Check className="size-2.5 text-ok" />
                                    ) : (
                                      <Copy className="size-2.5" />
                                    )}
                                  </button>
                                )}
                              </div>

                              {/* Directory Badge */}
                              {app.directory && (
                                <button
                                  type="button"
                                  onClick={() => void openAppDirectory(app.directory!)}
                                  title={`Buka folder: ${app.directory}`}
                                  className="flex items-center gap-1 rounded-md bg-fg/5 hover:bg-fg/10 border border-fg/10 px-1.5 py-0.5 text-[10px] text-subtle hover:text-fg font-mono truncate max-w-[130px]"
                                >
                                  <FolderOpen className="size-2.5 text-warn shrink-0" />
                                  <span className="truncate">{app.directory}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(app)}
                            title={t("tools.runner.edit", "Edit Shortcut")}
                            className="flex size-7 items-center justify-center rounded-lg border border-fg/10 bg-fg/5 text-subtle hover:bg-fg/10 hover:text-fg active:scale-95 transition-all"
                          >
                            <Pencil className="size-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteApp(app.id)}
                            title={t("tools.runner.delete", "Hapus Shortcut")}
                            className="flex size-7 items-center justify-center rounded-lg border border-fg/10 bg-fg/5 text-subtle hover:bg-live/20 hover:border-live/30 hover:text-live active:scale-95 transition-all"
                          >
                            <Trash2 className="size-3.5" />
                          </button>

                          {/* Primary Action Button: Stop or Start */}
                          {isRunning ? (
                            <button
                              type="button"
                              onClick={() => void handleStop(app.id)}
                              disabled={isStopping}
                              title={
                                app.commandStop ? `Stop via: ${app.commandStop}` : "Stop (Ctrl+C)"
                              }
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-live hover:bg-live text-fg shadow-sm active:scale-95 transition-all disabled:opacity-50"
                            >
                              {isStopping ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <PowerOff className="size-3" />
                              )}
                              <span>
                                {isStopping
                                  ? t("tools.runner.stopping", "Stopping...")
                                  : t("tools.runner.stop", "Stop")}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleRun(app.id)}
                              disabled={isExecuting}
                              title={t("tools.runner.runNow")}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm active:scale-95 transition-all ${
                                isRecentSuccess
                                  ? "bg-ok text-ink-950 font-bold"
                                  : "bg-accent hover:bg-accent text-ink-950"
                              }`}
                            >
                              {isExecuting ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : isRecentSuccess ? (
                                <Check className="size-3 stroke-[2.5]" />
                              ) : (
                                <Play className="size-3 fill-current" />
                              )}
                              <span>
                                {isExecuting
                                  ? t("tools.runner.running", "Menjalankan...")
                                  : isRecentSuccess
                                    ? t("tools.runner.success", "Berhasil!")
                                    : t("tools.runner.run", "Start")}
                              </span>
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
