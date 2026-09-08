import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe, getMyPreferences } from "@/lib/api";
import { getGameState } from "@/lib/gamecastApi";
import { GamecastShell } from "@/components/gamecast/GamecastShell";
import { BackButton } from "@/components/BackButton";

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

  const [game, me, myPreferences] = await Promise.all([
    getGameState(gameId),
    getMe(sessionCookie),
    getMyPreferences(sessionCookie),
  ]);

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
      <GamecastShell
        gameId={gameId}
        initialGame={game}
        isSignedIn={me !== null}
        beta={Boolean(myPreferences?.beta_layout)}
      />
    </div>
  );
}
