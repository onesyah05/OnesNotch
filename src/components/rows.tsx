import type { ReactNode } from "react";

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
    <div className="rounded-xl glass-surface px-4 py-3 transition-colors hover:border-white/15">
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
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      className="size-4 accent-ok cursor-pointer"
    />
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
      className="shrink-0 rounded-full glass-elevated px-3 py-1 text-xs text-fg transition-all hover:border-white/20 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-base font-semibold">{title}</h2>;
}
