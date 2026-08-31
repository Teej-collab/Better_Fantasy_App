import type { Metadata } from "next";
import { cookies } from "next/headers";
import { API_BASE_URL, getMe, getNflScoreboard, isNflGameLive } from "@/lib/api";
import { MyTeamApp } from "@/components/MyTeamApp";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";

export const metadata: Metadata = { title: "My Team — Weekend League" };

export default async function MyTeamPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="team" />
        <h1 className="text-2xl font-semibold">My Team</h1>
        <section className="neon-panel flex flex-col gap-2 rounded-xl p-4">
          <p className="text-sm text-black/60 dark:text-white/60">Sign in to see your team.</p>
          <a
            href={`${API_BASE_URL}/auth/discord/login`}
            target="_blank"
            rel="noopener"
            className="w-fit rounded-full bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752c4]"
          >
            Sign in with Discord
          </a>
        </section>
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
