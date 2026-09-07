// NCAAF-style "#3" power-rank badge, dropped inline next to a team
// name. Deliberately quiet/neutral (not tied to SECTION_COLORS'
// power-rankings accent) so it doesn't compete with a page's real
// status badges (Champion, League Loser, playoff line) for attention —
// it's a secondary signal, not the headline.
export function TeamRankBadge({ rank }: { rank: number | null | undefined }) {
  if (!rank) return null;
  return (
    <span
      className="ml-1.5 inline-flex items-center rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-black/50 dark:bg-white/10 dark:text-white/50"
      title={`Power rank #${rank}`}
    >
      #{rank}
    </span>
  );
}
