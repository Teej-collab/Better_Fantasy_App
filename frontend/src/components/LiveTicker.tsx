/**
 * Auto-scrolling ticker strip. Plain server-renderable — the motion is
 * pure CSS (globals.css's .live-ticker-track), no client JS needed.
 * Items render twice back to back so the loop is seamless (same
 * technique as CardDeck's infinite scroll, just CSS-driven instead of
 * scroll-position-driven since this one auto-plays).
 */
export function LiveTicker({ items, fast = false }: { items: string[]; fast?: boolean }) {
  if (items.length === 0) return null;

  return (
    <div
      className={`ticker-shell overflow-hidden rounded-lg border border-black/10 bg-black dark:border-white/10 ${
        fast ? "ticker-shell--live" : ""
      }`}
    >
      <div className={`live-ticker-track py-2.5 ${fast ? "live-ticker-track--fast" : ""}`}>
        {[...items, ...items].map((item, i) => (
          <span key={i} className="mx-5 shrink-0 text-sm whitespace-nowrap text-white/90">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
