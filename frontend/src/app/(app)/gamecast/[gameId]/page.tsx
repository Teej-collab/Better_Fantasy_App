import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe, getMyPreferences, getNflScoreboard } from "@/lib/api";
import { findGamecastId, getGameState, getLiveGames } from "@/lib/gamecastApi";
import { GamecastShell } from "@/components/gamecast/GamecastShell";
import { BackButton } from "@/components/BackButton";
import { TrackedGamecastLink } from "@/components/gamecast/TrackedGamecastLink";

// Real per-page title (mobile audit finding). getGameState() is
// deduped against the identical call in the page component below.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const game = await getGameState(gameId);
  if (!game) return { title: "Game not found — Weekend League" };
  return { title: `${game.away_team.abbr} @ ${game.home_team.abbr} — Gamecast — Weekend League` };
}

export default async function GamecastPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const [game, me, myPreferences, nflGames, gamecastGames] = await Promise.all([
    getGameState(gameId),
    getMe(sessionCookie),
    getMyPreferences(sessionCookie),
    // Same two calls the Gamecast hub page already fetches for its own
    // "Live now" group — reused here (not a new endpoint) so this page
    // can offer a direct switcher to another live game, per a real
    // report: switching games meant backing all the way out to the hub
    // and finding the other game again from scratch.
    getNflScoreboard(),
    getLiveGames(),
  ]);

  // Every OTHER currently-live game that has a real Gamecast (no point
  // offering a link into a game with no play-by-play coverage) — same
  // join the hub page's own GameRow already does, just filtered down
  // to "live" and excluding the game already being viewed.
  const otherLiveGames = nflGames
    .filter((g) => g.state === "in" && g.home_team && g.away_team)
    .map((g) => ({ ...g, gamecastId: findGamecastId(g.home_team, g.away_team, gamecastGames) }))
    .filter(
      (g): g is typeof g & { gamecastId: string } => g.gamecastId !== null && g.gamecastId !== gameId
    );

  if (!game) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <BackButton fallbackHref="/gamecast" label="Gamecast" />
        <h1 className="text-xl font-semibold">Game not found</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          This game either hasn&apos;t started, has already been archived, or the link is wrong.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BackButton fallbackHref="/gamecast" label="Gamecast" />
      <h1 className="text-2xl font-semibold">
        {game.away_team.abbr} @ {game.home_team.abbr}
      </h1>
      {otherLiveGames.length > 0 && (
        <nav
          aria-label="Switch to another live game"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          {otherLiveGames.map((g) => (
            <TrackedGamecastLink
              key={g.id}
              gamecastId={g.gamecastId}
              href={`/gamecast/${g.gamecastId}`}
              className="neon-navlink flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              <span className="live-dot" aria-hidden />
              {g.away_team} @ {g.home_team}
            </TrackedGamecastLink>
          ))}
        </nav>
      )}
      <GamecastShell
        gameId={gameId}
        initialGame={game}
        isSignedIn={me !== null}
        beta={Boolean(myPreferences?.beta_layout)}
      />
    </div>
  );
}
