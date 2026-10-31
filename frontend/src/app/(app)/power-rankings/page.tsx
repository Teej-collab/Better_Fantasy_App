import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  awardsHrefFor,
  getActiveLeagueName,
  getAllTimePowerRankings,
  getLatestPowerRankingsWeek,
  getMe,
  getSeasonPowerRankingsTrend,
  getWeekPowerRankings,
  listSeasons,
  safeLatestSeason,
    type WeekPowerRanking,
} from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { ANTON, ELITE, EliteCard, EliteSeasonChips, EliteSegLinks, EliteTitle, Hex, PodiumBoard, StatTile } from "@/components/elite/Elite";
import { EliteClimb } from "@/components/elite/EliteClimb";

export const metadata: Metadata = { title: "Power Rankings — The Weekend" };

type View = "week" | "trend" | "all-time";

const VIEW_TABS: { key: View; label: string }[] = [
  { key: "week", label: "This Week" },
  { key: "trend", label: "Season Trend" },
  { key: "all-time", label: "All-Time" },
];

function hrefFor(view: View, season?: number): string {
  const params = new URLSearchParams({ view });
  if (season) params.set("season", String(season));
  return `/power-rankings?${params.toString()}`;
}

export default async function PowerRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; season?: string; week?: string }>;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  // listSeasons is public, so it runs alongside the auth check instead
  // of after it — each await here is a real backend round trip.
  const [me, activeLeagueName, { seasons }, { view: rawView, season: rawSeason, week: rawWeek }] =
    await Promise.all([
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
  if (me.active_league_id === null) {
    return <NeedsLeagueCard />;
  }

  const view: View = rawView === "trend" || rawView === "all-time" ? rawView : "week";
  const latestSeason = safeLatestSeason(seasons);
  const season = rawSeason ? Number(rawSeason) : latestSeason;

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="powerRankings" awardsHref={awardsHrefFor(latestSeason)} activeLeagueName={activeLeagueName} />
      <EliteTitle kicker={view === "all-time" ? "The All-Time" : season !== null ? `The ${season}` : "The"} title="Power Rankings" />

      <EliteSegLinks tabs={VIEW_TABS.map((t) => ({ ...t, href: hrefFor(t.key, season ?? undefined) }))} active={view} />

      {view !== "all-time" && season !== null && (
        <EliteSeasonChips seasons={seasons} activeSeason={season} hrefFor={(s) => hrefFor(view, s)} />
      )}

      {view === "all-time" && <AllTimeView sessionCookie={sessionCookie} />}
      {view === "week" && season !== null && (
        <WeekView season={season} requestedWeek={rawWeek} sessionCookie={sessionCookie} myOwnerId={me.owner_id} />
      )}
      {view === "trend" && season !== null && <TrendView season={season} sessionCookie={sessionCookie} myOwnerId={me.owner_id} />}
      {season === null && view !== "all-time" && (
        <p className="text-sm text-black/50 dark:text-white/50">No seasons found yet.</p>
      )}

      <p className="text-xs text-black/55 dark:text-white/55">
        Who&apos;s actually good: record, all-play record (how you&apos;d do against every team, every week), scoring, recent form and scoring
        margin. Luck is wins above what your scores earned. SoS ranks how hard your schedule has been and how hard what&apos;s left is (1st =
        hardest).
      </p>
    </div>
  );
}

async function AllTimeView({ sessionCookie }: { sessionCookie: string | undefined }) {
  const { categories } = await getAllTimePowerRankings(sessionCookie);
  const shown = categories.filter((c) => c.entries.length > 0);
  if (shown.length === 0) return <p className="text-sm text-black/50 dark:text-white/50">Not enough history yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      {shown.map((c) => (
        <PodiumBoard
          key={c.key}
          title={c.label}
          entries={c.entries.map((e) => ({
            key: String(e.owner_id),
            name: e.owner_name,
            value: `${e.value.toFixed(e.value % 1 === 0 ? 0 : 1)} ${c.unit}`,
            href: `/owners/${e.owner_id}`,
          }))}
        />
      ))}
    </div>
  );
}

function luckLabel(luck: number | undefined): string {
  return luck !== undefined ? `${luck > 0 ? "+" : ""}${luck.toFixed(1)}` : "—";
}

function Movement({ movement }: { movement: number | null }) {
  if (movement === null || movement === 0) return <span className="w-9 text-right text-xs text-white/30">—</span>;
  const up = movement > 0;
  return (
    <span className="w-9 text-right text-[13px] font-extrabold tabular-nums" style={{ color: up ? ELITE.green : "#ff9a4a" }} aria-label={`${up ? "up" : "down"} ${Math.abs(movement)}`}>
      {up ? "▲" : "▼"}
      {Math.abs(movement)}
    </span>
  );
}

async function WeekView({
  season,
  requestedWeek,
  sessionCookie,
  myOwnerId,
}: {
  season: number;
  requestedWeek?: string;
  sessionCookie: string | undefined;
  myOwnerId: number | null;
}) {
  // Only look up the latest week when the URL didn't already name one —
  // it's a whole extra backend round trip before the rankings fetch.
  const week = requestedWeek
    ? Number(requestedWeek)
    : (await getLatestPowerRankingsWeek(season, sessionCookie)).week;

  if (week === null) {
    return (
      <p className="text-sm text-black/50 dark:text-white/50">
        No power rankings computed for {season} yet — this fills in once a sync has run for at least one
        completed week.
      </p>
    );
  }

  const { rankings } = await getWeekPowerRankings(season, week, sessionCookie);
  if (rankings.length === 0) return <p className="text-sm text-black/50 dark:text-white/50">No data for week {week}.</p>;
  // Elite pass (2026-10-31): #1 on a throne card, the rest as hex-ranked
  // rows with what's behind each rank underneath.
  const [top, ...rest] = rankings;

  return (
    <div className="flex flex-col gap-4">
      <span className="text-center text-[11px] font-extrabold tracking-[2px] text-black/55 dark:text-white/60">WEEK {week}</span>
      <EliteCard tone="orange" className="flex flex-col gap-3.5 p-4">
        <div className="flex items-center gap-4">
          <Hex size={80} color={ELITE.peach} fill={ELITE.orange} glow>
            <span className={`${ANTON} text-5xl text-[#2a1102]`}>1</span>
          </Hex>
          <div className="min-w-0 flex-1">
            <p className={`${ANTON} text-[28px] leading-tight uppercase`}>{top.team_name}</p>
            <p className="text-[13px]" style={{ color: ELITE.soft }}>
              {top.owner_name}
              {top.record && ` · ${top.record}`}
              {top.points_per_game !== undefined && ` · ${top.points_per_game.toFixed(1)} ppg`}
              {top.movement === 0 || top.movement === null ? " · held #1" : top.movement > 0 ? ` · up ${top.movement}` : ""}
              {top.owner_id === myOwnerId ? " · you" : ""}
            </p>
            {top.note && (
              <p className="mt-1 text-[13px]" style={{ color: ELITE.peach }}>
                {top.note}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <StatTile value={luckLabel(top.luck_wins)} caption="Luck" />
          <StatTile value={top.sos_rank ? ordinal(top.sos_rank) : "—"} caption="SoS so far" />
          <StatTile value={top.sos_remaining_rank ? ordinal(top.sos_remaining_rank) : "—"} caption="SoS ahead" />
        </div>
      </EliteCard>
      {rest.length > 0 && (
        <EliteCard className="overflow-hidden">
          {rest.map((r: WeekPowerRanking) => {
            const mine = r.owner_id === myOwnerId;
            const color = mine ? ELITE.orange : r.power_rank <= 4 ? ELITE.green : ELITE.grey;
            return (
              <div key={r.team_id} className="flex items-center gap-3 border-t border-white/[0.06] px-3.5 py-3 first:border-t-0" style={mine ? { background: "rgba(255,122,26,.10)" } : undefined}>
                <Hex size={42} color={color} rim={2}>
                  <span className={`${ANTON} text-xl`} style={{ color: color === ELITE.grey ? ELITE.cream : color }}>
                    {r.power_rank}
                  </span>
                </Hex>
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 wrap-break-word font-bold">{r.team_name}</p>
                  <p className="min-w-0 wrap-break-word text-xs" style={{ color: ELITE.soft }}>
                    {r.owner_name}
                    {r.record && ` · ${r.record}`}
                    {r.points_per_game !== undefined && ` · ${r.points_per_game.toFixed(1)} ppg`}
                  </p>
                  {r.note && (
                    <p className="min-w-0 wrap-break-word text-xs" style={{ color: ELITE.peach }}>
                      {r.note}
                    </p>
                  )}
                  <p className="mt-1 text-[11px]" style={{ color: ELITE.faint }}>
                    <span title="Wins above (or below) what their scores earned this season">
                      Luck <b className="text-[#f5f4ec]">{luckLabel(r.luck_wins)}</b>
                    </span>{" "}
                    ·{" "}
                    <span title="Schedule so far (1st = hardest)">
                      SoS <b className="text-[#f5f4ec]">{r.sos_rank ? ordinal(r.sos_rank) : "—"}</b>
                    </span>{" "}
                    ·{" "}
                    <span title="Remaining schedule (1st = hardest)">
                      Ahead <b className="text-[#f5f4ec]">{r.sos_remaining_rank ? ordinal(r.sos_remaining_rank) : "—"}</b>
                    </span>
                  </p>
                </div>
                <Movement movement={r.movement} />
              </div>
            );
          })}
        </EliteCard>
      )}
    </div>
  );
}

async function TrendView({ season, sessionCookie, myOwnerId }: { season: number; sessionCookie: string | undefined; myOwnerId: number | null }) {
  const { teams } = await getSeasonPowerRankingsTrend(season, sessionCookie);
  if (teams.length === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">No power rankings computed for {season} yet.</p>;
  }
  return <EliteClimb teams={teams} myOwnerId={myOwnerId} />;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
