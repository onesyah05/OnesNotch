import { memo, useState } from "react";

interface AppIconProps {
  appName: string;
  iconDataUrl?: string | null;
  className?: string;
  size?: number; // size in px, defaults to 28
}

export const AppIcon = memo(function AppIcon({
  appName,
  iconDataUrl,
  className = "",
  size = 28,
}: AppIconProps) {
  const [imgFailed, setImgFailed] = useState(false);

  // If icon data/url is provided and hasn't failed, render it
  if (
    iconDataUrl &&
    !imgFailed &&
    (iconDataUrl.startsWith("data:") || iconDataUrl.startsWith("http"))
  ) {
    return (
      <img
        src={iconDataUrl}
        alt={appName}
        onError={() => setImgFailed(true)}
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-full object-cover ring-1 ring-white/10 ${className}`}
      />
    );
  }

  const lower = appName.toLowerCase();

  // WhatsApp
  if (lower.includes("whatsapp")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm ring-1 ring-[#25D366]/40 ${className}`}
        title="WhatsApp"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.6, height: size * 0.6 }}
        >
          <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.42a8.225 8.225 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.196 8.196 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.53 11.54c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.79 1-.14.18-.29.2-.54.08-.25-.12-1.05-.39-2-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.17-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.35-.77-1.85-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.66.31-.22.25-.86.84-.86 2.06 0 1.21.89 2.39 1.01 2.55.13.17 1.74 2.65 4.22 3.72.59.25 1.05.4 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.23-.17-.48-.29" />
        </svg>
      </div>
    );
  }

  // Discord
  if (lower.includes("discord")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#5865F2] text-white shadow-sm ring-1 ring-[#5865F2]/40 ${className}`}
        title="Discord"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.6, height: size * 0.6 }}
        >
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      </div>
    );
  }

  // Spotify
  if (lower.includes("spotify")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#1DB954] text-black shadow-sm ring-1 ring-[#1DB954]/40 ${className}`}
        title="Spotify"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.6, height: size * 0.6 }}
        >
          <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2m4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.625.625 0 0 1-.277-1.219c3.808-.87 7.076-.496 9.712 1.119a.624.624 0 0 1 .207.857m1.226-2.723a.78.78 0 0 1-1.074.257c-2.687-1.652-6.785-2.131-9.965-1.166a.781.781 0 0 1-.453-1.495c3.632-1.102 8.147-.568 11.235 1.33a.78.78 0 0 1 .257 1.074m.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.936.936 0 1 1-.543-1.792c3.528-1.07 9.398-.865 13.38 1.499a.936.936 0 1 1-.956 1.607" />
        </svg>
      </div>
    );
  }

  // Telegram
  if (lower.includes("telegram")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#229ED9] text-white shadow-sm ring-1 ring-[#229ED9]/40 ${className}`}
        title="Telegram"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.6, height: size * 0.6 }}
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
        </svg>
      </div>
    );
  }

  // YouTube / YouTube Music
  if (lower.includes("youtube")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#FF0000] text-white shadow-sm ring-1 ring-[#FF0000]/40 ${className}`}
        title="YouTube"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.6, height: size * 0.6 }}
        >
          <path d="M21.58 7.19a2.506 2.506 0 0 0-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42a2.506 2.506 0 0 0-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81c.24.89.94 1.58 1.83 1.82C5.81 19 12 19 12 19s6.25 0 7.81-.37a2.506 2.506 0 0 0 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15V9l5.2 3L10 15z" />
        </svg>
      </div>
    );
  }

  // Slack
  if (lower.includes("slack")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#4A154B] text-white shadow-sm ring-1 ring-[#4A154B]/40 ${className}`}
        title="Slack"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.6, height: size * 0.6 }}
        >
          <path d="M6 15a2 2 0 0 1-2-2 2 2 0 0 1 2-2h2v2a2 2 0 0 1-2 2m1 0a2 2 0 0 1 2-2 2 2 0 0 1 2 2v5a2 2 0 0 1-2 2 2 2 0 0 1-2-2zm2-8a2 2 0 0 1-2-2 2 2 0 0 1 2-2 2 2 0 0 1 2 2v2zm0 1a2 2 0 0 1 2-2 2 2 0 0 1 2 2h5a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-5zm8 2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2v-2a2 2 0 0 1 2-2m-1 0a2 2 0 0 1-2 2 2 2 0 0 1-2-2V5a2 2 0 0 1 2-2 2 2 0 0 1 2 2zm-2 8a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2v-2zm0-1a2 2 0 0 1-2 2 2 2 0 0 1-2-2H4a2 2 0 0 1-2-2 2 2 0 0 1 2-2h5z" />
        </svg>
      </div>
    );
  }

  // Microsoft Teams
  if (lower.includes("teams")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#5059C9] text-white shadow-sm ring-1 ring-[#5059C9]/40 ${className}`}
        title="Teams"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.6, height: size * 0.6 }}
        >
          <path d="M19.5 7.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0m-3.5 3h3a2 2 0 0 1 2 2v2.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5V13a2.5 2.5 0 0 1 1-2.5M14 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0m-4.5 4h4A2.5 2.5 0 0 1 16 13v3.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5V13a2.5 2.5 0 0 1 2.5-2.5" />
        </svg>
      </div>
    );
  }

  // Chrome or Google
  if (lower.includes("chrome") || lower.includes("google")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#4285F4] text-white shadow-sm ring-1 ring-[#4285F4]/40 ${className}`}
        title="Google Chrome"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ width: size * 0.6, height: size * 0.6 }}
        >
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <line x1="21.17" y1="8" x2="12" y2="8" />
          <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
          <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
        </svg>
      </div>
    );
  }

  // Firefox
  if (lower.includes("firefox")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#FF7139] text-white shadow-sm ring-1 ring-[#FF7139]/40 ${className}`}
        title="Firefox"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.6, height: size * 0.6 }}
        >
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm6.65 13.91a8.1 8.1 0 0 1-5.18 3.86 8.36 8.36 0 0 1-6.17-.91 8.24 8.24 0 0 1-3.79-5.14 8.35 8.35 0 0 1 .83-6.28 8.16 8.16 0 0 1 4.31-3.69 8 8 0 0 0-.25 2.87 7.77 7.77 0 0 0 2.2 4.67 8 8 0 0 0 3.73 2.12 6.47 6.47 0 0 1-2.42-2.9 6.2 6.2 0 0 1 .55-5.26 8 8 0 0 1 2.37-2.47 8.32 8.32 0 0 1 3.82-1.42 8.28 8.28 0 0 1 .05 14.55z" />
        </svg>
      </div>
    );
  }

  // Edge / Browser
  if (lower.includes("edge") || lower.includes("browser")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#0078D7] text-white shadow-sm ring-1 ring-[#0078D7]/40 ${className}`}
        title="Microsoft Edge"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.6, height: size * 0.6 }}
        >
          <path d="M20.5 14.5c-.3 3.6-3.3 6.5-7 6.5-4.1 0-7.5-3.4-7.5-7.5 0-3.3 2.1-6.1 5.1-7.1-.4 1.3-.3 2.7.4 3.9.7 1.2 1.9 1.9 3.2 2 1.3.1 2.6-.4 3.5-1.3 1.2 1 2 2.2 2.3 3.5m1-4.8c-.8-3.4-3.5-6-7-6.5 1.5 1.2 2.5 3 2.5 5 0 .5-.1 1-.2 1.5 1.5-.1 3-.3 4.7 0" />
        </svg>
      </div>
    );
  }

  // Music app / Apple Music / Default media player
  if (lower.includes("music") || lower.includes("media") || lower.includes("groove")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#FA2D48] text-white shadow-sm ring-1 ring-[#FA2D48]/40 ${className}`}
        title="Music"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.58, height: size * 0.58 }}
        >
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
      </div>
    );
  }

  // Outlook / Mail
  if (lower.includes("outlook") || lower.includes("mail")) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#0078D4] text-white shadow-sm ring-1 ring-[#0078D4]/40 ${className}`}
        title="Outlook"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ width: size * 0.58, height: size * 0.58 }}
        >
          <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
        </svg>
      </div>
    );
  }

  // Default initial avatar with smooth palette color
  const initial = appName.slice(0, 1).toUpperCase() || "W";
  return (
    <div
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-full bg-surface text-fg ring-1 ring-elevated font-semibold text-xs shadow-sm ${className}`}
    >
      {initial}
    </div>
  );
});
