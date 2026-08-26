import { cookies } from "next/headers";
import { API_BASE_URL, awardsHrefFor, getMe, listSeasons, safeLatestSeason } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { KeepersPanel } from "@/components/KeepersPanel";

export default async function KeepersPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const [me, { seasons }] = await Promise.all([getMe(sessionCookie), listSeasons()]);
  const latestSeason = safeLatestSeason(seasons);

  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <LeagueSubNav active="keepers" awardsHref={awardsHrefFor(latestSeason)} />
        <h1 className="text-2xl font-semibold">Keepers</h1>
        <section className="neon-panel flex flex-col gap-2 rounded-xl p-4">
          <p className="text-sm text-black/60 dark:text-white/60">Sign in to pick your keepers.</p>
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

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="keepers" awardsHref={awardsHrefFor(latestSeason)} />
      <h1 className="text-2xl font-semibold">Keepers</h1>
      <KeepersPanel isCommissioner={me.is_commissioner} />
    </div>
  );
}
