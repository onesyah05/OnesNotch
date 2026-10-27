import { memo, type ReactNode } from "react";

interface LiquidRippleFrameProps {
  className?: string;
  children: ReactNode;
}

/**
 * LiquidRippleFrame implements the exact smooth gooey water ripple effect
 * provided in the reference code:
 * - Fluid undulating wave drops (.wave-drop) sloshing along the bottom
 * - SVG filter (#smooth-liquid) with Gaussian blur + ColorMatrix alpha threshold
 * - Luminous cyan edge glow (#5ab9ff) automatically tracing the liquid wave contour
 * - Deep volumetric blue underglow (#1968c8)
 * - Top glossy glass highlight (.top-shine)
 * - Razor-sharp content layer above the liquid
 */
export const LiquidRippleFrame = memo(function LiquidRippleFrame({
  className = "",
  children,
}: LiquidRippleFrameProps) {
  return (
    <div className={`relative h-full w-full select-none ${className}`}>
      {/* SVG Filters for Smooth Liquid Gooey + Edge Blue Glow Effect */}
      <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
        <defs>
          <filter id="smooth-liquid" x="-35%" y="-35%" width="170%" height="190%">
            {/* 1. Blur to merge drops */}
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />

            {/* 2. ColorMatrix to sharpen edges into liquid surface tension */}
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  
                      0 1 0 0 0  
                      0 0 1 0 0  
                      0 0 0 24 -10"
              result="goo"
            />

            {/* 3. Bottom luminous cyan edge highlight following the waves */}
            <feGaussianBlur in="goo" stdDeviation="2.5" result="inner-blur" />
            <feOffset in="inner-blur" dx="0" dy="-3.5" result="offset-blur" />
            <feComposite in="goo" in2="offset-blur" operator="out" result="bottom-edge" />
            <feFlood flood-color="#5ab9ff" flood-opacity="0.9" result="glow-color" />
            <feComposite in="glow-color" in2="bottom-edge" operator="in" result="bottom-glow" />

            {/* 4. Deeper atmospheric blue glow under the waves */}
            <feGaussianBlur in="goo" stdDeviation="7" result="deep-blur" />
            <feOffset in="deep-blur" dx="0" dy="-8" result="deep-offset" />
            <feComposite in="goo" in2="deep-offset" operator="out" result="deep-edge" />
            <feFlood flood-color="#1968c8" flood-opacity="0.6" result="deep-color" />
            <feComposite in="deep-color" in2="deep-edge" operator="in" result="deep-glow" />

            {/* 5. Merge liquid body + edge glows */}
            <feMerge>
              <feMergeNode in="goo" />
              <feMergeNode in="deep-glow" />
              <feMergeNode in="bottom-glow" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Liquid Gooey Container: Base Pill + Animated Wave Drops */}
      <div className="liquid-container">
        <div className="liquid-base" />
        <div className="wave-drop drop-1" />
        <div className="wave-drop drop-2" />
        <div className="wave-drop drop-3" />
      </div>

      {/* Top Glossy Highlight */}
      <div className="top-shine" />

      {/* Content Children */}
      <div className="relative z-10 flex size-full items-center justify-between px-3.5">
        {children}
      </div>
    </div>
  );
});
