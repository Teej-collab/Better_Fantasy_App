import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { LeagueBetsApp, type LeagueTab } from "@/components/bets/league/LeagueBetsApp";

export const metadata: Metadata = { title: "League Bets — The Weekend" };

// League Bets: every bet shared in your league and who placed it.
// Tracking only; never any wager or payout.
export default async function LeagueBetsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, cookieStore] = await Promise.all([searchParams, cookies()]);
  const me = await getMe(cookieStore.get("session")?.value);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  const initialTab: LeagueTab = tab === "board" || tab === "games" ? tab : "feed";
  return <LeagueBetsApp initialTab={initialTab} />;
}
