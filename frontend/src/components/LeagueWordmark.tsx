/**
 * "League" — the handwritten script under the shouted WEEKEND neon.
 *
 * Rendered as a light neon-blue lit tube: a bright blue-white core with a
 * soft blue bloom that feathers into the dark scene, so it reads as part
 * of the same continuous sign rather than a word pasted on top.
 *
 * A genuine "gets written in" effect:
 *
 *   - The real Satisfy webfont renders the word, so it stays perfectly
 *     legible (no hand-traced glyph paths guessed at).
 *   - An SVG <mask> holds a single thick pen stroke that sweeps across
 *     the whole word in reading order. Animating its stroke-dashoffset
 *     from hidden to fully drawn uncovers the ink exactly in the order a
 *     hand would write it.
 *   - A glowing nib (SMIL animateMotion) rides the tip of that stroke,
 *     so you see the pen laying the ink down.
 *
 * Clipping fix (round 1): the Satisfy "L" swash overhangs to the left
 * and the "g" tail drops below the text's own bounding box. Oversizing
 * the <rect> and the glow <filter> region alone isn't enough — an SVG
 * <mask> has its OWN region (the mask element's x/y/width/height,
 * separate from anything drawn inside it), which defaults to just
 * -10%/-10%/120%/120% of the viewport when maskUnits="userSpaceOnUse"
 * and is left unspecified. That default region — not the oversized
 * rect — was what was actually chopping the swash and tail. Fixed by
 * explicitly sizing the <mask> element itself to match the oversized
 * rect.
 *
 * Clipping fix (round 2): round 1 fixed it on desktop but not on a real
 * phone — the "L" was still cut off there. Root cause: this relied on
 * `overflow: visible` on the outer <svg> (globals.css's .wl-league-svg)
 * to let the mask/glow paint past the viewBox edge, but mobile Safari
 * has long-standing, inconsistent support for that — especially with a
 * CSS transform on an ancestor, which .wl-league-wrap's settle
 * animation has. Desktop tolerates it; iOS doesn't. Padded the viewBox
 * itself instead of leaning on overflow:visible working at all.
 *
 * Clipping fix (round 3): round 2's padding still wasn't enough on a
 * real phone (confirmed via a real screenshot, not guessed). Two
 * changes: the viewBox padding is now substantially larger again
 * (960x510 instead of 780x430 — the original 520x250 window now sits
 * inside a canvas nearly 2x its own size on every side), and the pen
 * stroke's own blur filter (wl-mask-soft) is removed entirely — a
 * <filter> applied to content *inside* an SVG <mask> is exactly the
 * kind of nested-effect combination iOS Safari has known bugs with,
 * and it was also the most likely thing quietly eroding the mask's
 * reveal right at the edge of the thin swash tip, which is the one
 * part of the glyph that had the least margin for error. The stroke
 * edge is very slightly harder without the feather; the word stays a
 * lit, legible neon tube regardless since the glow filter on the text
 * itself is untouched.
 *
 * prefers-reduced-motion (and returning visitors) get the finished word
 * with no pen and no mask — instant, per the brief's escape hatches.
 */

// The pen path sweeps the FULL width of the artboard (well past where the
// glyphs start and end) and wanders vertically, so every part of every
// letter — including the tall "L" swash and the dropped "g" tail — passes
// under the wide stroke and gets revealed.
const PEN_PATH = "M-20 130 C90 104 170 152 270 128 C370 104 450 148 540 126";

export function LeagueWordmark({
  fontFamily,
  reducedMotion = false,
}: {
  fontFamily: string;
  reducedMotion?: boolean;
}) {
  return (
    <svg className="wl-league-svg" viewBox="-220 -130 960 510" role="img" aria-label="League">
      <defs>
        {/* Neon-tube glow matching WEEKEND, in light blue: two blur passes
            bloom outward from the glyph alpha and feather into the
            background, with the bright core on top. Follows the letter
            shapes, never a rectangular box. Oversized region so the L
            swash and g tail keep their glow. */}
        <filter id="wl-league-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="7" result="b2" />
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="b1" />
          <feColorMatrix in="b2" type="matrix" values="0 0 0 0 0.30  0 0 0 0 0.72  0 0 0 0 1  0 0 0 0.55 0" result="g2" />
          <feColorMatrix in="b1" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.85  0 0 0 0 1  0 0 0 0.9 0" result="g1" />
          <feMerge>
            <feMergeNode in="g2" />
            <feMergeNode in="g1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* x/y/width/height set explicitly and oversized — this is the
            fix. Without them, maskUnits="userSpaceOnUse" still defaults
            the MASK'S OWN region to -10%/-10%/120%/120% of the SVG
            viewport, which clips the L swash and g tail regardless of
            how big the rect/path drawn inside the mask are. Sized well
            past the (also oversized) viewBox with real margin. */}
        <mask id="wl-league-mask" maskUnits="userSpaceOnUse" x="-320" y="-320" width="1200" height="900">
          {/* black hides, white reveals — sized far past the glyphs so the
              mask never clips the swash or descender. */}
          <rect x="-320" y="-320" width="1200" height="900" fill="black" />
          {/* No blur filter here (round 3 removed it) — a wider, harder-
              edged stroke instead, both to de-risk WebKit's filter-inside-
              mask bugs and because the unfiltered stroke can't have its
              effective coverage quietly eroded at the edge the way a
              blurred one could. */}
          <path
            className={reducedMotion ? "wl-pen-stroke wl-pen-stroke--static" : "wl-pen-stroke"}
            d={PEN_PATH}
            pathLength={1}
            fill="none"
            stroke="white"
            strokeWidth={260}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>

      {/* The legible word, revealed through the pen mask. A bright
          blue-white core makes it read as a lit neon tube. Centered with
          padding on all sides so the swash/tail have room. */}
      <text
        x="262"
        y="140"
        textAnchor="middle"
        fontFamily={fontFamily}
        fontSize="86"
        fill="#e2f4ff"
        filter="url(#wl-league-glow)"
        mask="url(#wl-league-mask)"
      >
        League
      </text>

      {/* The pen nib — a bright bead of light laying the ink down. */}
      {!reducedMotion && (
        <g className="wl-nib" opacity="0">
          <circle r="6" className="wl-nib-glow" />
          <circle r="2.4" className="wl-nib-core" />
          <animateMotion
            dur="1.5s"
            begin="0.15s"
            fill="freeze"
            calcMode="spline"
            keyTimes="0;1"
            keySplines="0.4 0 0.3 1"
            path={PEN_PATH}
          />
          {/* fade the nib out once the word is written */}
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.85;1" dur="1.7s" begin="0.15s" fill="freeze" />
        </g>
      )}
    </svg>
  );
}
