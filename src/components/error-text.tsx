import { useTranslation } from "react-i18next";
import type { AppError } from "../lib/ipc";

/** Codes whose backend message adds useful detail (a provider message, a bad field). */
const DETAILED = new Set(["provider", "invalid_input", "capture_failed", "hotkey_unavailable"]);

export function ErrorText({ error, className = "" }: { error: AppError; className?: string }) {
  const { t, i18n } = useTranslation();
  const key = `errors.${error.code}`;
  const known = i18n.exists(key);
  const detail = (DETAILED.has(error.code) || !known) && error.message ? error.message : null;

  return (
    <div role="alert" className={`flex gap-2 text-xs ${className}`}>
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-live" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-fg">{t(known ? key : "errors.internal")}</p>
        {detail && <p className="mt-0.5 break-words text-subtle">{detail}</p>}
      </div>
    </div>
  );
}
