import { useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { isSnap } from '@/lib/gamecast';
import type { GamecastPlay, LiveGame } from '@/lib/types';

// The Lounge's TV game plays on a delay. A shared broadcast runs 30-90s
// behind the live data, so everything the room shows about that game —
// scorebug, field, plays, fantasy moments, the touchdown takeover — is
// held back until the TV catches up. The room's delay comes from its
// "Sync to TV" button (saved on the room, the same for everyone).
//
// The backend keeps a few minutes of each game's history on its own
// clock (GET /nfl/games/{id}/timeline); this shows the newest snapshot
// at least `delay` seconds old, so someone walking in mid-game starts
// already delayed instead of on a spoiler.

const POLL_MS = 4000;
const TICK_MS = 1000;
const KEEP_SECONDS = 300;

type Snapshot = { at: number; game: LiveGame };

export type DelayedGame = {
  // The game as the TV shows it right now; null until loaded.
  game: LiveGame | null;
  // Recent snaps with the server time each first appeared — what Sync
  // to TV lets the sharer pick from ("which play just happened?").
  recentPlays: { play: GamecastPlay; firstSeenAt: number }[];
  // The current time on the server's clock.
  serverNow: () => number;
  // True while the room's history doesn't yet reach back `delay`
  // seconds, so the game shown is a little ahead of the TV.
  catchingUp: boolean;
};

export function useDelayedGame(
  gameId: string | null,
  delaySeconds: number,
  onPlay?: (play: GamecastPlay, game: LiveGame) => void,
): DelayedGame {
  const snapshots = useRef<Snapshot[]>([]);
  const firstSeen = useRef<Map<string, number>>(new Map());
  const offset = useRef(0); // server time minus local time, seconds
  const shownPlays = useRef<Set<string> | null>(null);
  const onPlayRef = useRef(onPlay);
  const delayRef = useRef(delaySeconds);
  useEffect(() => {
    onPlayRef.current = onPlay;
    delayRef.current = delaySeconds;
  });
  const [state, setState] = useState<{
    gameId: string | null;
    game: LiveGame | null;
    catchingUp: boolean;
    recentPlays: DelayedGame['recentPlays'];
  }>({ gameId: null, game: null, catchingUp: false, recentPlays: [] });

  useEffect(() => {
    snapshots.current = [];
    firstSeen.current = new Map();
    shownPlays.current = null;
    if (!gameId) return;
    let cancelled = false;
    let lastAt: number | undefined;
    const now = () => Date.now() / 1000 + offset.current;

    async function poll() {
      try {
        const r = await api.gamecastTimeline(gameId!, lastAt);
        if (cancelled) return;
        offset.current = r.server_now - Date.now() / 1000;
        for (const snap of r.snapshots) {
          snapshots.current.push(snap);
          lastAt = snap.at;
          for (const p of snap.game.plays) {
            if (!firstSeen.current.has(p.play_id)) firstSeen.current.set(p.play_id, snap.at);
          }
        }
        const cutoff = r.server_now - KEEP_SECONDS;
        while (snapshots.current.length > 1 && snapshots.current[1].at < cutoff) snapshots.current.shift();
        tick();
      } catch {
        // Keep showing what we have; the next poll tries again.
      }
    }

    // Pick the snapshot the TV is at, and announce plays as they reach it.
    function tick() {
      const snaps = snapshots.current;
      if (cancelled || snaps.length === 0) return;
      const target = now() - delayRef.current;
      let shown = snaps[0];
      for (const snap of snaps) {
        if (snap.at <= target) shown = snap;
        else break;
      }
      const catchingUp = snaps[0].at > target;
      const ids = new Set(shown.game.plays.map((p) => p.play_id));
      if (shownPlays.current) {
        // Oldest first, so a burst plays out in order.
        const fresh = shown.game.plays.filter((p) => !shownPlays.current!.has(p.play_id) && isSnap(p)).reverse();
        for (const p of fresh) onPlayRef.current?.(p, shown.game);
      }
      shownPlays.current = ids;
      // Sync to TV lists the newest plays, not the delayed ones: if the
      // delay is too long, the play that just finished on the sharer's
      // TV has to be in the list too.
      const recentPlays = snaps[snaps.length - 1].game.plays
        .filter(isSnap)
        .slice(0, 6)
        .map((play) => ({ play, firstSeenAt: firstSeen.current.get(play.play_id) ?? now() }));
      setState((s) =>
        s.gameId === gameId && s.game === shown.game && s.catchingUp === catchingUp && s.recentPlays[0]?.play.play_id === recentPlays[0]?.play.play_id
          ? s
          : { gameId, game: shown.game, catchingUp, recentPlays },
      );
    }

    void poll();
    const pollId = setInterval(poll, POLL_MS);
    const tickId = setInterval(tick, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, [gameId]);

  const current = state.gameId === gameId && gameId !== null;
  return {
    game: current ? state.game : null,
    recentPlays: current ? state.recentPlays : [],
    serverNow: () => Date.now() / 1000 + offset.current,
    catchingUp: current && state.catchingUp,
  };
}

/** The delay that lines the room up with the TV, given the play the
 *  sharer says just happened on it: how long ago that play first showed
 *  up in the live data. */
export function delayForPlay(firstSeenAt: number, serverNow: number): number {
  return Math.max(0, Math.min(180, Math.round(serverNow - firstSeenAt)));
}

/**
 * Any live value (your matchup, the league ticker), held back by
 * `delaySeconds` so fantasy points from the TV's game don't land before
 * the play does. The first value shows right away.
 */
export function useDelayedValue<T>(value: T | undefined, delaySeconds: number): T | undefined {
  const history = useRef<{ t: number; value: T }[]>([]);
  const delayRef = useRef(delaySeconds);
  const [shown, setShown] = useState<{ has: boolean; value: T | undefined }>({ has: false, value: undefined });

  useEffect(() => {
    delayRef.current = delaySeconds;
  }, [delaySeconds]);

  useEffect(() => {
    if (value === undefined) return;
    const h = history.current;
    const now = Date.now() / 1000;
    if (h.length === 0 || h[h.length - 1].value !== value) h.push({ t: now, value });
    while (h.length > 1 && h[1].t < now - KEEP_SECONDS) h.shift();
  }, [value]);

  useEffect(() => {
    const id = setInterval(() => {
      const h = history.current;
      if (h.length === 0) return;
      const target = Date.now() / 1000 - delayRef.current;
      let pick = h[0];
      for (const entry of h) {
        if (entry.t <= target) pick = entry;
        else break;
      }
      setShown((s) => (s.has && s.value === pick.value ? s : { has: true, value: pick.value }));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Until the first tick, the first value shows as is.
  return shown.has ? shown.value : value;
}

export function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}

/** "Q4 · 2:11", "Halftime", "Final". */
export function clockLabel(game: LiveGame): string {
  if (game.status === 'final') return 'Final';
  if (game.status === 'halftime') return 'Halftime';
  if (game.status === 'scheduled') return 'Pregame';
  const q = game.period && game.period > 4 ? 'OT' : `Q${game.period ?? 1}`;
  return `${q} · ${game.clock ?? ''}`.trim();
}

/** "2nd & 6 · LV 34". */
export function downLabel(game: LiveGame): string | null {
  if (game.status !== 'in_progress' || !game.down) return null;
  const goal = game.distance !== null && game.yards_to_goal !== null && game.distance >= game.yards_to_goal;
  const dd = `${ordinal(game.down)} & ${goal ? 'Goal' : (game.distance ?? '?')}`;
  return game.field_position_label ? `${dd} · ${game.field_position_label}` : dd;
}
