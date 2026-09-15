import type { ReactNode } from "react";
import Link from "next/link";
import {
  type ChugFeedEntry,
  type NflGame,
  type Rivalry,
  type StandingsRow,
  type TickerItem,
  type WeekMatchupContextItem,
  type WeekPowerRanking,
  type WeeklyAwards,
  type WeeklyNarrative,
  type YourWeek,
} from "@/lib/api";
import { AwardsPreview, WeeklyRecapTeaser } from "@/app/(home)/page";
import { ChugFeed } from "@/components/ChugFeed";
import { MovementBadge } from "@/components/MovementBadge";
import { LiveTicker } from "@/components/LiveTicker";
import { GameDayRefresher } from "@/components/GameDayRefresher";
import { WeekRecapSection } from "@/components/WeekRecapSection";
import { findGamecastId } from "@/lib/gamecastApi";
import type { GamecastLiveGameSummary } from "@/lib/gamecastApi";

/**
 * Settings > Labs > "Try the new look" (owner_preferences.beta_layout)
 * render of Home — Documentation/UX/00_UX_Audit.md's single biggest
 * Home finding: the user's own live matchup could rank below a
 * one-time Draft Grades card, or arbitrarily low in the reorderable
 * card deck, because nothing pinned it. This component fixes that by
 * construction — Your Week is the first thing after the ticker, full
 * stop, not a slot in a reorderable deck (see
 * Documentation/UX/06_Implementation_Roadmap.md P0 item 4) — and every
 * other card is flat (.wl-card) instead of .neon-panel's permanent
 * rotating glow ring, reserving motion for the hero only while a game
 * is actually live. The Discover grid is gone entirely: League and
 * More (BottomNavBeta/PrimaryNavBeta) now give every one of those
 * destinations a single canonical path instead of a second one here
 * (Documentation/UX/02_Information_Architecture.md).
 *
 * Receives the exact data (home)/page.tsx already fetched for the
 * legacy render — no separate data-fetching path, so the two renders
 * can never disagree about what's actually true this week.
 */
export function HomePageBeta({
  myWeek,
  isGameDay,
  tickerItems,
  leagueTickerItems,
  activeLeagueName,
  standings,
  powerRankings,
  weekPlayed,
  season,
  otherMatchups,
  currentWeek,
  rivalryGamesThisWeek,
  topRivalries,
  weeklyAwards,
  weeklyRecap,
  isCommissioner,
  chugFeed,
  liveNflGames,
  gamecastGames,
  draftCountdownOrChugCard,
}: {
  myWeek: YourWeek | null;
  isGameDay: boolean;
  tickerItems: TickerItem[];
  leagueTickerItems: TickerItem[];
  activeLeagueName: string | null;
  standings: StandingsRow[];
  powerRankings: WeekPowerRanking[];
  weekPlayed: boolean;
  season: number | null;
  otherMatchups: WeekMatchupContextItem[];
  currentWeek: number | null;
  rivalryGamesThisWeek: WeekMatchupContextItem[];
  topRivalries: Rivalry[];
  weeklyAwards: WeeklyAwards | null;
  weeklyRecap: WeeklyNarrative | null;
  isCommissioner: boolean;
  chugFeed: ChugFeedEntry[];
  liveNflGames: NflGame[];
  gamecastGames: GamecastLiveGameSummary[];
  draftCountdownOrChugCard: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="home-ambient" aria-hidden />
      {isGameDay && <GameDayRefresher />}

      <div className="rise-in flex flex-col gap-1.5">
        <LiveTicker items={tickerItems} fast={isGameDay} />
        {leagueTickerItems.length > 0 && (
          <div className="flex flex-col gap-1">
            {activeLeagueName && (
              <span className="text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                {activeLeagueName}
              </span>
            )}
            <LiveTicker items={leagueTickerItems} fast={isGameDay} />
          </div>
        )}
      </div>

      {/* Pinned, not reorderable, not out-ranked by anything else on
          this page — the P0 fix. */}
      {myWeek?.matchup ? (
        <YourWeekHeroBeta myWeek={myWeek} isGameDay={isGameDay} />
      ) : myWeek ? (
        <EmptyHeroBeta
          title={myWeek.team_name}
          message={
            myWeek.week === null || myWeek.week < 1
              ? "No matchup yet — the season hasn't started."
              : "No matchup this week (bye week or the schedule isn't set yet)."
          }
        />
      ) : (
        <EmptyHeroBeta
          title="Your Week"
          message="You're signed in, but not on a team yet."
          cta={{ href: "/leagues", label: "Join or create a league →" }}
        />
      )}

      {draftCountdownOrChugCard}

      {liveNflGames.length > 0 && (
        <FlatSectionCard title="Live Now" href="/gamecast" live>
          {liveNflGames.map((g) => {
            const gamecastId = findGamecastId(g.home_team, g.away_team, gamecastGames);
            const row = (
              <>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="live-dot" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">
                      {g.away_team ?? "—"} @ {g.home_team ?? "—"}
                    </span>
                    <span className="truncate text-xs text-black/50 dark:text-white/50">{g.status_detail}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums text-black/70 dark:text-white/70">
                  <span className="block">{g.home_score ?? "—"}</span>
                  <span className="block">{g.away_score ?? "—"}</span>
                </span>
              </>
            );
            return (
              <FlatRow key={g.id} href={gamecastId ? `/gamecast/${gamecastId}` : undefined}>
                {row}
              </FlatRow>
            );
          })}
        </FlatSectionCard>
      )}

      {/* Above Standings — real, but only shows up once a week's games
          are actually in the books, so it's a highlight worth surfacing
          right after the live/hero content rather than buried below the
          full-season standings that are always there (2026-09 request). */}
      {weekPlayed && weeklyAwards && season !== null && currentWeek !== null && (
        <section className="flex flex-col gap-2">
          <SectionHeaderBeta title="This Week's Awards" href={`/seasons/${season}/awards`} />
          <AwardsPreview awards={weeklyAwards} />
          {currentWeek > 1 && (
            weeklyRecap ? (
              <WeeklyRecapTeaser recap={weeklyRecap} season={season} week={currentWeek - 1} />
            ) : (
              isCommissioner && (
                <WeekRecapSection season={season} week={currentWeek - 1} narrative={null} canGenerate />
              )
            )
          )}
        </section>
      )}

      {standings.length > 0 && (
        <FlatSectionCard title="Standings" href="/standings">
          {standings.slice(0, 5).map((row, i) => (
            <FlatRow key={row.team_id}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-black/50 tabular-nums dark:text-white/50">{i + 1}</span>
                <span className="truncate">{row.team_name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-black/60 dark:text-white/60">
                {row.wins}-{row.losses}
                {row.ties ? `-${row.ties}` : ""}
              </span>
            </FlatRow>
          ))}
        </FlatSectionCard>
      )}

      {powerRankings.length > 0 && (
        <FlatSectionCard title="Power Rankings" href="/power-rankings">
          {powerRankings.slice(0, 5).map((row) => (
            <FlatRow key={row.team_id}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 font-bold text-black/50 tabular-nums dark:text-white/50">
                  {row.power_rank}
                </span>
                <span className="truncate">{row.team_name}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums">
                <MovementBadge movement={row.movement} />
              </span>
            </FlatRow>
          ))}
        </FlatSectionCard>
      )}

      {otherMatchups.length > 0 && (
        <FlatSectionCard
          title="Other Matchups"
          href={season !== null && currentWeek !== null ? `/seasons/${season}/weeks/${currentWeek}` : "/standings"}
        >
          {otherMatchups.map((m) => {
            const started =
              m.home.score !== null && m.away.score !== null && !(m.home.score === 0 && m.away.score === 0);
            return (
              <FlatRow key={m.matchup_id} href={`/matchups/${m.matchup_id}`}>
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
              </FlatRow>
            );
          })}
        </FlatSectionCard>
      )}

      {(rivalryGamesThisWeek.length > 0 || topRivalries.length > 0) && (
        <FlatSectionCard title="Rivalries" href="/rivalries">
          {rivalryGamesThisWeek.length > 0
            ? rivalryGamesThisWeek.map((m) => (
                <FlatRow key={m.matchup_id} href={`/matchups/${m.matchup_id}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span>{m.rivalry?.emoji ?? "⚔️"}</span>
                    <span className="truncate font-medium">{m.rivalry?.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-black/50 dark:text-white/50">
                    {m.head_to_head.wins_home}-{m.head_to_head.wins_away}
                  </span>
                </FlatRow>
              ))
            : topRivalries.map((r) => (
                <FlatRow key={r.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span>{r.emoji ?? "⚔️"}</span>
                    <span className="truncate font-medium">{r.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-black/50 dark:text-white/50">
                    {r.owner_a_name} {r.all_time_wins_a}-{r.all_time_wins_b} {r.owner_b_name}
                  </span>
                </FlatRow>
              ))}
        </FlatSectionCard>
      )}

      {chugFeed.length > 0 && <ChugFeed chugs={chugFeed} />}
    </div>
  );
}

function YourWeekHeroBeta({ myWeek, isGameDay }: { myWeek: YourWeek; isGameDay: boolean }) {
  const m = myWeek.matchup!;
  const winning = m.my_score !== null && m.opponent_score !== null && m.my_score >= m.opponent_score;
  const isLive = m.started && isGameDay;

  return (
    <section className={`flex flex-col gap-3 rounded-xl p-4 text-white ${isLive ? "wl-card--live" : "wl-card"}`}>
      <div className="flex items-center justify-between">
        <span
          className="flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase"
          style={{ color: "var(--your-week-color, var(--user-accent, var(--wl-accent)))" }}
        >
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
        <TeamScoreBlockBeta name={myWeek.team_name} score={m.my_score} projected={m.my_projected_total} lead={winning} />
        <span className="shrink-0 text-white/30">vs</span>
        <TeamScoreBlockBeta
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

      <div className="flex items-center gap-4">
        <Link href={`/matchups/${m.matchup_id}`} className="text-sm text-sky-300 hover:underline">
          View full matchup →
        </Link>
        <Link href="/team" className="text-sm text-white/50 hover:underline">
          My lineup →
        </Link>
      </div>
    </section>
  );
}

function TeamScoreBlockBeta({
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
      <span className={`score-pop text-2xl font-bold tabular-nums sm:text-3xl ${lead ? "text-white" : "text-white/60"}`}>
        {score !== null ? score.toFixed(1) : "—"}
      </span>
      <span className="text-xs text-white/40 tabular-nums">Proj {projected.toFixed(1)}</span>
    </div>
  );
}

function EmptyHeroBeta({
  title,
  message,
  cta,
}: {
  title: string;
  message: string;
  cta?: { href: string; label: string };
}) {
  return (
    <section
      className="wl-card flex flex-col gap-1.5 rounded-xl p-4"
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, var(--your-week-color, var(--user-accent, var(--wl-accent))) 14%, transparent), color-mix(in srgb, var(--your-week-color, var(--user-accent, var(--wl-accent))) 2%, transparent))`,
        borderColor: `color-mix(in srgb, var(--your-week-color, var(--user-accent, var(--wl-accent))) 40%, transparent)`,
      }}
    >
      <span className="text-xs font-bold tracking-wide uppercase" style={{ color: "var(--your-week-color, var(--user-accent, var(--wl-accent)))" }}>
        Your Week
      </span>
      <span className="font-display text-lg font-semibold tracking-wide uppercase">{title}</span>
      <p className="text-sm text-black/50 dark:text-white/50">{message}</p>
      {cta && (
        <Link href={cta.href} className="mt-1 text-sm font-semibold" style={{ color: "var(--your-week-color, var(--user-accent, var(--wl-accent)))" }}>
          {cta.label}
        </Link>
      )}
    </section>
  );
}

function SectionHeaderBeta({ title, href }: { title: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 hover:underline">
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{title}</h2>
    </Link>
  );
}

// Documentation/UX/03_Component_System.md's <RankedCategoryCard>/flat
// list pattern, applied here — one shared wrapper instead of Standings/
// Power Rankings/Matchups/Rivalries each hand-rolling their own
// `.neon-panel flex flex-col divide-y ...` string (the exact
// duplication 00_UX_Audit.md flags). `live` renders the static
// .wl-card--live accent instead of the flat default, for the one
// section (Live Now) that's genuinely real-time.
function FlatSectionCard({ title, href, live = false, children }: { title: string; href: string; live?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeaderBeta title={title} href={href} />
      <div className={`flex flex-col divide-y divide-black/5 rounded-lg dark:divide-white/5 ${live ? "wl-card--live" : "wl-card"}`}>
        {children}
      </div>
    </section>
  );
}

function FlatRow({ href, children }: { href?: string; children: ReactNode }) {
  const className = "flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors";
  if (href) {
    return (
      <Link href={href} className={`${className} hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10`}>
        {children}
      </Link>
    );
  }
  return <div className={className}>{children}</div>;
}
