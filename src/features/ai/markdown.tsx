import { memo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "../../components/icons";
import { ipc } from "../../lib/ipc";

const COPIED_MS = 1200;

function CodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const text = ref.current?.textContent ?? "";
    void ipc
      .clipboardWrite(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(() => {});
  };

  return (
    <div className="group relative">
      <pre ref={ref}>{children}</pre>
      <button
        type="button"
        onClick={copy}
        title={t("ai.actions.copyCode")}
        aria-label={t("ai.actions.copyCode")}
        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md bg-elevated text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  );
}

// Links and images render inert: the notch must never navigate or fetch
// anything external (AGENTS.md rule 6, strict CSP).
const components: Components = {
  a: ({ children }) => <span className="md-link">{children}</span>,
  img: ({ alt }) => <span className="text-muted">[{alt}]</span>,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

export const Markdown = memo(function Markdown({
  text,
  compact = false,
}: {
  text: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "md md-compact" : "md"}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
