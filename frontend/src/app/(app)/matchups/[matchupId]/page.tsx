import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getMatchup, getMe } from "@/lib/api";
import { PlayoffBadge } from "@/components/PlayoffBadge";
import { BenchCrimeBadge, ClutchChokeBadge, GameOfWeekBadge, RivalryBadge } from "@/components/matchups/MatchupBadges";
import type { MatchupContextSide } from "@/lib/api";
import { NarrativeSection } from "@/components/matchups/NarrativeSection";
import { HeadToHeadSection } from "@/components/matchups/HeadToHeadSection";
import { SignInCard } from "@/components/SignInCard";
import { WinProbabilityBar } from "@/components/matchups/WinProbabilityBar";
import { MatchupScoreHeader } from "@/components/matchups/MatchupScoreHeader";
import { MyTouchdownsSection } from "@/components/matchups/MyTouchdownsSection";
import { StarterComparisonTable } from "@/components/matchups/StarterComparisonTable";
import { BackButton } from "@/components/BackButton";

// Real per-page title (mobile audit finding) — matters most here since
// matchup pages are exactly the kind of link owners share with each
// other. getMatchup() is deduped against the identical call below.
// A non-member or a matchup that genuinely doesn't exist both come
// back as null (getServerOrNull) and both render as "not found" here,
// deliberately — never revealing that a specific matchup_id exists to
// someone not authorized to see it.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchupId: string }>;
}): Promise<Metadata> {
  const { matchupId } = await params;
  const sessionCookie = (await cookies()).get("session")?.value;
  const matchup = await getMatchup(Number(matchupId), sessionCookie);
  if (!matchup) return { title: "Matchup not found — Weekend League" };
  return {
    title: `${matchup.home.team_name} vs ${matchup.away.team_name} — Wk ${matchup.week} — Weekend League`,
  };
}

export default async function MatchupPage({
  params,
}: {
  params: Promise<{ matchupId: string }>;
}) {
  const { matchupId } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }

  const matchup = await getMatchup(Number(matchupId), sessionCookie);
  if (!matchup) notFound();
  const { home, away } = matchup;

  // Same "no meaningful 50/50 before kickoff" gate win_probability.py
  // itself enforces — both sides only ever come back non-null together.
  const hasWinProbability = home.win_probability !== null && away.win_probability !== null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackButton fallbackHref={`/seasons/${matchup.season}/weeks/${matchup.week}`} label="Matchups" />

        {(matchup.is_game_of_the_week || matchup.is_rivalry || matchup.is_playoff) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
            {matchup.is_game_of_the_week && <GameOfWeekBadge />}
            {matchup.is_rivalry && matchup.rivalry && <RivalryBadge rivalry={matchup.rivalry} />}
            {matchup.is_playoff && <PlayoffBadge />}
          </div>
        )}

        <h1 className="font-display text-2xl font-semibold tracking-wide uppercase">
          {matchup.season} — Week {matchup.week}
        </h1>

        <div className="mt-3">
          <MatchupScoreHeader home={home} away={away} />
        </div>

        {hasWinProbability && (
          <div className="mt-3">
            <WinProbabilityBar homeWinProbability={home.win_probability!} awayWinProbability={away.win_probability!} />
          </div>
        )}
      </div>

      <NarrativeSection narrative={matchup.narrative} />

      <MyTouchdownsSection
        homeName={home.team_name}
        awayName={away.team_name}
        homeTouchdowns={home.touchdowns}
        awayTouchdowns={away.touchdowns}
      />

      {(home.clutch_choke || home.bench_crime || away.clutch_choke || away.bench_crime) && (
        <div className="neon-panel grid grid-cols-1 gap-4 rounded-lg p-4 sm:grid-cols-2">
          <TeamDetailSummary side={home} />
          <TeamDetailSummary side={away} />
        </div>
      )}

      <div className="neon-panel rounded-lg p-4">
        <HeadToHeadSection headToHead={matchup.head_to_head} home={home} away={away} />
      </div>

      <div className="neon-panel rounded-lg p-4">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          Starting Lineups
        </h2>
        <StarterComparisonTable home={home.roster} away={away.roster} />
      </div>
    </div>
  );
}

// Reuses the same badges TeamSummary.tsx renders for the accordion,
// just without the record/streak/projected line (already shown in the
// header above on this page) — this is specifically the bench-crime/
// clutch-choke callout row.
function TeamDetailSummary({ side }: { side: MatchupContextSide }) {
  if (!side.clutch_choke && !side.bench_crime) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        {side.team_name}
      </span>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {side.clutch_choke && <ClutchChokeBadge status={side.clutch_choke} />}
        {side.bench_crime && <BenchCrimeBadge crime={side.bench_crime} />}
      </div>
    </div>
  );
}
