import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { LeagueGameView } from "@/components/bets/league/LeagueGameView";

export const metadata: Metadata = { title: "Riding on this game — The Weekend" };

export default async function LeagueBetGamePage({ params }: { params: Promise<{ eventId: string }> }) {
  const [{ eventId }, cookieStore] = await Promise.all([params, cookies()]);
  const me = await getMe(cookieStore.get("session")?.value);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  return <LeagueGameView eventId={decodeURIComponent(eventId)} />;
}
