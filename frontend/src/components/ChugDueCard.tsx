import type { ChugLeaderboardRow } from "@/lib/api";
import { ChugUpload } from "@/components/ChugUpload";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

function dueSummary(row: ChugLeaderboardRow): string {
  if (row.fined_owed > 0) return `🍺 $${row.fine_amount} fine outstanding (${row.fined_owed} chugs)`;
  if (row.outstanding_owed > 0) return `🍺 ${row.outstanding_owed} chug${row.outstanding_owed === 1 ? "" : "s"} owed`;
  return "🍺 All caught up";
}

/**
 * Homepage counterpart to ChugUpload — same upload flow (variant="bare"
 * skips its own outer panel so it doesn't nest inside this one), with
 * the signed-in owner's own balance as a header above it so the two
 * things the request asked for (what's due, and a way to pay it down)
 * live in the same tap. `summary` is this owner's own row from the
 * season's chug leaderboard, filtered by owner_id server-side in
 * (home)/page.tsx — no dedicated "my balance" endpoint exists, and
 * filtering the existing leaderboard response matches how this page
 * already handles otherMatchups.
 */
export function ChugDueCard({ summary }: { summary: ChugLeaderboardRow }) {
  return (
    <section
      className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]"
      style={panelGlowStyle(SECTION_COLORS.chug)}
    >
      <div>
        <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Chug</span>
        <p className="text-sm font-medium">{dueSummary(summary)}</p>
      </div>
      <ChugUpload variant="bare" />
    </section>
  );
}
