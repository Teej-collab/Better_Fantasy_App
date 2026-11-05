import type { LeagueProjection } from "@/lib/playerCardApi";

// The player card's projection (2026-11-05), the web side of the app's
// ProjectionCard: this week's number in the league's own scoring with its
// floor-to-ceiling range, what each source says, the stat line and the
// inputs behind it, the odds of the bonuses this league pays, and the
// rest of the season week by week.
const SOURCE_LABEL = { model: "Ours", espn: "ESPN", sleeper: "Sleeper" } as const;
const STAT_LABEL: Record<string, string> = {
  pass_yd: "pass yds", pass_td: "pass TD", pass_int: "INT", rush_att: "car", rush_yd: "rush yds", rush_td: "rush TD",
  rec: "rec", rec_yd: "rec yds", rec_td: "rec TD", fg_made_0_39: "FG <40", fg_made_40_49: "FG 40s",
  fg_made_50_plus: "FG 50+", xp_made: "XP", def_sack: "sacks", def_int: "INT", def_fum_rec: "FR",
  pts_allow: "pts allowed", idp_tackle: "tkl", idp_sack: "sacks", idp_int: "INT", idp_pass_def: "PD",
};
const BONUS_LABEL: Record<string, string> = {
  bonus_pass_300: "300+ pass yds", bonus_pass_400: "400+ pass yds", bonus_rush_100: "100+ rush yds",
  bonus_rush_200: "200+ rush yds", bonus_rec_100: "100+ rec yds", bonus_rec_200: "200+ rec yds",
};

function statText(key: string, value: number): string {
  const digits = key.endsWith("_yd") || key === "pts_allow" ? 0 : 1;
  return `${value.toFixed(digits)} ${STAT_LABEL[key] ?? key}`;
}

export function ProjectionPanel({ projection }: { projection: LeagueProjection }) {
  const { points, floor, ceiling, by_source, stat_line, why, bonus_odds, rest_of_season } = projection;
  const range = floor !== null && ceiling !== null && ceiling > floor ? ceiling - floor : null;
  const marker = range ? Math.min(1, Math.max(0, (points - floor!) / range)) : 0.5;
  const stats = Object.entries(stat_line).filter(([k, v]) => STAT_LABEL[k] && v >= 0.05);
  const bonuses = Object.entries(bonus_odds).filter(([k]) => BONUS_LABEL[k]);
  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[0.7rem] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            Week {projection.week} projection
          </p>
          <p className="text-3xl font-extrabold tabular-nums">{points.toFixed(1)}</p>
        </div>
        <div className="flex gap-3">
          {(["model", "espn", "sleeper"] as const).map((s) =>
            by_source[s] !== undefined ? (
              <div key={s} className="text-center">
                <p className="text-[0.65rem] font-semibold text-black/50 uppercase dark:text-white/50">{SOURCE_LABEL[s]}</p>
                <p className="font-bold tabular-nums">{by_source[s]!.toFixed(1)}</p>
              </div>
            ) : null
          )}
        </div>
      </div>
      {range !== null && (
        <div aria-label={`Floor ${floor!.toFixed(1)}, ceiling ${ceiling!.toFixed(1)}`}>
          <div className="relative h-1.5 rounded-full bg-black/10 dark:bg-white/10">
            <span
              className="absolute -top-1 h-3.5 w-1 -translate-x-1/2 rounded bg-[var(--wl-accent)]"
              style={{ left: `${marker * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs text-black/50 dark:text-white/50">
            <span>Floor {floor!.toFixed(1)}</span>
            <span>Ceiling {ceiling!.toFixed(1)}</span>
          </div>
        </div>
      )}
      {stats.length > 0 && <p>{stats.map(([k, v]) => statText(k, v)).join(" · ")}</p>}
      {why?.team && (
        <p className="text-xs text-black/60 dark:text-white/60">
          {why.implied !== undefined
            ? `${why.team} is projected for ${why.implied} points vs ${why.opp}`
            : why.opp_implied !== undefined
              ? `${why.opp} is projected for ${why.opp_implied} points vs ${why.team}`
              : `${why.team} vs ${why.opp}`}
          {why.matchup !== undefined && why.matchup !== 1 ? ` · ${why.matchup > 1 ? "soft" : "tough"} matchup for the position` : ""}
        </p>
      )}
      {bonuses.length > 0 && (
        <p className="text-xs text-black/60 dark:text-white/60">
          {bonuses.map(([k, v]) => `${Math.round(v * 100)}% chance of ${BONUS_LABEL[k]}`).join(" · ")}
        </p>
      )}
      {rest_of_season.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rest_of_season.slice(0, 8).map((w) => (
            <span key={w.week} className="flex min-w-10 flex-col items-center rounded-lg bg-black/5 px-1.5 py-1 dark:bg-white/10">
              <span className="text-[0.65rem] font-semibold text-black/50 dark:text-white/50">W{w.week}</span>
              <span className="text-xs font-bold tabular-nums">{w.points.toFixed(1)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
