import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getMatchup, getMe } from "@/lib/api";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { MatchupPageBeta } from "@/components/matchups/MatchupPageBeta";

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

  return <MatchupPageBeta matchup={matchup} />;
}
