// The header brand mark — no logo image asset exists anywhere in this
// repo (frontend/public/ has none), and the brand has been CSS/text-
// based everywhere else it appears (LeagueWordmark.tsx is plain styled
// text, not an image, after an earlier SVG-mask "pen writes it" reveal
// was abandoned for rendering badly on real phones). This keeps that
// same discipline — a small monogram badge (the W/L identity, restrained
// rather than spelled out twice) plus the wordmark, not a new image
// asset — while reading a step more premium than the bare "WL"/
// "Weekend League" text it replaces.
export function BrandMark({ href }: { href: string }) {
  return (
    <a href={href} className="flex shrink-0 items-center gap-2 text-[color:var(--foreground)]">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-black"
        style={{ backgroundColor: "var(--wl-accent)" }}
        aria-hidden
      >
        W
      </span>
      {/* The monogram badge alone reads fine on its own at narrow
          widths — the full wordmark returns once there's room, same
          breakpoint the old bare-text brand mark used. */}
      <span className="hidden text-base font-semibold tracking-tight sm:inline">Weekend League</span>
    </a>
  );
}
