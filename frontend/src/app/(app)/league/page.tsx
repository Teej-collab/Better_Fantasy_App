import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  awardsHrefFor,
  getActiveLeagueName,
  getLatestPowerRankings,
  getMe,
  listOwners,
  listSeasons,
  listTeamsServer,
  safeLatestSeason,
} from "@/lib/api";
import { ActivePollCard } from "@/components/ActivePollCard";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { ANTON, ELITE, EliteCard, EliteSeasonChips, EliteTitle, Hex, initials } from "@/components/elite/Elite";

export const metadata: Metadata = { title: "League — The Weekend" };

export default async function LeaguePage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  // listSeasons is public, so it runs alongside the auth check instead
  // of after it — each await here is a real backend round trip.
  const [me, { seasons }, { season: seasonParam }] = await Promise.all([
    getMe(sessionCookie),
    listSeasons(sessionCookie),
    searchParams,
  ]);
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

  const latestSeason = safeLatestSeason(seasons);
  const season = seasonParam ? Number(seasonParam) : latestSeason;

  const [{ teams }, activeLeagueName, { rankings }, { owners }] = await Promise.all([
    season !== null ? listTeamsServer(sessionCookie, season) : Promise.resolve({ teams: [] }),
    getActiveLeagueName(sessionCookie),
    season !== null ? getLatestPowerRankings(season, sessionCookie) : Promise.resolve({ rankings: [] }),
    listOwners(sessionCookie).catch(() => ({ owners: [] })),
  ]);
  // Each owner's profile picture (Settings > Team Logo) for the cells.
  const photoByOwner = new Map(owners.filter((o) => o.logo_url).map((o) => [o.owner_id, o.logo_url!]));

  const powerRankByTeam = new Map(rankings.map((r) => [r.team_id, r.power_rank]));
  const recordByTeam = new Map(rankings.map((r) => [r.team_id, r.record ?? null]));
  // The Hive (elite pass, 2026-10-31): every team a cell, lit by this
  // week's power rank — top third green, middle dim, the rest grey, and
  // your own team orange.
  const ordered = [...teams].sort(
    (a, b) => (powerRankByTeam.get(a.team_id) ?? 99) - (powerRankByTeam.get(b.team_id) ?? 99) || a.team_name.localeCompare(b.team_name)
  );
  const third = Math.ceil(teams.length / 3);
  const mine = me.owner_id != null ? teams.find((t) => t.owner_id === me.owner_id) : undefined;
  const cellColor = (teamId: number) => {
    const rank = powerRankByTeam.get(teamId);
    if (teamId === mine?.team_id) return ELITE.orange;
    if (rank === undefined) return ELITE.grey;
    return rank <= third ? ELITE.green : rank <= 2 * third ? "rgba(57,255,20,.5)" : ELITE.grey;
  };
  const rows: (typeof ordered)[] = [];
  for (let i = 0; i < ordered.length; ) {
    const n = rows.length % 2 === 0 ? 4 : 3;
    rows.push(ordered.slice(i, i + n));
    i += n;
  }
  const myRank = mine ? powerRankByTeam.get(mine.team_id) : undefined;
  const myRecord = mine ? recordByTeam.get(mine.team_id) : null;

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="league" awardsHref={awardsHrefFor(latestSeason)} activeLeagueName={activeLeagueName} />
      <EliteTitle kicker="The" title="Hive" subtitle={rankings.length > 0 ? `${teams.length} teams · lit by power rank` : undefined} />
      <EliteSeasonChips seasons={seasons} activeSeason={season} hrefFor={(s) => `/league?season=${s}`} />

      <ActivePollCard leagueId={me.active_league_id} />

      {teams.length > 0 && (
        <div className="flex flex-col items-center py-1">
          {rows.map((row, r) => (
            <div key={r} className="flex justify-center gap-1.5" style={{ marginTop: r === 0 ? 0 : -14 }}>
              {row.map((t) => {
                const rank = powerRankByTeam.get(t.team_id);
                const color = cellColor(t.team_id);
                const isMine = t.team_id === mine?.team_id;
                return (
                  <Link
                    key={t.team_id}
                    href={`/teams/${t.team_id}`}
                    aria-label={`${t.team_name}, ${t.owner_name}${rank ? `, power rank ${rank}` : ""}${isMine ? ", your team" : ""}`}
                    title={`${t.team_name} · ${t.owner_name}`}
                    className="transition-transform hover:scale-105"
                  >
                    <Hex
                      size={76}
                      color={color}
                      fill={isMine ? "#2a1a0c" : ELITE.cell}
                      glow={isMine}
                      image={photoByOwner.get(t.owner_id)}
                      badge={rank !== undefined ? `#${rank}` : null}
                    >
                      <span className={`${ANTON} text-[22px] text-[#f5f4ec]`}>{initials(t.owner_name)}</span>
                    </Hex>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {mine && (
        <EliteCard tone="orange" className="flex flex-col gap-2.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.peach }}>
              YOUR TEAM
            </span>
            <span className="text-xs" style={{ color: ELITE.soft }}>
              {[myRecord, myRank ? `Power #${myRank}` : null].filter(Boolean).join(" · ")}
            </span>
          </div>
          <span className={`${ANTON} text-3xl leading-tight uppercase`}>{mine.team_name}</span>
          <div className="flex gap-2">
            <Link href={`/teams/${mine.team_id}`} className="flex min-h-11 flex-1 items-center justify-center rounded-[14px] text-sm font-extrabold text-[#1a0b00]" style={{ background: ELITE.orange }}>
              Roster
            </Link>
            <Link href={`/owners/${mine.owner_id}`} className="flex min-h-11 flex-1 items-center justify-center rounded-[14px] border border-white/20 text-sm font-bold">
              Owner profile
            </Link>
          </div>
        </EliteCard>
      )}

      <EliteCard className="overflow-hidden">
        <ul className="flex flex-col divide-y divide-white/[0.06]">
          {ordered.map((team) => {
            const rank = powerRankByTeam.get(team.team_id);
            const color = cellColor(team.team_id);
            return (
              <li key={team.team_id} className="flex items-center gap-3 px-3.5 py-2.5">
                <Hex size={36} color={color} rim={2} image={photoByOwner.get(team.owner_id)}>
                  <span className="text-xs font-extrabold">{initials(team.owner_name)}</span>
                </Hex>
                <span className="flex min-w-0 flex-1 flex-col">
                  <Link href={`/teams/${team.team_id}`} className="min-w-0 wrap-break-word font-bold hover:underline">
                    {team.team_name}
                  </Link>
                  <Link href={`/owners/${team.owner_id}`} className="text-xs hover:underline" style={{ color: ELITE.soft }}>
                    {team.owner_name}
                  </Link>
                </span>
                {rank !== undefined && (
                  <span className={`${ANTON} w-8 text-right text-xl`} style={{ color: color === ELITE.grey ? ELITE.faint : color }}>
                    {rank}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </EliteCard>
    </div>
  );
}
