import Link from "next/link";
import type { MatchupContextSide } from "@/lib/api";
import { BenchCrimeBadge, ClutchChokeBadge } from "@/components/matchups/MatchupBadges";

// Shared by MatchupCard.tsx's accordion and the full matchup detail
// page — team/owner identity, record, streak, projected total, and
// (now that MatchupContextSide carries them for both surfaces) a
// bench-crime or clutch/choke badge when this team's week actually
// earned one. A team never gets both — clutch/choke is about the
// final result, bench crime is about a lineup mistake; showing
// whichever's present is enough context without cluttering the card.
export function TeamSummary({ side }: { side: MatchupContextSide }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <Link href={`/teams/${side.team_id}`} className="font-medium hover:underline">
        {side.team_name}
      </Link>
      <Link href={`/owners/${side.owner_id}`} className="text-black/50 hover:underline dark:text-white/50">
        {side.owner_name}
      </Link>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-black/60 dark:text-white/60">
        {side.record && <span>{side.record}</span>}
        {side.streak !== "neutral" && (
          <span>{side.streak === "hot" ? "\u{1F525} Hot streak" : "\u{1F976} Cold streak"}</span>
        )}
        {side.projected_total !== null && <span>Proj {side.projected_total.toFixed(1)}</span>}
      </div>
      {(side.clutch_choke || side.bench_crime) && (
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
          {side.clutch_choke && <ClutchChokeBadge status={side.clutch_choke} />}
          {side.bench_crime && <BenchCrimeBadge crime={side.bench_crime} />}
        </div>
      )}
    </div>
  );
}
