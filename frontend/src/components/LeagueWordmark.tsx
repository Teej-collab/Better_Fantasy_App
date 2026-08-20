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
 * Clipping fix: the Satisfy "L" swash overhangs to the left and the "g"
 * tail drops below the text's own bounding box. Oversizing the <rect>
 * and the glow <filter> region alone isn't enough — an SVG <mask> has
 * its OWN region (the mask element's x/y/width/height, separate from
 * anything drawn inside it), which defaults to just -10%/-10%/120%/120%
 * of the viewport when maskUnits="userSpaceOnUse" and is left
 * unspecified. That default region — not the oversized rect — was what
 * was actually chopping the swash and tail. Fixed by explicitly sizing
 * the <mask> element itself to match the oversized rect.
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
    <svg className="wl-league-svg" viewBox="0 0 520 250" role="img" aria-label="League">
      <defs>
        {/* Feather the reveal edge so ink flows on smoothly. The region is
            deliberately huge so the tall stroke is never clipped to a band. */}
        <filter id="wl-mask-soft" x="-40%" y="-500%" width="180%" height="1100%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>

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
            how big the rect/path drawn inside the mask are. */}
        <mask id="wl-league-mask" maskUnits="userSpaceOnUse" x="-260" y="-260" width="1040" height="770">
          {/* black hides, white reveals — sized far past the glyphs so the
              mask never clips the swash or descender. */}
          <rect x="-260" y="-260" width="1040" height="770" fill="black" />
          <path
            className={reducedMotion ? "wl-pen-stroke wl-pen-stroke--static" : "wl-pen-stroke"}
            d={PEN_PATH}
            pathLength={1}
            fill="none"
            stroke="white"
            strokeWidth={230}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#wl-mask-soft)"
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
