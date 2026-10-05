"use client";

// The web Lounge's live data — the same model as the native app's
// mobile/src/lib/loungeLive.ts, keep the two in step.
//
// The TV's game plays on a delay. A shared broadcast runs 30-90s behind
// the live data, so everything the room shows about that game — the
// scorebug, field, plays, fantasy moments, the touchdown takeover — is
// held back until the TV catches up. The room's delay comes from "Sync
// to TV" (saved on the room, the same for everyone). The backend keeps
// a few minutes of each game's history on its own clock (GET
// /nfl/games/{id}/timeline), so someone walking in mid-game starts
// already delayed instead of on a spoiler.
import { useEffect, useRef, useState } from "react";
import type { LeagueTickerItem, NflGame, WeekMatchupContext, WeekMatchupContextItem, YourWeek } from "@/lib/api";
import type { Bet } from "@/lib/betsApi";
import type { GamecastPlay, LiveGame } from "@/lib/gamecastApi";

const POLL_MS = 4000;
const TICK_MS = 1000;
const KEEP_SECONDS = 300;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/backend${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export const loungeApi = {
  timeline: (gameId: string, since?: number) =>
    get<{ server_now: number; snapshots: { at: number; game: LiveGame }[] }>(
      `/nfl/games/${encodeURIComponent(gameId)}/timeline${since !== undefined ? `?since=${since}` : ""}`
    ),
  setTv: async (roomId: number, body: { game_id?: string | null; delay_seconds?: number }) => {
    const res = await fetch(`/api/backend/watch-party/rooms/${roomId}/tv`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Couldn't update the TV: ${res.status}`);
    return res.json() as Promise<{ tv_game_id: string | null; tv_delay_seconds: number }>;
  },
  myWeek: () => get<YourWeek>("/me/week"),
  matchup: (id: number) => get<WeekMatchupContextItem>(`/matchups/${id}`),
  matchupContext: (season: number, week: number) => get<WeekMatchupContext>(`/seasons/${season}/weeks/${week}/matchup-context`),
  leagueTicker: (season: number, week: number) => get<{ items: LeagueTickerItem[] }>(`/seasons/${season}/weeks/${week}/ticker`),
  scoreboard: () => get<{ games: NflGame[] }>("/nfl/scoreboard"),
  bets: () => get<{ enabled: boolean; bets: Bet[] }>("/bets"),
};

/** Polls `fetcher` every `ms` while `key` is set; the latest result. */
export function usePolled<T>(key: string | null, fetcher: () => Promise<T>, ms: number): T | undefined {
  const [state, setState] = useState<{ key: string | null; data: T | undefined }>({ key: null, data: undefined });
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = () =>
      fetcherRef
        .current()
        .then((data) => {
          if (!cancelled) setState({ key, data });
        })
        .catch(() => {});
    void load();
    const id = setInterval(load, ms);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key, ms]);
  return state.key === key ? state.data : undefined;
}

type Snapshot = { at: number; game: LiveGame };
const NON_SNAP = new Set(["timeout", "other"]);
const isSnap = (p: GamecastPlay) => p.is_scoring_play || !NON_SNAP.has(p.play_type);

export type DelayedGame = {
  game: LiveGame | null;
  recentPlays: { play: GamecastPlay; firstSeenAt: number }[];
  serverNow: () => number;
  catchingUp: boolean;
};

export function useDelayedGame(
  gameId: string | null,
  delaySeconds: number,
  onPlay?: (play: GamecastPlay, game: LiveGame) => void
): DelayedGame {
  const snapshots = useRef<Snapshot[]>([]);
  const firstSeen = useRef<Map<string, number>>(new Map());
  const offset = useRef(0);
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
    recentPlays: DelayedGame["recentPlays"];
  }>({ gameId: null, game: null, catchingUp: false, recentPlays: [] });

  useEffect(() => {
    snapshots.current = [];
    firstSeen.current = new Map();
    shownPlays.current = null;
    if (!gameId) return;
    let cancelled = false;
    let lastAt: number | undefined;
    const now = () => Date.now() / 1000 + offset.current;

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
      if (shownPlays.current) {
        const fresh = shown.game.plays.filter((p) => !shownPlays.current!.has(p.play_id) && isSnap(p)).reverse();
        for (const p of fresh) onPlayRef.current?.(p, shown.game);
      }
      shownPlays.current = new Set(shown.game.plays.map((p) => p.play_id));
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
          : { gameId, game: shown.game, catchingUp, recentPlays }
      );
    }

    async function poll() {
      try {
        const r = await loungeApi.timeline(gameId!, lastAt);
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
        // Keep what we have; the next poll tries again.
      }
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

/** The delay that lines the room up with the TV, from the play the
 *  sharer says just happened on it. */
export function delayForPlay(firstSeenAt: number, serverNow: number): number {
  return Math.max(0, Math.min(180, Math.round(serverNow - firstSeenAt)));
}

/** Any live value, held back by `delaySeconds`; the first shows at once. */
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
  return shown.has ? shown.value : value;
}

export function ordinal(n: number): string {
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}

export function clockLabel(game: LiveGame): string {
  if (game.status === "final") return "Final";
  if (game.status === "halftime") return "Halftime";
  if (game.status === "scheduled") return "Pregame";
  const q = game.period && game.period > 4 ? "OT" : `Q${game.period ?? 1}`;
  return `${q} · ${game.clock ?? ""}`.trim();
}

export function downLabel(game: LiveGame): string | null {
  if (game.status !== "in_progress" || !game.down) return null;
  const goal = game.distance !== null && game.yards_to_goal !== null && game.distance >= game.yards_to_goal;
  const dd = `${ordinal(game.down)} & ${goal ? "Goal" : (game.distance ?? "?")}`;
  return game.field_position_label ? `${dd} · ${game.field_position_label}` : dd;
}

export function isTouchdown(play: GamecastPlay): boolean {
  return play.is_scoring_play && (/touchdown/i.test(play.description) || play.event_type === "TOUCHDOWN");
}

export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

export type RoomTv = { gameId: string | null; delaySeconds: number };

/**
 * A Watch Party room's socket: the room's TV (which game, how far
 * behind) — sent on connect and whenever the sharer changes it — and,
 * by being connected, showing you in the room for everyone else.
 */
export function useRoomTv(roomId: number, initial: RoomTv): RoomTv {
  const [tv, setTv] = useState<RoomTv>(initial);
  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function connect() {
      const { getWatchPartyWsTicket, getWatchPartyWebSocketUrl } = await import("@/lib/api");
      const ticket = await getWatchPartyWsTicket().catch(() => null);
      if (cancelled) return;
      if (!ticket) {
        retry = setTimeout(connect, 3000);
        return;
      }
      socket = new WebSocket(getWatchPartyWebSocketUrl(ticket, roomId));
      socket.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "tv") setTv({ gameId: data.tv_game_id ?? null, delaySeconds: data.tv_delay_seconds ?? 45 });
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = (e) => {
        if (!cancelled && ![4401, 4404, 4409].includes(e.code)) retry = setTimeout(connect, 3000);
      };
    }
    void connect();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [roomId]);
  return tv;
}
