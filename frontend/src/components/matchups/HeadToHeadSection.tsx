import type { MatchupContextSide, MatchupHeadToHead, RecentMeeting } from "@/lib/api";

// Shared by MatchupCard.tsx's accordion and the full matchup detail
// page — real, live-computed all-time head-to-head between these two
// teams (app/queries/league.py's get_head_to_head), not limited to
// curated rivalries (see MatchupBadges.tsx's RivalryBadge for that
// separate, curated concept).
export function HeadToHeadSection({
  headToHead,
  home,
  away,
}: {
  headToHead: MatchupHeadToHead;
  home: MatchupContextSide;
  away: MatchupContextSide;
}) {
  const totalGames = headToHead.wins_home + headToHead.wins_away + headToHead.ties;

  return (
    <div className="text-sm">
      <h3 className="mb-1 font-medium text-black/60 dark:text-white/60">All-time head-to-head</h3>
      {totalGames === 0 ? (
        <p className="text-black/50 dark:text-white/50">First meeting between these two.</p>
      ) : (
        <>
          <p>
            {home.team_name} {headToHead.wins_home} – {headToHead.wins_away} {away.team_name}
            {headToHead.ties > 0 && ` (${headToHead.ties} tie${headToHead.ties > 1 ? "s" : ""})`}
            {headToHead.last_season !== null && (
              <span className="text-black/50 dark:text-white/50">
                {" "}
                &middot; last met {headToHead.last_season} Wk {headToHead.last_week}
              </span>
            )}
          </p>
          <RecentMeetingsTable meetings={headToHead.recent_meetings} home={home} away={away} />
        </>
      )}
    </div>
  );
}

// One row per past meeting between these same two teams, most-recent
// first — unlike an NFL "last five games" table (two teams' unrelated
// schedules against different opponents, shown as two columns), our
// head-to-head is a single shared timeline between the same two teams,
// so this is one table, not two, and there's no "OPP" column since it's
// always each other. The winning side's score is bolded/colored per
// meeting — the team names in the header row anchor which column is
// which without repeating them on every line.
export function RecentMeetingsTable({
  meetings,
  home,
  away,
}: {
  meetings: RecentMeeting[];
  home: MatchupContextSide;
  away: MatchupContextSide;
}) {
  if (meetings.length === 0) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-black/10 bg-black/[0.02] px-3 py-1.5 text-xs font-semibold text-black/50 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/50">
        <span className="truncate text-right">{home.team_name}</span>
        <span className="shrink-0 tracking-wide uppercase">Last {meetings.length}</span>
        <span className="truncate">{away.team_name}</span>
      </div>
      <ol className="divide-y divide-black/5 dark:divide-white/5">
        {[...meetings].reverse().map((g, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2">
            <span
              className={`text-right font-mono tabular-nums ${
                g.home_won && !g.tie ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-black/60 dark:text-white/60"
              }`}
            >
              {g.home_score.toFixed(1)}
            </span>
            <span className="shrink-0 text-center text-xs text-black/50 dark:text-white/50">
              {g.season} Wk{g.week}
            </span>
            <span
              className={`font-mono tabular-nums ${
                !g.home_won && !g.tie ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-black/60 dark:text-white/60"
              }`}
            >
              {g.away_score.toFixed(1)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
