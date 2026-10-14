import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentWeek, getMe, getTeam, getTeamRoster, resolveWeek } from "@/lib/api";
import type { TeamDetail } from "@/lib/api";
import { LogoAvatar } from "@/components/matchups/MatchupScoreHeader";
import { TeamRosterList } from "@/components/TeamRosterList";
import { SignInCard } from "@/components/SignInCard";
import { BackButton } from "@/components/BackButton";

const MAX_WEEK = 17;

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

// "4-1 · 1st of 12" — null on an older backend without the record.
function recordLine(t: TeamDetail): string | null {
  if (t.wins === undefined || t.losses === undefined) return null;
  const record = `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;
  return t.rank ? `${record} · ${ordinal(t.rank)}${t.team_count ? ` of ${t.team_count}` : ""}` : record;
}

// Real per-page title (was falling back to the root layout's generic
// "Weekend League" for every page in the app — mobile audit finding)
// — matters most here since team pages are the kind of link an owner
// actually shares with the league. getTeam() is automatically deduped
// against the identical call in the page component below (Next's
// fetch request memoization), so this doesn't cost a second request.
// A non-member or a team that genuinely doesn't exist both come back
// as null (getServerOrNull) and both render as "not found," deliberately
// — never revealing that a specific team_id exists to someone not
// authorized to see it.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ teamId: string }>;
}): Promise<Metadata> {
  const { teamId } = await params;
  const sessionCookie = (await cookies()).get("session")?.value;
  const team = await getTeam(Number(teamId), sessionCookie);
  if (!team) return { title: "Team not found — The Weekend" };
  return { title: `${team.team_name} — The Weekend` };
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { teamId } = await params;
  const { week: weekParam } = await searchParams;

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

  const team = await getTeam(Number(teamId), sessionCookie);
  if (!team) notFound();

  // Defaults to the season's actual current week (cached from the last
  // sync — see league_state) rather than always week 1, so this reads
  // like "your team right now" instead of requiring a manual click
  // every visit. Falls back to 1 if nothing's cached yet, or if it's
  // preseason — ESPN reports current_week as 0 before Week 1 starts,
  // and "week 0" isn't a real thing in our data.
  let week: number;
  if (weekParam) {
    week = Number(weekParam);
  } else {
    const { current_week } = await getCurrentWeek(team.season);
    week = resolveWeek(current_week);
  }

  const [{ roster }, { current_week }] = await Promise.all([
    getTeamRoster(Number(teamId), week, sessionCookie),
    getCurrentWeek(team.season),
  ]);
  const currentWeek = current_week ? resolveWeek(current_week) : null;
  const isMine = me.owner_id !== null && me.owner_id === team.owner_id;

  const reserve = ["BE", "IR", "TAXI"];
  const starters = roster.filter((p) => !reserve.includes(p.lineup_slot ?? ""));
  const bench = roster.filter((p) => reserve.includes(p.lineup_slot ?? ""));
  const scored = starters.reduce((sum, p) => sum + (p.points_scored !== null ? Number(p.points_scored) : 0), 0);
  const projected = starters.reduce((sum, p) => sum + (p.points_projected !== null ? Number(p.points_projected) : 0), 0);
  const record = recordLine(team);
  const weekHref = (w: number) => `/teams/${teamId}?week=${w}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackButton fallbackHref="/standings" label="Standings" />
        <div className="mt-1 flex items-center gap-3">
          <LogoAvatar logoUrl={team.logo_url ?? null} name={team.owner_name ?? team.team_name} size={56} />
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight font-semibold break-words">{team.team_name}</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              <Link href={`/owners/${team.owner_id}?season=${team.season}`} className="font-medium hover:underline">
                {team.owner_name}
              </Link>
              {record ? ` · ${record}` : ` · ${team.season} season`}
            </p>
          </div>
        </div>
      </div>

      {/* ESPN-style "< Week N >", same as My Team's. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full border border-black/10 p-1 dark:border-white/10">
          <WeekArrow href={week > 1 ? weekHref(week - 1) : null} label="Previous week">
            ‹
          </WeekArrow>
          <span className="px-2 text-sm font-semibold uppercase">Week {week}</span>
          <WeekArrow href={week < MAX_WEEK ? weekHref(week + 1) : null} label="Next week">
            ›
          </WeekArrow>
        </div>
        {currentWeek !== null && week !== currentWeek && (
          <Link href={weekHref(currentWeek)} className="text-xs font-semibold text-[var(--wl-accent)] hover:underline">
            Back to Week {currentWeek} →
          </Link>
        )}
      </div>

      <div className="flex gap-2">
        {isMine ? (
          <Link
            href="/team"
            className="flex-1 rounded-full bg-[var(--wl-accent-dim)] px-4 py-2 text-center text-sm font-semibold text-white hover:brightness-110"
          >
            Edit lineup in My Team
          </Link>
        ) : (
          <Link
            href={`/trades?team=${team.team_id}`}
            className="flex-1 rounded-full bg-[var(--wl-accent-dim)] px-4 py-2 text-center text-sm font-semibold text-white hover:brightness-110"
          >
            Propose Trade
          </Link>
        )}
        <Link
          href={`/owners/${team.owner_id}?season=${team.season}`}
          className="flex-1 rounded-full border border-black/15 px-4 py-2 text-center text-sm font-semibold hover:bg-black/[0.03] dark:border-white/20 dark:hover:bg-white/[0.05]"
        >
          Owner profile
        </Link>
      </div>

      {roster.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No roster for week {week}.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-black/60 tabular-nums dark:text-white/60">
            {scored.toFixed(1)} pts · Proj {projected.toFixed(1)}
          </p>
          <TeamRosterList title="Starters" players={starters} />
          <TeamRosterList title="Bench" players={bench} />
        </div>
      )}
    </div>
  );
}

function WeekArrow({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const className =
    "flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-xl leading-none dark:bg-white/10";
  if (!href) {
    return (
      <span className={`${className} opacity-25`} aria-hidden>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={`${className} hover:bg-black/10 dark:hover:bg-white/20`}>
      {children}
    </Link>
  );
}
