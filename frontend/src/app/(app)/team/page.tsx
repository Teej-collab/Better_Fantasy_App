import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe, getMyPreferences, getMyTeamOwnershipServer, getMyTeamServer, getNflScoreboard, isNflGameLive } from "@/lib/api";
import { MyTeamApp } from "@/components/MyTeamApp";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "My Team — Weekend League" };

export default async function MyTeamPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  // Everything is fetched alongside getMe rather than after it — each
  // fetcher here returns null (never throws) without a signed-in
  // session, so running them speculatively is safe, and it saves the
  // page a whole backend round trip. Ownership is server-fetched here
  // too (not left to MyTeamApp's own mount effect) so the "% owned"
  // line never appears after hydration — that was adding height to
  // every roster row post-paint, the dominant cause of a reported
  // layout shift on this page (2026-09 mobile audit). The NFL
  // scoreboard is the one fetch that does real work without a session,
  // so it's skipped for a visitor with no session cookie at all.
  const [me, team, ownership, nflGames, myPreferences] = await Promise.all([
    getMe(sessionCookie),
    getMyTeamServer(sessionCookie),
    getMyTeamOwnershipServer(sessionCookie),
    sessionCookie ? getNflScoreboard() : Promise.resolve([]),
    getMyPreferences(sessionCookie),
  ]);

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="team" />
        <div className="flex justify-center py-6">
          <SignInCard />
        </div>
      </div>
    );
  }
  if (me.active_league_id === null) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="team" />
        <NeedsLeagueCard />
      </div>
    );
  }

  const isGameDay = isNflGameLive(nflGames);

  return (
    <div className="flex flex-col gap-4">
      <MyTeamSubNav active="team" />
      <MyTeamApp
        isGameDay={isGameDay}
        initialTeam={team}
        initialOwnership={ownership}
        beta={Boolean(myPreferences?.beta_layout)}
      />
    </div>
  );
}
