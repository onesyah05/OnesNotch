import { splitPgAnswer } from "../../windows/notch/chip-layout";

/**
 * Multiple-choice answers rendered as plain items, not markdown: markdown
 * would turn "3. C | 4. D" into an ordered list starting at 3.
 * Items wrap as whole units, so a long row never gets clipped.
 */
export function PgAnswer({ text, className = "" }: { text: string; className?: string }) {
  const items = splitPgAnswer(text);
  return (
    <p
      className={`flex flex-wrap items-center gap-x-1 gap-y-1.5 text-sm leading-5 select-text ${className}`}
    >
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-x-1">
          {index > 0 && (
            <span className="px-1 text-muted" aria-hidden="true">
              |
            </span>
          )}
          <span className="whitespace-nowrap tabular-nums">
            {item.label !== null && <span className="text-subtle">{item.label}.&nbsp;</span>}
            <span className="font-semibold text-fg">{item.choice}</span>
          </span>
        </span>
      ))}
    </p>
  );
}
