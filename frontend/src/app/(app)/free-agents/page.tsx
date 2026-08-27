import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { API_BASE_URL, getMe, getMyFreeAgents, getWaiverSettings } from "@/lib/api";
import { FreeAgentsList } from "@/components/FreeAgentsList";
import { MyTeamSubNav } from "@/components/nav/MyTeamSubNav";

export const metadata: Metadata = { title: "Free Agents — Weekend League" };

const POSITIONS = ["QB", "RB", "WR", "TE", "D/ST", "K"];

export default async function FreeAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ position?: string }>;
}) {
  const { position } = await searchParams;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <MyTeamSubNav active="freeAgents" />
        <h1 className="text-2xl font-semibold">Free Agents</h1>
        <section className="neon-panel flex flex-col gap-2 rounded-xl p-4">
          <p className="text-sm text-black/60 dark:text-white/60">Sign in to browse and add free agents.</p>
          <a
            href={`${API_BASE_URL}/auth/discord/login`}
            className="w-fit rounded-full bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752c4]"
          >
            Sign in with Discord
          </a>
        </section>
      </div>
    );
  }

  const [players, waiverSettings] = await Promise.all([getMyFreeAgents(position), getWaiverSettings()]);

  return (
    <div className="flex flex-col gap-4">
      <MyTeamSubNav active="freeAgents" />
      <h1 className="text-2xl font-semibold">Free Agents</h1>

      <p className="text-sm text-black/50 dark:text-white/50">
        Every player not currently on a roster in this league, sorted by real fantasy relevance. This league uses{" "}
        {waiverSettings.uses_faab ? `FAAB bidding ($${waiverSettings.acquisition_budget} budget)` : "standard waiver priority"}
        .
      </p>

      <div className="flex flex-wrap gap-x-3 text-sm">
        <Link
          href="/free-agents"
          className={
            !position ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"
          }
        >
          All
        </Link>
        {POSITIONS.map((p) => (
          <Link
            key={p}
            href={`/free-agents?position=${encodeURIComponent(p)}`}
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
