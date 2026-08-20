import { buildNflTickerItems, getIsGameDay, getNflScoreboard } from "@/lib/api";
import { LiveTicker } from "@/components/LiveTicker";

/**
 * The persistent site-wide ticker — used only by app/(app)/layout.tsx,
 * i.e. every page except / (which renders its own richer, contextual
 * ticker — see app/(home)/page.tsx) and /weekend (outside both route
 * groups entirely, gets no ticker at all). Real NFL data, not the
 * homepage's awards/rivalries/standings mix, since that only makes
 * sense in the homepage's own context.
 */
export async function AppTickerBar() {
  const [nflGames, isGameDay] = await Promise.all([getNflScoreboard(), getIsGameDay()]);
  return (
    <div className="safe-px mx-auto w-full max-w-4xl pt-3">
      <LiveTicker items={buildNflTickerItems(nflGames)} fast={isGameDay} />
    </div>
  );
}
