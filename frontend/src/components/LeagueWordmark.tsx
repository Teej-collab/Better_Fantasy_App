/**
 * "League" — the handwritten script under the shouted WEEKEND neon.
 *
 * Three rounds of an SVG <mask>-based "pen writes it in" reveal
 * (real Satisfy glyphs, an animated stroke-dashoffset mask, a glowing
 * nib riding the tip) all failed to fix a real, user-reported bug: the
 * "L" rendered cut off on a real phone. Each round made the mask/
 * viewBox region more generous and removed a filter suspected of being
 * the cause — confirmed each change was actually reaching the device
 * (a fresh cache, a real screenshot) — and NONE of it changed what
 * rendered at all. That's strong evidence the SVG masking machinery was
 * never the actual cause, not that the fix needed to be more aggressive.
 *
 * Replaced entirely with the same plain-HTML-text + CSS text-shadow
 * technique the WEEKEND heading right above it already uses —
 * genuinely proven reliable all session, on every device, because
 * there's no SVG viewBox/mask/filter region for a phone's renderer to
 * disagree with anyone else about. A real <p> element can't be "clipped"
 * by anything here; nothing in this component's own ancestry constrains
 * its size. Trades away the pen-drawing animation for something that
 * is simply guaranteed not to have this entire class of bug again.
 */
export function LeagueWordmark({ className }: { className?: string }) {
  return (
    <p className={`wl-league ${className ?? ""}`} aria-label="League">
      League
    </p>
  );
}
