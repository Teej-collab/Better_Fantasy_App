import type { ReactNode } from "react";
import { cookies } from "next/headers";
import {
  buildNflTickerItems,
  getCurrentWeek,
  getMe,
  getMyWeek,
  getNflScoreboard,
  getStandings,
  getWeekMatchupContext,
  getWeeklyAwards,
  isNflGameLive,
  buildLeagueTickerItems,
  getWeekLeagueTicker,
  listRivalries,
  listSeasons,
  type Rivalry,
  type StandingsRow,
  type TickerItem,
  type WeekMatchupContextItem,
  type WeeklyAwards,
  type YourWeek,
} from "@/lib/api";
import { GameDayRefresher } from "@/components/GameDayRefresher";
import { LiveTicker } from "@/components/LiveTicker";
import { OpeningExperience } from "@/components/OpeningExperience";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const SECTION_ACCENT: Record<string, string> = {
  standings: "bg-sky-500",
  matchups: "bg-pink-500",
  awards: "bg-amber-400",
  rivalries: "bg-orange-500",
  players: "bg-cyan-400",
  rules: "bg-purple-500",
  league: "bg-indigo-500",
  chug: "bg-amber-600",
  chat: "bg-lime-500",
};

// Same palette as SECTION_ACCENT, as a soft box-shadow glow behind each
// section header's dot instead of a flat CSS color utility (box-shadow
// can't reference a bg-* class's color directly).
const SECTION_GLOW: Record<string, string> = {
  standings: "#0ea5e9",
  matchups: "#ec4899",
  awards: "#fbbf24",
  rivalries: "#f97316",
  players: "#22d3ee",
  rules: "#a855f7",
  league: "#6366f1",
  chug: "#d97706",
  chat: "#84cc16",
};

// Lower = shown first — same escalating hierarchy as the /weekend signs'
// tier-colored badges (MatchupCard.tsx's TIER_BADGE_CLASS).
const TIER_RANK: Record<string, number> = { Legendary: 0, Historic: 1, Developing: 2 };

export default async function HomePage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  // Mandatory front door: a signed-out visitor sees the Weekend League
  // opening/auth experience instead of the dashboard below, and none of
  // this page's data gets fetched for them at all. See
  // OpeningExperience.tsx.
  const me = await getMe(sessionCookie);
  if (!me) {
    const nflGames = await getNflScoreboard();
    return (
      <OpeningExperience tickerItems={buildNflTickerItems(nflGames)} isGameDay={isNflGameLive(nflGames)} />
    );
  }

  const { seasons } = await listSeasons();
  const season = seasons.length > 0 ? Math.max(...seasons) : null;

  const [myWeek, nflGames] = await Promise.all([getMyWeek(sessionCookie), getNflScoreboard()]);
  const isGameDay = isNflGameLive(nflGames);

  let week: number | null = null;
  let standings: StandingsRow[] = [];
  let weeklyAwards: WeeklyAwards | null = null;
  let weekPlayed = false;
  let weekMatchups: WeekMatchupContextItem[] = [];
  let topRivalries: Rivalry[] = [];
  let leagueTickerItems: TickerItem[] = [];

  if (season !== null) {
    const { current_week } = await getCurrentWeek(season);
    week = current_week && current_week >= 1 ? current_week : 1;
    const [standingsRes, awardsRes, matchupContextRes, rivalriesRes, leagueTicker] = await Promise.all([
      getStandings(season),
      getWeeklyAwards(season, week),
      getWeekMatchupContext(season, week),
      listRivalries(),
      getWeekLeagueTicker(season, week),
    ]);
    standings = standingsRes.standings;
    weeklyAwards = awardsRes;
    weekMatchups = matchupContextRes.matchups;
    weekPlayed = standings.some((r) => r.wins + r.losses + r.ties > 0);
    topRivalries = [...rivalriesRes.rivalries]
      .sort((a, b) => TIER_RANK[a.tier ?? ""] - TIER_RANK[b.tier ?? ""])
      .slice(0, 3);
    leagueTickerItems = buildLeagueTickerItems(leagueTicker);
  }

  // "Other" = every matchup except the logged-in owner's own (already
  // shown in the hero above). When logged out, myWeek is null and
  // nothing gets excluded — every matchup is "other".
  const otherMatchups = weekMatchups.filter((m) => m.matchup_id !== myWeek?.matchup?.matchup_id);
  const rivalryGamesThisWeek = weekMatchups.filter((m) => m.is_rivalry);

  const tickerItems = buildTickerItems(nflGames, weeklyAwards, standings, weekPlayed, rivalryGamesThisWeek);

  // Which stagger slot each section lands in — sections that are
  // conditionally absent (e.g. no other matchups this week) just skip
  // their slot rather than leaving a gap, since delay only matters
  // relative to what's actually rendered.
  let revealIndex = 0;
  const nextReveal = () => revealIndex++;

  return (
    <div className="flex flex-col gap-6">
      {/* Fixed behind everything, ignores PageShell's centered column so
          it washes the full viewport — three soft brand-colored glows,
          restrained compared to /weekend's full neon treatment per the
          brief ("neon as accent, not the whole design"). This is the
          fix for the homepage reading as a flat black-and-white screen. */}
      <div className="home-ambient" aria-hidden />
      {isGameDay && <GameDayRefresher />}

      <Reveal index={nextReveal()}>
        <div className="flex items-center gap-2">
          <span className={isGameDay ? "live-dot" : "live-dot live-dot--idle"} aria-hidden />
          <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            The Weekend Live
          </span>
          {isGameDay && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-red-500 uppercase">
              Game Day
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <LiveTicker items={tickerItems} fast={isGameDay} />
          {leagueTickerItems.length > 0 && <LiveTicker items={leagueTickerItems} fast={isGameDay} />}
        </div>
      </Reveal>

      <Reveal index={nextReveal()}>
        {myWeek?.matchup ? (
          <YourWeekHero myWeek={myWeek} isGameDay={isGameDay} />
        ) : myWeek ? (
          <EmptyHero
            title={myWeek.team_name}
            message={
              // ESPN reports current_week as 0 during preseason — not a
              // real week, same convention as the Team page's fallback.
              myWeek.week === null || myWeek.week < 1
                ? "No matchup yet — the season hasn't started."
                : "No matchup this week (bye week or the schedule isn't set yet)."
            }
          />
        ) : (
          // Reaching this branch means /me/week itself failed even though
          // getMe (above) confirmed a valid session — a transient fetch
          // error, not "not signed in" (that's already handled by the
          // early OpeningExperience return before this component fetches
          // anything else).
          <EmptyHero title="Your Week" message="Couldn't load your matchup right now — try refreshing." />
        )}
      </Reveal>

      {standings.length > 0 && (
        <Reveal index={nextReveal()}>
          <section className="flex flex-col gap-2">
            <SectionHeader color="standings" title="League Standings" href="/standings" />
            <ol
              className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
              style={panelGlowStyle(SECTION_COLORS.standings)}
            >
              {standings.slice(0, 5).map((row, i) => (
                <li
                  key={row.team_id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-4 shrink-0 text-black/40 tabular-nums dark:text-white/40">{i + 1}</span>
                    <span className="truncate">{row.team_name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-black/60 dark:text-white/60">
                    {row.wins}-{row.losses}
                    {row.ties ? `-${row.ties}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </Reveal>
      )}

      {otherMatchups.length > 0 && (
        <Reveal index={nextReveal()}>
          <section className="flex flex-col gap-2">
            <SectionHeader
              color="matchups"
              title="Other Matchups"
              href={season !== null && week !== null ? `/seasons/${season}/weeks/${week}` : "/standings"}
            />
            <ul
              className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
              style={panelGlowStyle(SECTION_COLORS.matchups)}
            >
              {otherMatchups.map((m) => {
                const started =
                  m.home.score !== null && m.away.score !== null && !(m.home.score === 0 && m.away.score === 0);
                return (
                  <li key={m.matchup_id}>
                    <a
                      href={`/matchups/${m.matchup_id}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          {isGameDay && started && <span className="live-dot" aria-hidden />}
                          {m.is_game_of_the_week && <span title="Game of the Week">⭐</span>}
                          {m.is_rivalry && <span title={m.rivalry?.name}>{m.rivalry?.emoji ?? "⚔️"}</span>}
                          <span className="truncate">{m.home.team_name}</span>
                        </span>
                        <span className="truncate text-black/50 dark:text-white/50">{m.away.team_name}</span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums text-black/70 dark:text-white/70">
                        <span className="block">{m.home.score !== null ? m.home.score.toFixed(1) : "—"}</span>
                        <span className="block">{m.away.score !== null ? m.away.score.toFixed(1) : "—"}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        </Reveal>
      )}

      {(rivalryGamesThisWeek.length > 0 || topRivalries.length > 0) && (
        <Reveal index={nextReveal()}>
          <section className="flex flex-col gap-2">
            <SectionHeader color="rivalries" title="Rivalries" href="/rivalries" />
            {rivalryGamesThisWeek.length > 0 ? (
              <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
                style={panelGlowStyle(SECTION_COLORS.rivalries)}>
                {rivalryGamesThisWeek.map((m) => (
                  <li key={m.matchup_id}>
                    <a
                      href={`/matchups/${m.matchup_id}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span>{m.rivalry?.emoji ?? "⚔️"}</span>
                        <span className="truncate font-medium">{m.rivalry?.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-black/50 dark:text-white/50">
                        {m.head_to_head.wins_home}-{m.head_to_head.wins_away}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
                style={panelGlowStyle(SECTION_COLORS.rivalries)}>
                {topRivalries.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span>{r.emoji ?? "⚔️"}</span>
                      <span className="truncate font-medium">{r.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-black/50 dark:text-white/50">
                      {r.owner_a_name} {r.all_time_wins_a}-{r.all_time_wins_b} {r.owner_b_name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Reveal>
      )}

      {weekPlayed && weeklyAwards && season !== null && week !== null && (
        <Reveal index={nextReveal()}>
          <section className="flex flex-col gap-2">
            <SectionHeader color="awards" title="This Week's Awards" href={`/seasons/${season}/awards`} />
            <AwardsPreview awards={weeklyAwards} />
          </section>
        </Reveal>
      )}

      <Reveal index={nextReveal()}>
        <DiscoveryGrid season={season} week={week} />
      </Reveal>
    </div>
  );
}

// One-shot staggered fade/rise on first paint — pure CSS (globals.css's
// .rise-in), no client JS needed, so this stays a server component.
// Each top-level homepage section gets a slightly later delay than the
// one before it, so the page visibly "wakes up" section by section
// instead of just appearing all at once.
function Reveal({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="rise-in" style={{ animationDelay: `${index * 70}ms` }}>
      {children}
    </div>
  );
}

function buildTickerItems(
  nflGames: Awaited<ReturnType<typeof getNflScoreboard>>,
  awards: WeeklyAwards | null,
  standings: StandingsRow[],
  weekPlayed: boolean,
  rivalryGamesThisWeek: WeekMatchupContextItem[]
): TickerItem[] {
  const items = buildNflTickerItems(nflGames);
  const text = (key: string, body: string) => items.push({ key, segments: [{ text: body }] });

  rivalryGamesThisWeek.slice(0, 2).forEach((m, i) => {
    text(`rivalry-${i}`, `⚔️ Rivalry Alert: ${m.rivalry?.name ?? `${m.home.team_name} vs ${m.away.team_name}`}`);
  });

  if (weekPlayed && awards) {
    if (awards.game_of_the_week) {
      text("gotw", `⭐ Game of the Week: ${awards.game_of_the_week.winner} won ${awards.game_of_the_week.score}`);
    }
    if (awards.overachiever) {
      text("overachiever", `📈 ${awards.overachiever.team_name} overachieved by +${awards.overachiever.diff.toFixed(1)}`);
    }
    if (awards.biggest_bench_crime) {
      text(
        "bench-crime",
        `💀 Biggest Bench Crime: ${awards.biggest_bench_crime.team_name} left ${awards.biggest_bench_crime.bench_player} on the bench`
      );
    }
    if (awards.boom_leaders[0]) {
      text("boom", `🔥 ${awards.boom_leaders[0].player_name} boomed for ${awards.boom_leaders[0].points_scored.toFixed(1)}`);
    }
  }

  if (standings[0]) {
    text("leader", `👑 ${standings[0].team_name} leads the league`);
  }

  if (items.length === 0) {
    text("empty", "🏈 The Weekend — check back once games kick off");
  }

  return items;
}

function YourWeekHero({ myWeek, isGameDay }: { myWeek: YourWeek; isGameDay: boolean }) {
  const m = myWeek.matchup!;
  const winning = m.my_score !== null && m.opponent_score !== null && m.my_score >= m.opponent_score;
  const isLive = m.started && isGameDay;

  return (
    <section
      className={`flex flex-col gap-3 rounded-xl bg-gradient-to-br from-neutral-900 via-black to-black p-4 text-white ${
        isLive ? "hero-live-glow border border-red-500/50" : "neon-panel"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-white/50 uppercase">
          Your Week{m.is_playoff ? " — Playoffs" : ""}
          {isLive && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-red-400">
              <span className="live-dot" aria-hidden />
              Live
            </span>
          )}
        </span>
        {m.record && <span className="text-xs text-white/50">{m.record}</span>}
      </div>

      <div className="flex items-center justify-between gap-3">
        <TeamScoreBlock name={myWeek.team_name} score={m.my_score} projected={m.my_projected_total} lead={winning} />
        <span className="shrink-0 text-white/30">vs</span>
        <TeamScoreBlock
          name={m.opponent_team_name}
          score={m.opponent_score}
          projected={m.opponent_projected_total}
          lead={!winning}
          align="right"
        />
      </div>

      {m.win_probability !== null && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs text-white/50">
            <span>Win probability</span>
            <span>{m.win_probability}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-sky-400" style={{ width: `${m.win_probability}%` }} />
          </div>
        </div>
      )}

      <a href={`/matchups/${m.matchup_id}`} className="text-sm text-sky-300 hover:underline">
        View full matchup →
      </a>
    </section>
  );
}

function TeamScoreBlock({
  name,
  score,
  projected,
  lead,
  align = "left",
}: {
  name: string;
  score: number | null;
  projected: number;
  lead: boolean;
  align?: "left" | "right";
}) {
  return (
    <div className={`flex min-w-0 flex-col ${align === "right" ? "items-end text-right" : "items-start"}`}>
      <span className="max-w-[10rem] truncate text-sm text-white/70 sm:max-w-[14rem]">{name}</span>
      <span
        className={`score-pop text-2xl font-bold tabular-nums sm:text-3xl ${lead ? "text-white" : "text-white/60"}`}
      >
        {score !== null ? score.toFixed(1) : "—"}
      </span>
      <span className="text-xs text-white/40 tabular-nums">Proj {projected.toFixed(1)}</span>
    </div>
  );
}

function EmptyHero({ title, message }: { title: string; message: string }) {
  return (
    <section className="neon-panel flex flex-col gap-1 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03]">
      <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        Your Week
      </span>
      <span className="font-medium">{title}</span>
      <p className="text-sm text-black/50 dark:text-white/50">{message}</p>
    </section>
  );
}


type Tile = { emoji: string; label: string; accent: string; title: string; subtitle: string };

// One tile per real award field — every one of these is genuine
// computed data (app/domain/weekly_awards.py), not placeholder copy.
// Accent colors are thematic (hot/cold, good/bad), deliberately
// separate from the six section-nav colors (Standings/Matchups/etc.)
// so awards read as their own distinct "entertainment" category.
function buildAwardTiles(awards: WeeklyAwards): Tile[] {
  const tiles: Tile[] = [];

  if (awards.game_of_the_week) {
    tiles.push({
      emoji: "⭐",
      label: "Game of the Week",
      accent: "text-amber-500",
      title: awards.game_of_the_week.winner,
      subtitle: `Won ${awards.game_of_the_week.score}`,
    });
  }
  if (awards.boom_leaders[0]) {
    const b = awards.boom_leaders[0];
    tiles.push({
      emoji: "🔥",
      label: "Boom of the Week",
      accent: "text-orange-500",
      title: b.player_name,
      subtitle: `${b.points_scored.toFixed(1)} pts — ${b.team_name}`,
    });
  }
  if (awards.bust_leaders[0]) {
    const b = awards.bust_leaders[0];
    tiles.push({
      emoji: "🥶",
      label: "Bust of the Week",
      accent: "text-sky-500",
      title: b.player_name,
      subtitle: `${b.points_scored.toFixed(1)} pts — ${b.team_name}`,
    });
  }
  if (awards.biggest_bench_crime) {
    const bc = awards.biggest_bench_crime;
    tiles.push({
      emoji: "💀",
      label: "Biggest Bench Crime",
      accent: "text-slate-500",
      title: `${bc.bench_player} > ${bc.started_player}`,
      subtitle: `+${bc.points_diff.toFixed(1)} pts (${bc.severity}) — ${bc.team_name}`,
    });
  }
  if (awards.overachiever) {
    tiles.push({
      emoji: "📈",
      label: "Overachiever",
      accent: "text-emerald-500",
      title: awards.overachiever.team_name,
      subtitle: `+${awards.overachiever.diff.toFixed(1)} pts vs. expected`,
    });
  }
  if (awards.meltdown) {
    tiles.push({
      emoji: "📉",
      label: "Meltdown",
      accent: "text-red-500",
      title: awards.meltdown.team_name,
      subtitle: `${awards.meltdown.diff.toFixed(1)} pts vs. expected`,
    });
  }
  if (awards.clutch) {
    tiles.push({
      emoji: "🎯",
      label: "Clutch",
      accent: "text-teal-500",
      title: awards.clutch.team_name,
      subtitle: awards.clutch.reason,
    });
  }
  if (awards.choke) {
    tiles.push({
      emoji: "😬",
      label: "Choke",
      accent: "text-purple-500",
      title: awards.choke.team_name,
      subtitle: awards.choke.reason,
    });
  }

  return tiles;
}

function AwardsPreview({ awards }: { awards: WeeklyAwards }) {
  const tiles = buildAwardTiles(awards);
  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {tiles.map((t, i) => (
        <div
          key={i}
          className="flex flex-col gap-0.5 rounded-lg border border-black/10 bg-black/[0.015] p-3 shadow-sm transition-transform active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none"
        >
          <span className={`flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase ${t.accent}`}>
            {t.emoji} {t.label}
          </span>
          <span className="truncate text-sm font-medium">{t.title}</span>
          <span className="truncate text-xs text-black/50 dark:text-white/50">{t.subtitle}</span>
        </div>
      ))}
    </div>
  );
}

function SectionHeader({ color, title, href }: { color: string; title: string; href: string }) {
  return (
    <a href={href} className="flex items-center gap-2 hover:underline">
      <span
        className={`h-2 w-2 rounded-full ${SECTION_ACCENT[color]}`}
        style={{ boxShadow: `0 0 6px ${SECTION_GLOW[color]}` }}
        aria-hidden
      />
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{title}</h2>
    </a>
  );
}

type DiscoveryTile = { color: string; href: string; label: string; description: string };

// Everywhere else in the league you can go from here — deliberately
// broader than the top nav bar (which this section duplicates on
// purpose, since a returning visitor scrolling the homepage shouldn't
// have to scroll back up to find their way around). The Weekend gets
// its own flagship card above the grid since it's the site's one
// major "atmosphere" destination, not just another data page.
function DiscoveryGrid({ season, week }: { season: number | null; week: number | null }) {
  const tiles: DiscoveryTile[] = [
    { color: "standings", href: "/standings", label: "Standings", description: "Full league standings and records" },
    ...(season !== null && week !== null
      ? [
          {
            color: "matchups",
            href: `/seasons/${season}/weeks/${week}`,
            label: "Matchups",
            description: "This week's matchups across the league",
          },
        ]
      : []),
    ...(season !== null
      ? [
          {
            color: "awards",
            href: `/seasons/${season}/awards`,
            label: "Awards",
            description: "Weekly awards and season honors",
          },
        ]
      : []),
    { color: "rivalries", href: "/rivalries", label: "Rivalries", description: "All-time rivalry history and grudges" },
    { color: "players", href: "/players", label: "Player Cards", description: "Browse every team's trading card" },
    { color: "league", href: "/league", label: "League", description: "Every team and owner this season" },
    { color: "rules", href: "/rules", label: "Rules", description: "Scoring, roster, and league settings" },
    { color: "chug", href: "/chug", label: "Chug Leaderboard", description: "Who owes chugs, who's paid up" },
    { color: "chat", href: "/chat", label: "League Chat", description: "Talk to the league, live" },
  ];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Discover</h2>

      <a
        href="/weekend"
        className="discover-weekend-card flex items-center justify-between gap-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/[0.03] p-4 transition-transform active:scale-[0.98]"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-semibold tracking-wide text-fuchsia-500 uppercase dark:text-fuchsia-400">
            The Weekend
          </span>
          <span className="truncate text-sm text-black/60 dark:text-white/60">
            Step into the full live experience
          </span>
        </div>
        <span className="shrink-0 text-fuchsia-500 dark:text-fuchsia-400" aria-hidden>
          →
        </span>
      </a>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map((t) => (
          <DiscoveryTileCard key={t.href} {...t} />
        ))}
      </div>
    </section>
  );
}

function DiscoveryTileCard({ color, href, label, description }: DiscoveryTile) {
  return (
    <a
      href={href}
      className="flex flex-col gap-0.5 rounded-lg border border-black/10 bg-black/[0.015] p-3 shadow-sm transition-all hover:bg-black/5 active:scale-[0.98] active:bg-black/10 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none dark:hover:bg-white/5 dark:active:bg-white/10"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${SECTION_ACCENT[color]}`}
          style={{ boxShadow: `0 0 5px ${SECTION_GLOW[color]}` }}
          aria-hidden
        />
        {label}
      </span>
      <span className="truncate text-xs text-black/50 dark:text-white/50">{description}</span>
    </a>
  );
}
