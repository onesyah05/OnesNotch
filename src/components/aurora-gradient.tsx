import { memo } from "react";

interface AuroraGradientProps {
  variant?: "compact" | "expanded" | "settings" | "chip";
  active?: boolean;
  className?: string;
}

/**
 * AuroraGradient creates a fluid, organic, animated glowing aurora ribbon and atmospheric mesh
 * that breathes and moves dynamically, blending the project's deep ink palette with the user's
 * configured accent color (--notch-accent).
 */
export const AuroraGradient = memo(function AuroraGradient({
  variant = "compact",
  active = false,
  className = "",
}: AuroraGradientProps) {
  if (variant === "compact") {
    return (
      <div
        className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] transition-opacity duration-500 ${className}`}
        aria-hidden="true"
      >
        {/* Delicate subtle ambient glow in corner (opacity tuned so it never fogs the dark pill) */}
        <div
          className="absolute -top-12 -left-6 size-28 rounded-full blur-md animate-aurora-drift-1 opacity-35"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--notch-accent, #22d3ee) 25%, #98a9c4 75%) 0%, transparent 70%)",
          }}
        />

        {/* Crisp specular liquid top line with subtle shimmer */}
        <div
          className={`absolute top-0 inset-x-8 h-[1px] transition-all duration-700 animate-aurora-shimmer ${
            active ? "opacity-100 scale-x-110" : "opacity-65"
          }`}
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(220, 227, 239, 0.35) 30%, color-mix(in srgb, var(--notch-accent, #22d3ee) 50%, white 50%) 50%, rgba(220, 227, 239, 0.35) 70%, transparent 100%)",
          }}
        />

        {/* Specular baseline rim */}
        <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[rgb(220_227_239/0.25)] to-transparent" />
      </div>
    );
  }

  if (variant === "chip") {
    return (
      <div
        className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] ${className}`}
        aria-hidden="true"
      >
        {/* Soft diffuse ambient glow drifting */}
        <div
          className="absolute -top-12 -left-10 size-48 rounded-full blur-xl animate-aurora-drift-1 opacity-75"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--notch-accent, #22d3ee) 30%, #98a9c4 70%) 0%, rgb(83 102 132 / 0.15) 45%, transparent 75%)",
          }}
        />
        <div className="absolute -bottom-10 -right-10 size-40 rounded-full bg-[radial-gradient(circle,rgb(48_61_89/0.35)_0%,transparent_70%)] blur-xl animate-aurora-drift-2" />

        {/* Bright core accent beam */}
        <div
          className="absolute top-0 inset-x-6 h-[1.5px]"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--notch-accent, #22d3ee) 50%, #dce3ef 50%) 50%, transparent 100%)",
          }}
        />
      </div>
    );
  }

  if (variant === "expanded") {
    return (
      <div
        className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] ${className}`}
        aria-hidden="true"
      >
        {/* 1. Dramatic animated top-left aurora spotlight */}
        <div
          className="absolute -top-24 -left-20 h-96 w-96 rounded-full blur-3xl animate-aurora-drift-1"
          style={{
            background:
              "radial-gradient(circle at 35% 35%, color-mix(in srgb, var(--notch-accent, #22d3ee) 32%, #98a9c4 68%) 0%, rgb(83 102 132 / 0.22) 35%, rgb(48 61 89 / 0.1) 60%, transparent 80%)",
          }}
        />

        {/* 2. Fluid animated organic ribbon waves with smooth drift */}
        <svg
          className="absolute -top-10 -right-8 h-96 w-[480px] opacity-90 blur-xl animate-aurora-drift-3"
          viewBox="0 0 400 300"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Deep atmospheric wave layer */}
          <path
            d="M 20 120 C 100 40, 220 220, 320 80 C 370 20, 420 160, 460 100"
            stroke="url(#aurora-mesh-deep)"
            strokeWidth="68"
            strokeLinecap="round"
          />
          {/* Radiant mid-tone halo with accent infusion */}
          <path
            d="M 20 120 C 100 40, 220 220, 320 80 C 370 20, 420 160, 460 100"
            stroke="url(#aurora-mesh-mid)"
            strokeWidth="38"
            strokeLinecap="round"
          />
          {/* Bright luminescent core */}
          <path
            d="M 20 120 C 100 40, 220 220, 320 80 C 370 20, 420 160, 460 100"
            stroke="url(#aurora-mesh-core)"
            strokeWidth="16"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="aurora-mesh-deep" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#303D59" stopOpacity="0.6" />
              <stop offset="45%" stopColor="#536684" stopOpacity="0.75" />
              <stop offset="75%" stopColor="#303D59" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#1E263B" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="aurora-mesh-mid" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#536684" stopOpacity="0.2" />
              <stop offset="30%" stopColor="#98A9C4" stopOpacity="0.7" />
              <stop offset="65%" stopColor="#536684" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#303D59" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="aurora-mesh-core" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="10%" stopColor="#98A9C4" stopOpacity="0.4" />
              <stop offset="50%" stopColor="#DCE3EF" stopOpacity="0.95" />
              <stop offset="90%" stopColor="#98A9C4" stopOpacity="0.5" />
            </linearGradient>
          </defs>
        </svg>

        {/* 3. Secondary animated ambient aurora wave pool */}
        <div
          className="absolute -bottom-24 left-1/4 h-64 w-96 rounded-full blur-3xl animate-aurora-drift-2 opacity-70"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--notch-accent, #22d3ee) 22%, #303d59 78%) 0%, transparent 70%)",
          }}
        />

        {/* 4. Top specular rim line */}
        <div className="absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-[rgb(220_227_239/0.45)] to-transparent" />
      </div>
    );
  }

  // settings variant
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      {/* Dramatic atmospheric spotlight beam in top-left */}
      <div
        className="absolute -top-36 -left-28 h-[460px] w-[460px] rounded-full blur-3xl animate-aurora-drift-1 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--notch-accent, #22d3ee) 25%, #98a9c4 75%) 0%, rgb(83 102 132 / 0.2) 40%, rgb(48 61 89 / 0.08) 65%, transparent 80%)",
        }}
      />

      {/* Sweeping fluid wave across right side */}
      <div
        className="absolute top-1/4 -right-28 h-[520px] w-[560px] rounded-full blur-3xl animate-aurora-drift-2 opacity-75"
        style={{
          background:
            "radial-gradient(ellipse at center, rgb(83 102 132 / 0.24) 0%, color-mix(in srgb, var(--notch-accent, #22d3ee) 18%, #303d59 82%) 35%, rgb(30 38 59 / 0.1) 60%, transparent 75%)",
        }}
      />

      {/* Bottom subtle ambient pool */}
      <div className="absolute -bottom-24 left-1/4 h-80 w-[420px] rounded-full bg-[radial-gradient(circle,rgb(48_61_89/0.32)_0%,transparent_70%)] blur-3xl animate-aurora-drift-3" />
    </div>
  );
});
