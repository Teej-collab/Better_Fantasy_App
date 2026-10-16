import * as SecureStore from 'expo-secure-store';
import { useState } from 'react';

import type { MatchupContextSide, NflGame, RosterEntry, YourWeek } from '@/lib/types';

// The living home screen (2026-10-13) is the app's Home for everyone
// since 2026-10-16 (it started with two testers). Anyone can flip back
// to the classic home from the bottom of it, and back again from the
// classic one; remembered on this phone.
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

// Eastern time — the league's clock — worked out by hand rather than
// with Intl time zones, which gave wrong hours on the phone (the recap
// countdown read 7d 23h on 2026-10-13). US rules: EDT from the second
// Sunday in March, 2 AM, to the first Sunday in November, 2 AM.
function nthSundayUtc(year: number, month: number, n: number): number {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - firstDay) % 7) + 7 * (n - 1);
}

function etOffsetHours(when: Date): number {
  const year = when.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, nthSundayUtc(year, 2, 2), 7); // 2 AM EST
  const dstEnd = Date.UTC(year, 10, nthSundayUtc(year, 10, 1), 6); // 2 AM EDT
  const t = when.getTime();
  return t >= dstStart && t < dstEnd ? -4 : -5;
}

// A Date whose UTC fields read as Eastern wall-clock time.
function etWall(when: Date): Date {
  return new Date(when.getTime() + etOffsetHours(when) * 60 * 60 * 1000);
}

// The weekday (0 = Sunday) and hour in Eastern time.
export function etDayHour(when: Date): { day: number; hour: number } {
  const wall = etWall(when);
  return { day: wall.getUTCDay(), hour: wall.getUTCHours() };
}

function sameEtDay(a: Date, b: Date): boolean {
  return etWall(a).toISOString().slice(0, 10) === etWall(b).toISOString().slice(0, 10);
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

// The week's recap drops Tuesday at noon PT (3 PM Eastern). Home shows
// it in full from then until the end of Tuesday; from Wednesday it
// shrinks to a "Missed the recap?" link until the next one drops. Same
// rule as the web's frontend/src/lib/recapFreshness.ts.
export function recapIsFresh(now = new Date()): boolean {
  const { day, hour } = etDayHour(now);
  return day === 2 && hour >= 15;
}

// The betting weekend: Thursday 6 AM Eastern until Tuesday 6 AM, so the
// Monday night game (which can run past midnight) still counts.
export function inBetsWeekend(now = new Date()): boolean {
  const { day, hour } = etDayHour(now);
  if (day === 4) return hour >= 6;
  if (day === 2) return hour < 6;
  return day === 5 || day === 6 || day === 0 || day === 1;
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
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][etDayHour(now).day];
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
