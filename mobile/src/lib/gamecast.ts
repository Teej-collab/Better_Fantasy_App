import type { GamecastDrive, GamecastPlay, LiveGame } from '@/lib/types';

// Pure helpers behind the Gamecast screen (app/gamecast/[id].tsx).

export function isLive(game: LiveGame): boolean {
  return game.status === 'in_progress' || game.status === 'halftime';
}

export function ordinal(n: number): string {
  return ['1st', '2nd', '3rd', '4th'][n - 1] ?? (n === 5 ? 'OT' : `${n}th`);
}

export function quarterLabel(period: number): string {
  return period >= 5 ? (period === 5 ? 'OT' : `${period - 4}OT`) : `Q${period}`;
}

// Bookkeeping entries ESPN puts in the play list that aren't a snap
// (timeouts, "End Period", "END GAME") — the Last Play card always shows
// the last real play, same rule as the web's LastPlay.tsx.
const NON_SNAP_TYPES = new Set(['timeout', 'other']);

export function isSnap(play: GamecastPlay): boolean {
  return play.is_scoring_play || !NON_SNAP_TYPES.has(play.play_type);
}

export function lastSnap(game: LiveGame): GamecastPlay | null {
  return game.plays.find(isSnap) ?? null;
}

const BIG_PLAY_YARDS = 20;

// What the "Big plays" filter keeps: points, turnovers, and chunk gains.
export function isBigPlay(play: GamecastPlay): boolean {
  return (
    play.is_scoring_play ||
    play.is_turnover ||
    (play.play_type !== 'penalty' && play.play_type !== 'kickoff' && play.play_type !== 'punt' && (play.yards_gained ?? 0) >= BIG_PLAY_YARDS)
  );
}

// Where a drive started, in yards to the end zone (100 = own goal line).
// drive.start_yard_line isn't measured the same way for home and away
// teams, so read it off the drive's first snap instead.
export function driveStartYardsToGoal(drive: GamecastDrive): number | null {
  const first = drive.plays.find((p) => p.play_type !== 'kickoff' && p.yard_line !== null && p.yard_line > 0);
  return first?.yard_line ?? null;
}

// The drive's end, in yards to the end zone: a touchdown is 0, otherwise
// its start less the yards ESPN credits it (individual plays' spots are
// unreliable here — a punt's is measured from the other end).
export function driveEndYardsToGoal(drive: GamecastDrive): number | null {
  if (drive.result === 'TD') return 0;
  const start = driveStartYardsToGoal(drive);
  if (start === null) return null;
  return Math.min(100, Math.max(0, start - drive.yards));
}

export const DRIVE_RESULT_LABELS: Record<string, string> = {
  TD: 'Touchdown',
  FG: 'Field goal',
  'MISSED FG': 'Missed FG',
  PUNT: 'Punt',
  TURNOVER: 'Turnover',
  FUMBLE: 'Fumble',
  INT: 'Interception',
  DOWNS: 'Downs',
  SAFETY: 'Safety',
  'END OF HALF': 'End of half',
  'END OF GAME': 'End of game',
};

// No result on a drive that isn't the current one: ESPN didn't record
// how it ended.
export function driveResultLabel(result: string | null, current = false): string {
  if (!result) return current ? 'In progress' : '—';
  const text = result.replace(/_/g, ' ');
  return DRIVE_RESULT_LABELS[text.toUpperCase()] ?? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

export type BigMoment = { key: string; title: string; team: string | null; detail: string };

// The play worth stopping the screen for: a score or a turnover. Used to
// fire the banner + haptic when one arrives live.
export function bigMomentFor(play: GamecastPlay): BigMoment | null {
  const team = play.team_abbr;
  if (play.is_scoring_play) {
    const title =
      play.event_type === 'TOUCHDOWN' || /touchdown/i.test(play.description)
        ? 'Touchdown'
        : play.event_type === 'FIELD_GOAL' || play.play_type === 'field_goal'
          ? 'Field goal'
          : /safety/i.test(play.description)
            ? 'Safety'
            : 'Score';
    return { key: play.play_id, title, team, detail: play.description };
  }
  if (play.is_turnover) {
    const title = /intercept/i.test(play.description) ? 'Interception' : /fumble/i.test(play.description) ? 'Fumble' : 'Turnover';
    return { key: play.play_id, title, team, detail: play.description };
  }
  return null;
}
