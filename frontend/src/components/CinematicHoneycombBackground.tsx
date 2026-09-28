import type { CSSProperties } from "react";

type Props = {
  /** Multiplies every layer's opacity. 1 is the tuned default; drop it
   *  (e.g. 0.6) anywhere the pattern competes with dense content. */
  intensity?: number;
  /** false freezes the breathing, same as reduced motion. */
  animated?: boolean;
  /** Overrides the owner's Settings > Appearance > Background choice
   *  (--honeycomb-color, set on <html> by app/layout.tsx). */
  color?: string;
  /** Where the glow and the breathing wave center, as viewport
   *  percentages. Slightly above center reads best behind page
   *  headings. */
  focal?: { x: number; y: number };
  /** Seconds per full breath (dim → bright → dim). */
  duration?: number;
};

/**
 * The breathing honeycomb behind every page — mounted once in
 * RootLayout, same fixed/negative-z/pointer-events:none pattern as
 * .cosmic-ambient. Pure CSS (globals.css's .hc-* rules): the hex
 * pattern is a tiny SVG used as a mask over a flat --hc-color fill,
 * which is what lets each owner's color choice apply without
 * regenerating any image. The only animated properties are opacity
 * and transform, so the browser runs the whole thing on the
 * compositor — no JS, no re-renders, no per-frame work on the main
 * thread.
 *
 * Layers, back to front: a black base with a faint charcoal lift at
 * the focal point; a static dim honeycomb (the floor it never drops
 * below) under a radial vignette; then two breathing copies — a
 * center disc and an outer ring whose cycle starts ~1s later, which
 * is what makes the brightening read as spreading outward rather than
 * the whole screen pulsing at once.
 */
export function CinematicHoneycombBackground({
  intensity = 1,
  animated = true,
  color,
  focal = { x: 50, y: 40 },
  duration = 6,
}: Props) {
  const style = {
    "--hc-intensity": intensity,
    "--hc-x": `${focal.x}%`,
    "--hc-y": `${focal.y}%`,
    "--hc-duration": `${duration}s`,
    ...(color ? { "--hc-color": color } : {}),
  } as CSSProperties;

  return (
    <div className={`hc-bg${animated ? "" : " hc-bg--static"}`} style={style} aria-hidden>
      <div className="hc-surface">
        <div className="hc-layer hc-layer--base" />
        <div className="hc-layer hc-layer--wave-inner" />
        <div className="hc-layer hc-layer--wave-outer" />
      </div>
    </div>
  );
}
