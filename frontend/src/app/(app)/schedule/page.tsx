import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import {
  awardsHrefFor,
  getActiveLeagueName,
  getMe,
  getSchedule,
  listSeasons,
  safeLatestSeason,
  type ScheduleMatchup,
  type ScheduleSide,
  type ScheduleWeek,
  type SeasonSchedule,
} from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { ANTON, ELITE, EliteCard, EliteSeasonChips, EliteSegLinks, EliteTitle, Hex, StatTile, initials } from "@/components/elite/Elite";
import { WeekStrip } from "@/components/elite/WeekStrip";

export const metadata: Metadata = { title: "Schedule — The Weekend" };

/**
 * The Schedule (2026-11-08), the app's League > Schedule on the web: the
 * whole season, which used to take a trip through each week's scores.
 * By Week is every game of a week, opening on this one; My Season is
 * your own run, top to bottom. Headlines from the schedule builder
 * (Season Opener, Rivalry Week…) ride along on their games.
 */
type View = "week" | "mine";

const LOSS = "#ff6b5a";

function hrefFor(view: View, season: number | null, week?: number): string {
  const params = new URLSearchParams({ view });
  if (season) params.set("season", String(season));
  if (week) params.set("week", String(week));
  return `/schedule?${params.toString()}`;
}

function statusLabel(w: ScheduleWeek): string {
  return w.status === "live" ? "This week" : w.status === "final" ? "Final" : "Upcoming";
}

function isMine(m: ScheduleMatchup, ownerId: number | null): boolean {
  return ownerId !== null && (m.home.owner_id === ownerId || m.away.owner_id === ownerId);
}

// Your side first, then theirs.
function sides(m: ScheduleMatchup, ownerId: number | null): [ScheduleSide, ScheduleSide] {
  return m.away.owner_id !== null && m.away.owner_id === ownerId ? [m.away, m.home] : [m.home, m.away];
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ view?: string; season?: string; week?: string }> }) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const [me, activeLeagueName, { seasons }, params] = await Promise.all([
    getMe(sessionCookie),
    getActiveLeagueName(sessionCookie),
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
  if (me.active_league_id === null) return <NeedsLeagueCard />;

  const latestSeason = safeLatestSeason(seasons);
  const season = params.season ? Number(params.season) : latestSeason;
  const data = season !== null ? await getSchedule(season, sessionCookie).catch(() => null) : null;
  const ownerId = me.owner_id ?? null;
  const inLeague = !!data && ownerId !== null && data.weeks.some((w) => w.matchups.some((m) => isMine(m, ownerId)));
  const view: View = params.view === "mine" && inLeague ? "mine" : "week";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <LeagueSubNav active="schedule" awardsHref={awardsHrefFor(latestSeason)} activeLeagueName={activeLeagueName} />
      <EliteTitle kicker={season !== null ? `The ${season}` : "The"} title="Schedule" />
      {inLeague && (
        <EliteSegLinks
          tabs={[
            { key: "week" as View, label: "By Week", href: hrefFor("week", season) },
            { key: "mine" as View, label: "My Season", href: hrefFor("mine", season) },
          ]}
          active={view}
        />
      )}
      {seasons.length > 1 && season !== null && <EliteSeasonChips seasons={seasons} activeSeason={season} hrefFor={(s) => hrefFor(view, s)} />}

      {!data ? (
        <p className="text-center text-sm" style={{ color: ELITE.soft }}>
          {season === null ? "No seasons found yet." : "Couldn't load the schedule. Try again in a moment."}
        </p>
      ) : data.weeks.length === 0 ? (
        <EliteCard className="p-5 text-center">
          <p className="font-extrabold">No schedule yet</p>
          <p className="mt-1 text-sm" style={{ color: ELITE.soft }}>
            It comes out once the draft is done.
          </p>
        </EliteCard>
      ) : view === "mine" ? (
        <MySeason data={data} ownerId={ownerId} />
      ) : (
        <ByWeek data={data} ownerId={ownerId} season={season} requested={params.week ? Number(params.week) : null} />
      )}
    </div>
  );
}

function Avatar({ side, size }: { side: ScheduleSide; size: number }) {
  return (
    <Hex size={size} color="rgba(245,244,236,0.25)" rim={2} image={side.logo_url}>
      <span className={`${ANTON} text-sm`} style={{ color: ELITE.cream }}>
        {initials(side.owner_name ?? side.team_name)}
      </span>
    </Hex>
  );
}

// ---- By Week ----

function ByWeek({ data, ownerId, season, requested }: { data: SeasonSchedule; ownerId: number | null; season: number | null; requested: number | null }) {
  const opening =
    data.weeks.find((w) => w.week === data.current_week) ?? data.weeks.find((w) => w.status !== "final") ?? data.weeks[data.weeks.length - 1];
  const week = data.weeks.find((w) => w.week === requested) ?? opening;
  const index = data.weeks.indexOf(week);
  const prev = data.weeks[index - 1];
  const next = data.weeks[index + 1];
  const games = [...week.matchups].sort((a, b) => Number(isMine(b, ownerId)) - Number(isMine(a, ownerId)));
  const headlines = [...new Set(week.matchups.map((m) => m.headline).filter((h): h is string => !!h))];
  const live = week.status === "live";

  return (
    <div className="flex flex-col gap-3">
      <WeekStrip>
        {data.weeks.map((w) => {
          const on = w === week;
          return (
            <Link
              key={w.week}
              href={hrefFor("week", season, w.week)}
              scroll={false}
              aria-current={on ? "true" : undefined}
              aria-label={`Week ${w.week}, ${statusLabel(w)}${w.is_playoff ? ", playoffs" : ""}`}
              className="relative flex h-[58px] w-14 shrink-0 flex-col items-center justify-center rounded-[14px] border transition-colors"
              style={{
                background: on ? ELITE.green : ELITE.cell,
                borderColor: on || w.status === "live" ? ELITE.green : w.is_playoff ? "rgba(255,122,26,0.5)" : "rgba(57,255,20,0.22)",
                boxShadow: on ? "0 0 14px rgba(57,255,20,.5)" : undefined,
              }}
            >
              <span className="text-[10px] font-extrabold tracking-wider" style={{ color: on ? "#06110a" : ELITE.faint }}>
                {w.is_playoff ? "🏆" : "WK"}
              </span>
              <span
                className={`${ANTON} text-[22px] leading-[26px]`}
                style={{ color: on ? "#06110a" : ELITE.cream, opacity: w.status === "final" && !on ? 0.5 : 1 }}
              >
                {w.week}
              </span>
              {w.status === "live" && !on && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full" style={{ background: ELITE.green }} />}
            </Link>
          );
        })}
      </WeekStrip>

      <EliteCard tone={live ? "green" : "plain"} className="flex items-center px-2.5 py-3.5">
        <ArrowLink week={prev} season={season} label="Previous week" glyph="‹" />
        <div className="flex flex-1 flex-col items-center gap-0.5 text-center">
          <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: live ? ELITE.green : ELITE.soft }}>
            {week.is_playoff ? "PLAYOFFS · " : ""}
            {statusLabel(week).toUpperCase()}
          </span>
          <h2 className={`${ANTON} text-[34px] leading-10 tracking-wide`}>WEEK {week.week}</h2>
          {headlines.map((h) => (
            <span key={h} className="text-xs font-extrabold tracking-[1.5px]" style={{ color: ELITE.orange }}>
              {h.toUpperCase()}
            </span>
          ))}
        </div>
        <ArrowLink week={next} season={season} label="Next week" glyph="›" />
      </EliteCard>

      <div className="grid gap-3 sm:grid-cols-2">
        {games.map((m) => (
          <GameCard key={m.matchup_id} matchup={m} week={week} records={data.records} mine={isMine(m, ownerId)} ownerId={ownerId} />
        ))}
      </div>
    </div>
  );
}

function ArrowLink({ week, season, label, glyph }: { week: ScheduleWeek | undefined; season: number | null; label: string; glyph: string }) {
  if (!week) return <span className="h-9 w-9" aria-hidden />;
  return (
    <Link
      href={hrefFor("week", season, week.week)}
      scroll={false}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full text-2xl font-bold hover:brightness-125"
      style={{ background: ELITE.cell, color: ELITE.green }}
    >
      {glyph}
    </Link>
  );
}

function GameCard({
  matchup,
  week,
  records,
  mine,
  ownerId,
}: {
  matchup: ScheduleMatchup;
  week: ScheduleWeek;
  records: Record<string, string>;
  mine: boolean;
  ownerId: number | null;
}) {
  const [a, b] = sides(matchup, ownerId);
  return (
    <Link href={`/matchups/${matchup.matchup_id}`} className="block transition-transform hover:-translate-y-0.5">
      <EliteCard tone={mine ? "orange" : "plain"} className="h-full px-3.5 py-2">
        {(mine || matchup.headline) && (
          <div className="flex flex-wrap items-center gap-2 pt-1.5 pb-0.5">
            {mine && (
              <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.peach }}>
                YOUR MATCHUP
              </span>
            )}
            {matchup.headline && (
              <span
                className="rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold tracking-[1.2px]"
                style={{ color: ELITE.orange, borderColor: "rgba(255,122,26,0.5)" }}
              >
                {matchup.headline.toUpperCase()}
              </span>
            )}
          </div>
        )}
        <TeamRow side={a} other={b} week={week} record={records[String(a.team_id)]} />
        <TeamRow side={b} other={a} week={week} record={records[String(b.team_id)]} />
      </EliteCard>
    </Link>
  );
}

function TeamRow({ side, other, week, record }: { side: ScheduleSide; other: ScheduleSide; week: ScheduleWeek; record?: string }) {
  const won = side.score !== null && other.score !== null && side.score > other.score;
  const lost = side.score !== null && other.score !== null && side.score < other.score;
  const final = week.status === "final";
  return (
    <div className="flex items-center gap-3 py-2">
      <Avatar side={side} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold" style={{ opacity: final && lost ? 0.5 : 1 }}>
          {side.team_name}
        </p>
        <p className="truncate text-xs" style={{ color: ELITE.soft }}>
          {side.owner_name}
          {record ? ` · ${record}` : ""}
        </p>
      </div>
      {week.status === "upcoming" ? (
        <span className={`${ANTON} text-[22px]`} style={{ color: ELITE.grey }}>
          —
        </span>
      ) : (
        <span
          className={`${ANTON} text-2xl tabular-nums`}
          style={{
            color: won ? ELITE.green : ELITE.cream,
            opacity: final && lost ? 0.5 : 1,
            textShadow: final && won ? "0 0 8px rgba(57,255,20,.5)" : undefined,
          }}
        >
          {side.score !== null ? side.score.toFixed(1) : "—"}
        </span>
      )}
    </div>
  );
}

// ---- My Season ----

function MySeason({ data, ownerId }: { data: SeasonSchedule; ownerId: number | null }) {
  const games = data.weeks.map((w) => {
    const m = w.matchups.find((x) => isMine(x, ownerId)) ?? null;
    return { week: w, matchup: m, pair: m ? sides(m, ownerId) : null };
  });
  const myTeamId = games.find((g) => g.pair)?.pair?.[0].team_id;
  const record = myTeamId !== undefined ? data.records[String(myTeamId)] : undefined;
  const next = games.find((g) => g.week.status !== "final" && g.pair);
  const left = games.filter((g) => g.week.status === "upcoming" && !g.week.is_playoff && g.pair).length;
  const firstPlayoff = games.findIndex((g) => g.week.is_playoff);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <StatTile value={record ?? "0-0"} caption="Record" color={ELITE.green} />
        <StatTile
          value={next?.pair ? (next.pair[1].owner_name ?? next.pair[1].team_name).split(" ")[0] : "—"}
          caption={next?.week.status === "live" ? "This week" : "Next up"}
        />
        <StatTile value={String(left)} caption="Games left" />
      </div>
      <EliteCard className="overflow-hidden">
        {games.map((g, i) => (
          <div key={g.week.week}>
            {i === firstPlayoff && (
              <p className="px-3.5 pt-3.5 pb-0.5 text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.orange }}>
                🏆 PLAYOFFS
              </p>
            )}
            <SeasonRow week={g.week} matchup={g.matchup} pair={g.pair} records={data.records} divided={i !== 0 && i !== firstPlayoff} />
          </div>
        ))}
      </EliteCard>
    </div>
  );
}

function SeasonRow({
  week,
  matchup,
  pair,
  records,
  divided,
}: {
  week: ScheduleWeek;
  matchup: ScheduleMatchup | null;
  pair: [ScheduleSide, ScheduleSide] | null;
  records: Record<string, string>;
  divided: boolean;
}) {
  const live = week.status === "live";
  const className = `flex items-center gap-3 px-3.5 py-3 ${divided ? "border-t border-white/[0.07]" : ""} ${matchup ? "hover:bg-white/[0.03]" : ""}`;
  const style = live ? { background: "rgba(57,255,20,0.07)" } : undefined;
  const content = (
    <>
      <div className="flex w-[30px] flex-col items-center">
        <span className="text-[9px] font-extrabold tracking-wider" style={{ color: ELITE.faint }}>
          WK
        </span>
        <span className={`${ANTON} text-xl leading-6`} style={{ color: live ? ELITE.green : ELITE.cream }}>
          {week.week}
        </span>
      </div>
      {pair ? (
        <>
          <Avatar side={pair[1]} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold">vs {pair[1].team_name}</p>
            <p className="truncate text-xs" style={{ color: ELITE.soft }}>
              {pair[1].owner_name}
              {records[String(pair[1].team_id)] ? ` · ${records[String(pair[1].team_id)]}` : ""}
            </p>
            {matchup?.headline && (
              <p className="mt-0.5 text-[10px] font-extrabold tracking-[1.2px]" style={{ color: ELITE.orange }}>
                {matchup.headline.toUpperCase()}
              </p>
            )}
          </div>
          <Outcome week={week} me={pair[0]} them={pair[1]} />
        </>
      ) : (
        <span className="flex-1 text-xs" style={{ color: ELITE.soft }}>
          {week.is_playoff ? "No game" : "Bye"}
        </span>
      )}
    </>
  );
  return matchup ? (
    <Link href={`/matchups/${matchup.matchup_id}`} className={className} style={style}>
      {content}
    </Link>
  ) : (
    <div className={className} style={style}>
      {content}
    </div>
  );
}

function Outcome({ week, me, them }: { week: ScheduleWeek; me: ScheduleSide; them: ScheduleSide }) {
  if (week.status === "upcoming") {
    return (
      <span className="text-xs font-bold" style={{ color: ELITE.faint }}>
        {week.is_playoff ? "Playoffs" : "Upcoming"}
      </span>
    );
  }
  const scores = me.score !== null && them.score !== null ? `${me.score.toFixed(1)}–${them.score.toFixed(1)}` : "—";
  const r = me.score === null || them.score === null ? null : me.score > them.score ? "W" : me.score < them.score ? "L" : "T";
  const color = week.status === "live" ? ELITE.green : r === "W" ? ELITE.green : r === "L" ? LOSS : ELITE.cream;
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={`${ANTON} min-w-7 rounded-lg border px-1.5 text-center text-sm leading-[18px]`} style={{ color, borderColor: color }}>
        {week.status === "live" ? "LIVE" : (r ?? "—")}
      </span>
      <span className="text-[11px] tabular-nums" style={{ color: ELITE.soft }}>
        {scores}
      </span>
    </div>
  );
}
