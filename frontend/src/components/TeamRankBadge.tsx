// NCAAF-style "#3" power-rank badge, dropped inline next to a team
// name. Deliberately quiet/neutral (not tied to SECTION_COLORS'
// power-rankings accent) so it doesn't compete with a page's real
// status badges (Champion, League Loser, playoff line) for attention —
// it's a secondary signal, not the headline.
//
// 2026-09-17: now shows up everywhere a team name does (Your Week
// hero, the matchup header, Other Matchups, Standings), not just
// Standings — `variant="dark"` is for the one spot (Your Week's hero
// card) that's a fixed dark gradient regardless of the app's own
// light/dark theme, where the default `dark:` variant classes below
// never apply since there's no real `dark` class on <html> to trigger
// them.
export function TeamRankBadge({
  rank,
  variant = "default",
}: {
  rank: number | null | undefined;
  variant?: "default" | "dark";
}) {
  if (!rank) return null;
  return (
    <span
      className={
        "ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums " +
        (variant === "dark" ? "bg-white/10 text-white/60" : "bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50")
      }
      title={`Power rank #${rank}`}
    >
      #{rank}
    </span>
  );
}
