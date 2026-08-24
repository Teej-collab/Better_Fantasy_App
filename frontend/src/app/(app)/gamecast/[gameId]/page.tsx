import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { getGameState } from "@/lib/gamecastApi";
import { GamecastShell } from "@/components/gamecast/GamecastShell";

export default async function GamecastPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const [game, me] = await Promise.all([getGameState(gameId), getMe(sessionCookie)]);

  if (!game) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <h1 className="text-xl font-semibold">Game not found</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          This game either hasn&apos;t started, has already been archived, or the link is wrong.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">
        {game.away_team.abbr} @ {game.home_team.abbr}
      </h1>
      <GamecastShell gameId={gameId} initialGame={game} isSignedIn={me !== null} />
    </div>
  );
}
