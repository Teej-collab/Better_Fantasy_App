import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  buildNflTickerItems,
  getCurrentWeek,
  getMe,
  getMyPreferences,
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
  resolveWeek,
  safeLatestSeason,
  type HomeGridLayoutItem,
  type Rivalry,
  type StandingsRow,
  type TickerItem,
  type WeekMatchupContextItem,
  type WeeklyAwards,
  type YourWeek,
} from "@/lib/api";
import { GameDayRefresher } from "@/components/GameDayRefresher";
import { HomeDashboard } from "@/components/HomeDashboard";
import { HomeWelcomeBackEntry } from "@/components/HomeWelcomeBackEntry";
import { LiveTicker } from "@/components/LiveTicker";
import { OpeningExperience } from "@/components/OpeningExperience";
import { getLiveGames, withGamecastLinks } from "@/lib/gamecastApi";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";
import { DESTINATIONS, type DestinationKey } from "@/lib/navDestinations";

// The homepage's six reorderable dashboard cards, in the app's own
// default order — same set backend/app/routers/settings.py validates
// home_card_order against. A card only ever renders when its own data
// condition is true (see how `cards` is built below); this array is
// just the fallback order for whichever cards are actually present,
// used both as the very first visit's order (before an owner has
// dragged anything) and to fill in any card missing from an owner's
// saved order (a stale save, or a new card type added after they set
// theirs).
const DEFAULT_CARD_ORDER = ["yourWeek", "standings", "matchups", "rivalries", "awards", "discover"];

// Human-readable labels for HomeCardDeck's "+ Add Box" picker — the
// picker needs to name a card even while it's hidden (and so has no
// rendered content to read a title from).
const CARD_LABELS: Record<string, string> = {
  yourWeek: "Your Week",
  standings: "League Standings",
  matchups: "Other Matchups",
  rivalries: "Rivalries",
  awards: "This Week's Awards",
  discover: "Discover",
};

function mergeCardOrder(saved: string | null | undefined, validKeys: string[]): string[] {
  let order: string[] = [];
  if (saved) {
    try {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        order = parsed.filter((k): k is string => typeof k === "string" && validKeys.includes(k));
      }
    } catch {
      // Malformed saved value — fall through to the default order below
      // rather than breaking the whole homepage over one bad cookie/row.
    }
  }
  for (const key of DEFAULT_CARD_ORDER) {
    if (validKeys.includes(key) && !order.includes(key)) order.push(key);
  }
  return order;
}

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
    const [nflGames, gamecastGames] = await Promise.all([getNflScoreboard(), getLiveGames()]);
    return (
      <OpeningExperience
        tickerItems={withGamecastLinks(buildNflTickerItems(nflGames), nflGames, gamecastGames)}
        isGameDay={isNflGameLive(nflGames)}
      />
    );
  }

  const { seasons } = await listSeasons();
  const season = safeLatestSeason(seasons);

  const [myWeek, nflGames, myPreferences, gamecastGames] = await Promise.all([
    getMyWeek(sessionCookie),
    getNflScoreboard(),
    getMyPreferences(sessionCookie),
    getLiveGames(),
  ]);
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
    week = resolveWeek(current_week);
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

  // Cards the owner has deliberately removed via "Edit Home" mode
  // (HomeCardDeck.tsx) — checked below at each card's own assignment,
  // not by skipping these fetches: standings/weeklyAwards/weekMatchups
  // are also read by the always-visible ticker just above (see
  // buildTickerItems and leagueTickerItems), so they can't be skipped
  // just because their OWN card is hidden — only Your Week, Standings,
  // Matchups, Rivalries, Awards, and Discover as literal dashboard
  // cards are ever gated on this.
  let hiddenCards: Set<string> = new Set();
  if (myPreferences?.home_hidden_cards) {
    try {
      const parsed: unknown = JSON.parse(myPreferences.home_hidden_cards);
      if (Array.isArray(parsed)) hiddenCards = new Set(parsed.filter((k): k is string => typeof k === "string"));
    } catch {
      // Malformed saved value — treat as "nothing hidden" rather than
      // breaking the homepage over one bad row.
    }
  }

  // "Other" = every matchup except the logged-in owner's own (already
  // shown in the hero above). When logged out, myWeek is null and
  // nothing gets excluded — every matchup is "other".
  const otherMatchups = weekMatchups.filter((m) => m.matchup_id !== myWeek?.matchup?.matchup_id);
  const rivalryGamesThisWeek = weekMatchups.filter((m) => m.is_rivalry);

  const tickerItems = withGamecastLinks(
    buildTickerItems(nflGames, weeklyAwards, standings, weekPlayed, rivalryGamesThisWeek),
    nflGames,
    gamecastGames
  );

  // The six reorderable dashboard cards — only the ones with something
  // real to show this week end up in this map at all (same conditions
  // this page always used to gate each section with), so a stale or
  // partial saved order can never conjure up a card whose data isn't
  // there. See HomeCardDeck.tsx for how these actually get reordered
  // and DEFAULT_CARD_ORDER above for the merge-with-saved-order logic.
  const cards: Record<string, ReactNode> = {};

  if (!hiddenCards.has("yourWeek")) {
    cards.yourWeek = myWeek?.matchup ? (
      <YourWeekHero myWeek={myWeek} isGameDay={isGameDay} />
    ) : myWeek ? (
      <EmptyHero
        title={myWeek.team_name}
        message={
          // ESPN reports current_week as 0 during preseason — not a real
          // week, same convention as the Team page's fallback.
          myWeek.week === null || myWeek.week < 1
            ? "No matchup yet — the season hasn't started."
            : "No matchup this week (bye week or the schedule isn't set yet)."
        }
      />
    ) : (
      // Reaching this branch means /me/week itself failed even though
      // getMe (above) confirmed a valid session — a transient fetch
      // error, not "not signed in" (that's already handled by the early
      // OpeningExperience return before this component fetches anything
      // else).
      <EmptyHero title="Your Week" message="Couldn't load your matchup right now — try refreshing." />
    );
  }

  if (standings.length > 0 && !hiddenCards.has("standings")) {
    cards.standings = (
      <section className="flex flex-col gap-2">
        <SectionHeader color="standings" title="League Standings" href="/standings" />
        <ol
          className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
          style={panelGlowStyle(SECTION_COLORS.standings)}
        >
          {standings.slice(0, 5).map((row, i) => (
            <li key={row.team_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors">
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
    );
  }

  if (otherMatchups.length > 0 && !hiddenCards.has("matchups")) {
    cards.matchups = (
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
                <Link
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
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if ((rivalryGamesThisWeek.length > 0 || topRivalries.length > 0) && !hiddenCards.has("rivalries")) {
    cards.rivalries = (
      <section className="flex flex-col gap-2">
        <SectionHeader color="rivalries" title="Rivalries" href="/rivalries" />
        {rivalryGamesThisWeek.length > 0 ? (
          <ul
            className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
            style={panelGlowStyle(SECTION_COLORS.rivalries)}
          >
            {rivalryGamesThisWeek.map((m) => (
              <li key={m.matchup_id}>
                <Link
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
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <ul
            className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
            style={panelGlowStyle(SECTION_COLORS.rivalries)}
          >
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
    );
  }

  if (weekPlayed && weeklyAwards && season !== null && week !== null && !hiddenCards.has("awards")) {
    cards.awards = (
      <section className="flex flex-col gap-2">
        <SectionHeader color="awards" title="This Week's Awards" href={`/seasons/${season}/awards`} />
        <AwardsPreview awards={weeklyAwards} />
      </section>
    );
  }

  if (!hiddenCards.has("discover")) cards.discover = <DiscoveryGrid />;

  const cardOrder = mergeCardOrder(myPreferences?.home_card_order, Object.keys(cards));

  // Desktop-only grid position/size — a separate shape from
  // home_card_order (mobile's ordered list), see HomeGridDesktop.tsx.
  let desktopLayout: HomeGridLayoutItem[] | null = null;
  if (myPreferences?.home_desktop_layout) {
    try {
      const parsed: unknown = JSON.parse(myPreferences.home_desktop_layout);
      if (Array.isArray(parsed)) desktopLayout = parsed as HomeGridLayoutItem[];
    } catch {
      desktopLayout = null;
    }
  }

  return (
    <HomeWelcomeBackEntry displayName={me.display_name}>
      <div className="flex flex-col gap-6">
        {/* Fixed behind everything, ignores PageShell's centered column so
            it washes the full viewport — three soft brand-colored glows,
            restrained compared to /weekend's full neon treatment per the
            brief ("neon as accent, not the whole design"). This is the
            fix for the homepage reading as a flat black-and-white screen. */}
        <div className="home-ambient" aria-hidden />
        {isGameDay && <GameDayRefresher />}

        <div className="rise-in">
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
        </div>

        <HomeDashboard
          // Forces a real remount (not just a prop update) whenever the
          // set of currently-visible cards changes — specifically after
          // "Add Box" triggers router.refresh(), so the mounted shell's
          // useState initializers see the newly-un-hidden card's real
          // content rather than reconciling against stale local state.
          dashboardKey={Object.keys(cards).sort().join(",")}
          initialOrder={cardOrder}
          cards={cards}
          hiddenCards={[...hiddenCards]}
          cardLabels={CARD_LABELS}
          savedDesktopLayout={desktopLayout}
        />
      </div>
    </HomeWelcomeBackEntry>
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

      <Link href={`/matchups/${m.matchup_id}`} className="text-sm text-sky-300 hover:underline">
        View full matchup →
      </Link>
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

function SectionHeader({ color, title, href }: { color: DestinationKey; title: string; href: string }) {
  const hex = DESTINATIONS[color].color;
  return (
    <Link href={href} className="flex items-center gap-2 hover:underline">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hex, boxShadow: `0 0 6px ${hex}` }} aria-hidden />
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{title}</h2>
    </Link>
  );
}

type DiscoveryTile = { color: DestinationKey; href: string; label: string; description: string };

// A curated shortcut list, NOT a full duplicate of the top nav bar
// anymore — League, Matchups, Chat are already top-level tabs on both
// PrimaryNav (desktop) and BottomNav (mobile), and Awards already has
// its own dedicated homepage card just above this one when there's a
// current season. What's left here is exactly the set that otherwise
// requires detouring through League's own sub-nav first. The Weekend
// gets its own flagship card above the grid since it's the site's one
// major "atmosphere" destination, not just another data page.
function DiscoveryGrid() {
  const tiles: DiscoveryTile[] = [
    { color: "standings", href: "/standings", label: "Standings", description: "Full league standings and records" },
    { color: "rivalries", href: "/rivalries", label: "Rivalries", description: "All-time rivalry history and grudges" },
    { color: "playerCards", href: "/players", label: "Player Cards", description: "Browse every team's trading card" },
    { color: "rules", href: "/rules", label: "Rules", description: "Scoring, roster, and league settings" },
    { color: "chug", href: "/chug", label: "Chug Leaderboard", description: "Who owes chugs, who's paid up" },
  ];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Discover</h2>

      <Link
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
      </Link>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map((t) => (
          <DiscoveryTileCard key={t.href} {...t} />
        ))}
      </div>
    </section>
  );
}

function DiscoveryTileCard({ color, href, label, description }: DiscoveryTile) {
  const hex = DESTINATIONS[color].color;
  return (
    <Link
      href={href}
      className="flex flex-col gap-0.5 rounded-lg border border-black/10 bg-black/[0.015] p-3 shadow-sm transition-all hover:bg-black/5 active:scale-[0.98] active:bg-black/10 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none dark:hover:bg-white/5 dark:active:bg-white/10"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: hex, boxShadow: `0 0 5px ${hex}` }} aria-hidden />
        {label}
      </span>
      <span className="truncate text-xs text-black/50 dark:text-white/50">{description}</span>
    </Link>
  );
}
