import { useState, type ReactNode } from "react";

/** One settings line: label on the left, control (with optional hint) on the right. */
export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl glass-surface px-4 py-3 transition-colors hover:border-fg/15">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 shrink-0 text-sm">{label}</span>
        <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "border-accent/60 bg-accent" : "border-elevated bg-surface"
      }`}
    >
      <span
        className={`inline-block size-3.5 rounded-full shadow-sm transition-transform ${
          checked ? "translate-x-[18px] bg-bg" : "translate-x-[2px] bg-subtle"
        }`}
      />
    </button>
  );
}

/** Small pill button used inside rows. */
export function RowButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 rounded-full glass-elevated px-3 py-1 text-xs text-fg transition-all hover:border-fg/20 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-base font-semibold">{title}</h2>;
}

/**
 * Numeric input that commits on blur or Enter, so typing "120" does not save
 * "1" and "12" on the way. Values are clamped to [min, max].
 */
export function NumberField({
  value,
  min,
  max,
  step = 1,
  suffix,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  label: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  // Follow outside changes (e.g. the other window saved) without an effect.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <label className="flex items-center gap-1.5">
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="w-20 rounded-lg bg-surface px-2 py-1 text-right font-mono text-xs text-fg ring-1 ring-elevated transition-shadow focus:outline-none focus:ring-accent"
      />
      {suffix && <span className="text-xs text-subtle">{suffix}</span>}
    </label>
  );
}
