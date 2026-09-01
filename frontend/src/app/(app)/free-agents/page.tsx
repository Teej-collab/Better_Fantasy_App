import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getMe, getMyFreeAgents, getWaiverSettings } from "@/lib/api";
import { FreeAgentsList } from "@/components/FreeAgentsList";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";
import { PlayerSearchInput } from "@/components/PlayerSearchInput";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Free Agents — Weekend League" };

const POSITIONS = ["QB", "RB", "WR", "TE", "D/ST", "K"];

export default async function FreeAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ position?: string; search?: string }>;
}) {
  const { position, search } = await searchParams;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="freeAgents" />
        <div className="flex justify-center py-6">
          <SignInCard />
        </div>
      </div>
    );
  }

  const [players, waiverSettings] = await Promise.all([
    getMyFreeAgents(sessionCookie, position, search),
    getWaiverSettings(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <MyTeamSubNav active="freeAgents" />
      <h1 className="text-2xl font-semibold">Free Agents</h1>

      <p className="text-sm text-black/50 dark:text-white/50">
        Every player not currently on a roster in this league, sorted by real fantasy relevance. This league uses{" "}
        {waiverSettings.uses_faab ? `FAAB bidding ($${waiverSettings.acquisition_budget} budget)` : "standard waiver priority"}
        .
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <PlayerSearchInput />
      </div>

      <div className="flex flex-wrap gap-x-3 text-sm">
        <Link
          href={{ pathname: "/free-agents", query: search ? { search } : undefined }}
          className={
            !position ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"
          }
        >
          All
        </Link>
        {POSITIONS.map((p) => (
          <Link
            key={p}
            href={{ pathname: "/free-agents", query: { position: p, ...(search ? { search } : {}) } }}
            className={
              position === p ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"
            }
          >
            {p}
          </Link>
        ))}
      </div>

      <FreeAgentsList players={players} />
    </div>
  );
}
