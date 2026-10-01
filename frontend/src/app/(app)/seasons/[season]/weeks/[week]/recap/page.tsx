import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getMe, getWeeklyRecap } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { RecapOpenTracker } from "@/components/RecapOpenTracker";
import { SignInCard } from "@/components/SignInCard";
import { DESTINATIONS } from "@/lib/navDestinations";
import { panelGlowStyle } from "@/lib/sectionColors";

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }): Promise<Metadata> {
  const { week } = await params;
  return { title: `Week ${week} Recap — Weekend League` };
}

/**
 * One week's recap, in full — where the Tuesday-flip "Week N Recap LIVE
 * NOW" push lands (backend/app/notifications/formatter.py's
 * weekly_recap_live, `?from=push`) and where Home's recap card links.
 * Every visit is recorded for Admin > Recaps.
 */
export default async function WeekRecapPage({
  params,
  searchParams,
}: {
  params: Promise<{ season: string; week: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ season, week }, { from }] = await Promise.all([params, searchParams]);
  const seasonNum = Number(season);
  const weekNum = Number(week);
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  if (me.active_league_id === null) {
    return <NeedsLeagueCard />;
  }

  const { narrative } = await getWeeklyRecap(seasonNum, weekNum, sessionCookie).catch(() => ({ narrative: null }));
  const recap = narrative?.kind === "recap" ? narrative : null;
  const color = DESTINATIONS.awards.color;

  return (
    <div className="flex flex-col gap-4">
      <BackButton fallbackHref="/" label="Home" />
      <span className="text-xs font-bold tracking-wide uppercase" style={{ color }}>
        📰 Week {weekNum} Recap
      </span>
      {!recap ? (
        <div className="neon-panel flex flex-col gap-2 rounded-xl p-5" style={panelGlowStyle(color)}>
          <h1 className="text-lg font-semibold">Not out yet</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            The Week {weekNum} recap goes live when the league flips on Tuesday. You&apos;ll get a notification the moment it does.
          </p>
          <Link href="/" className="text-sm font-medium" style={{ color }}>
            ← Back to Home
          </Link>
        </div>
      ) : (
        <article className="neon-panel flex flex-col gap-3 rounded-xl p-5" style={panelGlowStyle(color)}>
          {recap.released === false && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              Commissioner preview — this goes live for the league at the Tuesday flip.
            </p>
          )}
          <p className="text-base leading-relaxed whitespace-pre-line text-black/80 dark:text-white/80">{recap.text.trim()}</p>
          <RecapOpenTracker season={seasonNum} week={weekNum} source={from === "push" ? "push" : "page"} />
        </article>
      )}
    </div>
  );
}
