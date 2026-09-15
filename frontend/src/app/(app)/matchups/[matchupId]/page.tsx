import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getMatchup, getMe, getWeekMatchupContext } from "@/lib/api";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { BackButton } from "@/components/BackButton";
import { MatchupCarousel } from "@/components/matchups/MatchupCarousel";

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
  if (me.active_league_id === null) {
    return <NeedsLeagueCard />;
  }

  const matchup = await getMatchup(Number(matchupId), sessionCookie);
  if (!matchup) notFound();

  // The whole week's matchups, full rosters included — the exact same
  // call the week page itself makes. MatchupCarousel renders one panel
  // per entry and swipes between them client-side with zero further
  // fetches, rather than this page only ever knowing about the single
  // matchup it was linked to.
  const { matchups: weekMatchups } = await getWeekMatchupContext(matchup.season, matchup.week, sessionCookie);

  return (
    <div className="flex flex-col gap-3">
      <BackButton fallbackHref={`/seasons/${matchup.season}/weeks/${matchup.week}`} label="Matchups" />
      <h1 className="font-display text-2xl font-semibold tracking-wide uppercase">
        {matchup.season} — Week {matchup.week}
      </h1>
      <MatchupCarousel matchups={weekMatchups} initialMatchupId={matchup.matchup_id} />
    </div>
  );
}
