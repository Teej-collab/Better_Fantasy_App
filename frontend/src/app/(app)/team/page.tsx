import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe, getNflScoreboard, isNflGameLive } from "@/lib/api";
import { MyTeamApp } from "@/components/MyTeamApp";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "My Team — Weekend League" };

export default async function MyTeamPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);

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

  // Only fetched once actually signed in — the signed-out prompt above
  // has no use for it, and Next's per-request fetch memoization means
  // this doesn't cost a second round trip anywhere else this same
  // request already calls getNflScoreboard() (it doesn't, today).
  const nflGames = await getNflScoreboard();
  const isGameDay = isNflGameLive(nflGames);

  return (
    <div className="flex flex-col gap-4">
      <MyTeamSubNav active="team" />
      <MyTeamApp isGameDay={isGameDay} />
    </div>
  );
}
