import type { TickerItem } from "@/lib/api";

/**
 * Auto-scrolling ticker strip. Plain server-renderable — the motion is
 * pure CSS (globals.css's .live-ticker-track), no client JS needed.
 * Items render twice back to back so the loop is seamless (same
 * technique as CardDeck's infinite scroll, just CSS-driven instead of
 * scroll-position-driven since this one auto-plays).
 *
 * Each item is a run of segments (lib/api.ts's TickerItem) rather than
 * a plain string — a team-name segment carries that team's own color
 * (see buildNflTickerItems), everything else renders in the ticker's
 * default white. A plain-text item is just one uncolored segment.
 */
export function LiveTicker({ items, fast = false }: { items: TickerItem[]; fast?: boolean }) {
  if (items.length === 0) return null;

  return (
    <div
      className={`ticker-shell overflow-hidden rounded-lg border border-black/10 bg-black dark:border-white/10 ${
        fast ? "ticker-shell--live" : ""
      }`}
    >
      <div className={`live-ticker-track py-2.5 ${fast ? "live-ticker-track--fast" : ""}`}>
        {[...items, ...items].map((item, i) => (
          <span key={`${item.key}-${i}`} className="mx-5 shrink-0 text-sm whitespace-nowrap text-white/90">
            {item.segments.map((seg, j) => (
              <span key={j} style={seg.color ? { color: seg.color, fontWeight: 600 } : undefined}>
                {seg.text}
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
