import { requireOptionalNativeModule } from 'expo';

import { BENCH_SLOT_LABEL, IR_SLOT_LABEL, TAXI_SLOT_LABEL } from '@/lib/rosterSlots';
import type { MyTeam, NflGame, StandingsRow, WeeklyAwards, YourWeek } from '@/lib/types';
import { initialsFor, syncTeamLogos, widgetAssetDir } from '@/lib/widgetAssets';
import type { LeagueWidgetProps } from '@/widgets/LeagueWidget';
import type { MatchupWidgetProps, WidgetPlayer } from '@/widgets/MatchupWidget';

// The home-screen and Lock Screen widgets arrived in a native build;
// builds from before them get this code over the air without the
// ExpoWidgets module, and expo-widgets throws on import there. So check
// first and load the widgets lazily.
export const canUseWidgets = requireOptionalNativeModule('ExpoWidgets') !== null;

const BENCHED = new Set([BENCH_SLOT_LABEL, IR_SLOT_LABEL, TAXI_SLOT_LABEL]);

function gameFor(team: string | null, games: NflGame[]): NflGame | undefined {
  if (!team) return undefined;
  return games.find((g) => g.home_team === team || g.away_team === team);
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}

/** Your starters whose NFL games are on right now, best first. */
export function playingNow(team: MyTeam | null | undefined, games: NflGame[]): WidgetPlayer[] {
  if (!team) return [];
  return team.roster
    .filter((e) => !BENCHED.has(e.lineup_slot))
    .map((e) => ({ e, game: gameFor(e.pro_team, games) }))
    .filter(({ game }) => game?.state === 'in')
    .sort((a, b) => (b.e.points ?? 0) - (a.e.points ?? 0))
    .map(({ e, game }) => ({
      pos: e.position === 'DEF' ? 'DST' : e.position,
      name: e.player_name.split(' ').slice(-1)[0] === e.player_name ? e.player_name : `${e.player_name[0]}. ${e.player_name.split(' ').slice(1).join(' ')}`,
      pts: e.points ?? 0,
      detail: game?.status_detail ?? '',
    }));
}

/** Your starter who kicks off next. */
export function nextUp(team: MyTeam | null | undefined, now = Date.now()): MatchupWidgetProps['nextUp'] {
  if (!team) return null;
  const upcoming = team.roster
    .filter((e) => !BENCHED.has(e.lineup_slot) && !e.is_locked && e.game_time && new Date(e.game_time).getTime() > now)
    .sort((a, b) => new Date(a.game_time!).getTime() - new Date(b.game_time!).getTime())[0];
  if (!upcoming) return null;
  return {
    name: upcoming.player_name,
    detail: `${upcoming.next_opponent ?? ''} · ${shortTime(upcoming.game_time!)}`.trim(),
    projected: upcoming.points_projected ?? 0,
  };
}

export function widgetPropsFor(
  week: YourWeek | null,
  extras: { team?: MyTeam | null; games?: NflGame[] } = {},
  now = Date.now(),
): MatchupWidgetProps {
  const m = week?.matchup ?? null;
  if (!week || !m) {
    return {
      state: 'none', week: week?.week ?? null, myName: '', oppName: '', myScore: 0, oppScore: 0,
      myProjected: 0, oppProjected: 0, myLeft: 0, oppLeft: 0, winProbability: null,
      url: 'weekendleague://', updatedAt: now,
    };
  }
  const myLeft = m.my_yet_to_play + m.my_in_play;
  const oppLeft = m.opponent_yet_to_play + m.opponent_in_play;
  const state: MatchupWidgetProps['state'] = !m.started
    ? 'pre'
    : m.my_in_play + m.opponent_in_play > 0
      ? 'live'
      : myLeft + oppLeft === 0
        ? 'final'
        : 'between';
  return {
    state,
    week: week.week,
    myName: week.team_name,
    oppName: m.opponent_team_name,
    myScore: m.my_score ?? 0,
    oppScore: m.opponent_score ?? 0,
    myProjected: m.my_projected_total,
    oppProjected: m.opponent_projected_total,
    myLeft,
    oppLeft,
    winProbability: m.win_probability,
    url: `weekendleague://matchup/${m.matchup_id}`,
    updatedAt: now,
    myTeamId: week.team_id,
    oppTeamId: m.opponent_team_id,
    myInitials: initialsFor(m.my_owner_name ?? week.team_name),
    oppInitials: initialsFor(m.opponent_owner_name ?? m.opponent_team_name),
    logoDir: widgetAssetDir(),
    playing: playingNow(extras.team, extras.games ?? []).slice(0, 3),
    nextUp: nextUp(extras.team, now),
  };
}

/** The next Wednesday 3:00 AM Eastern waiver run (backend/app/scheduler.py). */
export function nextWaiverRun(now = Date.now()): number {
  const eastern = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).format(d).includes('EDT') ? 4 : 5;
  for (let days = 0; days < 8; days++) {
    const d = new Date(now + days * 86_400_000);
    const candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3 + eastern(d));
    const weekday = new Date(candidate - eastern(d) * 3_600_000).getUTCDay();
    if (weekday === 3 && candidate > now) return candidate;
  }
  return now + 7 * 86_400_000;
}

export function leagueWidgetPropsFor(input: {
  week: YourWeek | null;
  season: number | null;
  leagueName: string | null;
  standings: StandingsRow[];
  awards: { awards: WeeklyAwards; week: number } | null;
}): LeagueWidgetProps {
  const { week, standings, awards } = input;
  const index = week ? standings.findIndex((s) => s.team_id === week.team_id) : -1;
  const row = index >= 0 ? standings[index] : null;
  const a = awards?.awards;
  const items: LeagueWidgetProps['awards'] = [];
  if (a?.overachiever) items.push({ label: 'Overachiever', who: a.overachiever.team_name, value: `+${a.overachiever.diff.toFixed(1)}`, tone: 'good' });
  if (a?.biggest_bench_crime)
    items.push({ label: 'Bench crime', who: a.biggest_bench_crime.team_name, value: `-${a.biggest_bench_crime.points_diff.toFixed(1)}`, tone: 'bad' });
  if (a?.boom_leaders[0]) items.push({ label: 'Top player', who: a.boom_leaders[0].player_name, value: a.boom_leaders[0].points_scored.toFixed(1), tone: 'fun' });
  return {
    leagueName: input.leagueName,
    standing: row ? index + 1 : null,
    standingDelta: null,
    record: row ? `${row.wins}–${row.losses}${row.ties ? `–${row.ties}` : ''}` : null,
    pointsFor: row ? Number(row.points_for) : null,
    powerRank: week?.power_rank ?? null,
    waiversAt: nextWaiverRun(),
    awardsWeek: awards?.week ?? null,
    awards: items,
    url: 'weekendleague://league?section=standings',
    recapUrl: input.season && awards?.week ? `weekendleague://recap/${input.season}/${awards.week}` : 'weekendleague://league',
  };
}

// The snapshot is saved to the shared UserDefaults, which can't hold null
// (it's not a property-list value): one null and the save throws, and the
// widget never gets a snapshot — the League widget, whose props always had
// standingDelta: null, sat black on the Home Screen. So nulls are left out;
// the widgets read a missing field the same way.
function withoutNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined).map(withoutNulls) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, withoutNulls(v)]),
    ) as T;
  }
  return value;
}

// Skip identical snapshots (the live refetch runs every few seconds) so
// the widget isn't reloaded for nothing; updatedAt is left out of the
// comparison or nothing would ever match.
let lastSignature: string | null = null;
let lastLeagueSignature: string | null = null;

export function updateMatchupWidget(week: YourWeek | null, extras: { team?: MyTeam | null; games?: NflGame[] } = {}): void {
  if (!canUseWidgets) return;
  const props = widgetPropsFor(week, extras);
  const { updatedAt: _ignored, ...rest } = props;
  const signature = JSON.stringify(rest);
  if (signature === lastSignature) return;
  lastSignature = signature;
  // Logos first (a no-op when they're already saved), then the snapshot.
  void syncTeamLogos([
    { teamId: week?.team_id, url: week?.matchup?.my_logo_url },
    { teamId: week?.matchup?.opponent_team_id, url: week?.matchup?.opponent_logo_url },
  ])
    .catch(() => {})
    .then(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const widget = (require('@/widgets/MatchupWidget') as typeof import('@/widgets/MatchupWidget')).default;
        widget.updateSnapshot(withoutNulls(props));
      } catch (e) {
        // A widget that can't update just keeps its last snapshot.
        lastSignature = null;
        console.warn('Matchup widget update failed', e);
      }
    });
}

export function updateLeagueWidget(props: LeagueWidgetProps | null): void {
  if (!canUseWidgets || !props) return;
  const signature = JSON.stringify({ ...props, waiversAt: null });
  if (signature === lastLeagueSignature) return;
  lastLeagueSignature = signature;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const widget = (require('@/widgets/LeagueWidget') as typeof import('@/widgets/LeagueWidget')).default;
    widget.updateSnapshot(withoutNulls(props));
  } catch (e) {
    // Keeps its last snapshot.
    lastLeagueSignature = null;
    console.warn('League widget update failed', e);
  }
}
