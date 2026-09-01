import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { API_BASE_URL, awardsHrefFor, getMe, listSeasons, safeLatestSeason } from "@/lib/api";
import { listPlayers } from "@/lib/playerCardApi";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { PlayerResearchList } from "@/components/PlayerResearchList";
import { PlayerSearchInput } from "@/components/PlayerSearchInput";

export const metadata: Metadata = { title: "Player Research — Weekend League" };

const POSITIONS = ["QB", "RB", "WR", "TE", "D/ST", "K"];

/**
 * Real, browsable/sortable NFL player research — every draftable
 * player, rostered or not, sorted by real fantasy relevance
 * (search_rank), with position filter and name search. Added
 * 2026-09-01: the app already had rich per-player data
 * (PlayerCardModal — bio, projection, % owned, draft rank, news) but
 * only reachable one player at a time via a click-to-open modal, no
 * page to browse across the whole pool — a real gap against ESPN/
 * Yahoo/Sleeper's own player-research pages (2026-08-31 audit). Not to
 * be confused with /players ("Player Cards" — this league's own
 * owners' trading cards, a different feature entirely).
 */
export default async function PlayerResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ position?: string; search?: string }>;
}) {
  const { position, search } = await searchParams;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const [me, { seasons }] = await Promise.all([getMe(sessionCookie), listSeasons()]);
  const latestSeason = safeLatestSeason(seasons);

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="playerResearch" awardsHref={awardsHrefFor(latestSeason)} />
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-wide uppercase">Player Research</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Every real NFL player, sorted by fantasy relevance — rostered or not.
        </p>
      </div>

      {!me ? (
        <section className="neon-panel flex flex-col gap-2 rounded-xl p-4">
          <p className="text-sm text-black/60 dark:text-white/60">Sign in to browse player research.</p>
          <a
            href={`${API_BASE_URL}/auth/discord/login`}
            target="_blank"
            rel="noopener"
            className="w-fit rounded-full bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752c4]"
          >
            Sign in with Discord
          </a>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <PlayerSearchInput />
          </div>

          <div className="flex flex-wrap gap-x-3 text-sm">
            <Link
              href={{ pathname: "/player-research", query: search ? { search } : undefined }}
              className={!position ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"}
            >
              All
            </Link>
            {POSITIONS.map((p) => (
              <Link
                key={p}
                href={{ pathname: "/player-research", query: { position: p, ...(search ? { search } : {}) } }}
                className={
                  position === p ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"
                }
              >
                {p}
              </Link>
            ))}
          </div>

          <PlayerResearchListLoader position={position} search={search} sessionCookie={sessionCookie} />
        </>
      )}
    </div>
  );
}

async function PlayerResearchListLoader({
  position,
  search,
  sessionCookie,
}: {
  position?: string;
  search?: string;
  sessionCookie?: string;
}) {
  const players = await listPlayers({ position, search, sessionCookie });
  return <PlayerResearchList players={players} />;
}
