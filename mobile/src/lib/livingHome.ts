import * as SecureStore from 'expo-secure-store';
import { useState } from 'react';

import type { MatchupContextSide, NflGame, RosterEntry, YourWeek } from '@/lib/types';

// The living home screen (2026-10-13) is native-only and, for now, only
// for TJ (owner 4) and Niko (owner 1) to try before anyone else sees it.
const TESTER_OWNER_IDS = new Set([1, 4]);

export function isLivingHomeTester(ownerId: number | null | undefined): boolean {
  return ownerId != null && TESTER_OWNER_IDS.has(ownerId);
}

// A tester can flip back to the classic home from the bottom of the new
// one (and back again from the classic one); remembered on this phone.
const OFF_KEY = 'living-home-off';

export function useLivingHomeSwitch(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return SecureStore.getItem(OFF_KEY) !== '1';
    } catch {
      return true;
    }
  });
  function set(next: boolean) {
    setOn(next);
    try {
      SecureStore.setItem(OFF_KEY, next ? '0' : '1');
    } catch {
      // Not remembered; fine for this session.
    }
  }
  return [on, set];
}

// The fantasy week's moods, in the order a week goes.
export type HomePhase =
  | 'recap' // Tuesday after the flip: last week's story
  | 'waivers' // Wednesday: what the 3 AM run did, the new matchup
  | 'lock' // a game tonight with one of your starters in it
  | 'prep' // Thu–Sun before kickoff: lineup checks
  | 'live' // games on with your players in them
  | 'sweat' // Monday with your matchup still undecided
  | 'final'; // your matchup is done, the week hasn't flipped yet

const ET = 'America/New_York';

// The weekday (0 = Sunday) and hour in Eastern time — the league's clock.
export function etDayHour(when: Date): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(when);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday), hour };
}

function sameEtDay(a: Date, b: Date): boolean {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: 'numeric', day: 'numeric' });
  return f.format(a) === f.format(b);
}

// The next time it's `day` at `hour`:00 Eastern, stepping an hour at a time.
export function nextEt(day: number, hour: number, from = new Date()): Date {
  const t = new Date(from);
  t.setMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 8; i++) {
    t.setTime(t.getTime() + 60 * 60 * 1000);
    const et = etDayHour(t);
    if (et.day === day && et.hour === hour) return t;
  }
  return t;
}

export function isStarter(slot: string | null | undefined): boolean {
  return !!slot && !['BE', 'IR', 'TAXI'].includes(slot);
}

// Your matchup is decided: everyone on both sides has played.
export function matchupDone(myWeek: YourWeek | null): boolean {
  const m = myWeek?.matchup;
  return !!m && m.started && m.my_yet_to_play + m.my_in_play + m.opponent_yet_to_play + m.opponent_in_play === 0;
}

// Your starters whose game kicks off later today (Eastern).
export function startersPlayingToday(roster: RosterEntry[], now = new Date()): RosterEntry[] {
  return roster.filter((p) => isStarter(p.lineup_slot) && !p.is_locked && p.game_time && sameEtDay(new Date(p.game_time), now));
}

export function homePhase({
  now = new Date(),
  myWeek,
  games,
  roster,
}: {
  now?: Date;
  myWeek: YourWeek | null;
  games: NflGame[];
  roster: RosterEntry[];
}): HomePhase {
  const { day } = etDayHour(now);
  const m = myWeek?.matchup;
  if (matchupDone(myWeek)) return 'final';
  const live = games.some((g) => g.state === 'in');
  if (m?.started && live) return day === 1 ? 'sweat' : 'live';
  if (m?.started && day === 1) return 'sweat';
  // Sunday night once the day's games are done, with Monday still to come.
  const moreToday = games.some((g) => g.state === 'pre' && g.date && sameEtDay(new Date(g.date), now));
  if (m?.started && day === 0 && !moreToday) return 'sweat';
  if (day === 2) return 'recap';
  if (day === 3) return 'waivers';
  if (startersPlayingToday(roster, now).length > 0) return 'lock';
  return 'prep';
}

// The phase's label color, so the screen looks different by mood.
export const PHASE_COLOR: Record<HomePhase, string> = {
  recap: '#f5b942',
  waivers: '#4cc3ff',
  lock: '#ff8a3d',
  prep: '#2dd4bf',
  live: '#39ff14',
  sweat: '#ff8a3d',
  final: '#39ff14',
};

export function dayName(now = new Date()): string {
  return now.toLocaleDateString('en-US', { timeZone: ET, weekday: 'long' });
}

// "4h 12m" / "16h 42m" / "2d 4h".
export function untilText(target: Date, now = new Date()): string {
  const mins = Math.max(0, Math.round((target.getTime() - now.getTime()) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmt(points: number | null | undefined): string {
  return points == null ? '–' : points.toFixed(1);
}

// My side of a matchup-context item, by team.
export function sideFor<T extends { home: MatchupContextSide; away: MatchupContextSide }>(
  items: T[],
  teamId: number,
): { item: T; me: MatchupContextSide; them: MatchupContextSide } | null {
  for (const item of items) {
    if (item.home.team_id === teamId) return { item, me: item.home, them: item.away };
    if (item.away.team_id === teamId) return { item, me: item.away, them: item.home };
  }
  return null;
}
