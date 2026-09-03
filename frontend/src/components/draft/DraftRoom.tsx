"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDraftPool,
  getDraftState,
  getDraftWebSocketUrl,
  getDraftWsTicket,
  submitDraftPick,
  type DraftPoolPlayer,
  type DraftState,
} from "@/lib/draftApi";
import { listSeasons, listTeams, type Team } from "@/lib/api";
import { DraftSetupPanel } from "@/components/draft/DraftSetupPanel";
import { DraftBoard } from "@/components/draft/DraftBoard";
import { PositionBadge } from "@/components/draft/PositionBadge";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { useDraftQueue } from "@/lib/useDraftQueue";
import { positionColor } from "@/lib/positionColors";

const RECONNECT_DELAY_MS = 2000;
const CLOCK_TICK_MS = 1000;
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

function useCountdown(deadline: string | null): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const tick = () => {
      setSeconds(deadline ? Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000)) : 0);
    };
    tick();
    if (!deadline) return;
    const id = setInterval(tick, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [deadline]);
  return seconds;
}

export function DraftRoom({
  myOwnerId,
  isCommissioner,
  initialDraftState,
  initialPool,
  initialTeams,
}: {
  myOwnerId: number;
  isCommissioner: boolean;
  initialDraftState: DraftState | null;
  initialPool: DraftPoolPlayer[];
  initialTeams: Team[];
}) {
  const [draftState, setDraftState] = useState<DraftState | null>(initialDraftState);
  const [pool, setPool] = useState<DraftPoolPlayer[]>(initialPool);
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [connected, setConnected] = useState(false);
  const [positionFilter, setPositionFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { openPlayerCard } = usePlayerCard();
  const socketRef = useRef<WebSocket | null>(null);
  const queue = useDraftQueue(draftState?.config.season);
  // Accumulates every player seen across pool fetches, keyed by id — a
  // queued player's name/position/team must stay resolvable even after
  // switching the position filter or search away from whatever pool
  // view they were queued from (the current `pool` array only ever
  // holds the *currently filtered* set). Real state, not a ref — the
  // "My Queue" panel's render needs to read this, and a ref can't be
  // read during render.
  const [knownPlayers, setKnownPlayers] = useState<Map<string, DraftPoolPlayer>>(new Map());
  useEffect(() => {
    // setTimeout(0), not a direct setState call in the effect body —
    // same lint-satisfying pattern as useDraftQueue.ts's own load
    // effect (see its comment).
    const id = setTimeout(() => {
      setKnownPlayers((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const p of pool) {
          if (next.get(p.sleeper_player_id) !== p) {
            next.set(p.sleeper_player_id, p);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 0);
    return () => clearTimeout(id);
  }, [pool]);

  const refreshState = async () => {
    try {
      const state = await getDraftState();
      setDraftState(state);
      setLoadError(null);
    } catch (e) {
      // Clears any stale draftState too — a reset (see
      // DraftSetupPanel's "Reset draft") makes GET /draft/state 404
      // again, and the old config/picks must not keep showing as if
      // still real.
      setDraftState(null);
      setLoadError(e instanceof Error ? e.message : "Failed to load draft");
    }
  };

  const refreshPool = async () => {
    try {
      setPool(await getDraftPool(positionFilter ?? undefined, search || undefined));
    } catch {
      // Non-fatal — the pool is a convenience list, draft state is the source of truth.
    }
  };

  useEffect(() => {
    // draft/page.tsx server-fetches draftState/pool/teams and passes
    // them as initial* props, so the common case never needs this at
    // all — this is only a fallback for the rare case the server-side
    // fetch itself came back empty (e.g. a session that expired between
    // page render and this component mounting). Inlined (not a bare
    // call to the refreshState/refreshPool helpers above) so this fetch
    // is a direct .then()/.catch() chain, same convention as
    // MyTeamApp.tsx's own fallback mount-fetch — calling a
    // component-scope async helper directly in an effect body trips
    // react-hooks/set-state-in-effect even though the actual setState
    // only ever happens after an await. refreshState/refreshPool stay
    // useful as-is for the non-effect call sites below (button
    // handlers, the WS onmessage callback).
    if (!initialDraftState) {
      getDraftState().then(setDraftState).catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load draft"));
    }
    if (initialTeams.length === 0) {
      // The active season for the draft picker isn't known until
      // draftState loads (chicken-and-egg for the "no draft yet" setup
      // case) — listSeasons() returns every season with a synced
      // teams_by_season row, so the highest one is the current one.
      listSeasons()
        .then(({ seasons }) => listTeams(Math.max(...seasons)))
        .then((r) => setTeams(r.teams))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The very first run of the effect below would otherwise immediately
  // re-fetch the pool with positionFilter=null/search="" — the exact
  // same request draft/page.tsx already made server-side for
  // initialPool — clobbering the fast first paint with a redundant
  // round trip. Same skip-the-mount-run guard as PlayerSearchInput.tsx.
  const skipInitialPoolFetch = useRef(true);

  useEffect(() => {
    if (skipInitialPoolFetch.current) {
      skipInitialPoolFetch.current = false;
      return;
    }
    getDraftPool(positionFilter ?? undefined, search || undefined).then(setPool).catch(() => {});
  }, [positionFilter, search]);

  // A queued player who gets drafted (by anyone — including an
  // autopick, which no client-side action of ours triggers) needs to
  // fall out of the queue on its own. Sourced from draftState.picks
  // (every pick made this draft) rather than `pool`, which only ever
  // holds the currently filtered view — a queued player who's since
  // been drafted must be detected even while a different position/
  // search filter is active.
  useEffect(() => {
    if (!draftState) return;
    const draftedIds = new Set(
      draftState.picks.filter((p) => p.sleeper_player_id).map((p) => p.sleeper_player_id!)
    );
    for (const id of queue.queue) {
      if (draftedIds.has(id)) queue.remove(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftState]);

  const season = draftState?.config.season;

  useEffect(() => {
    if (!season) return;
    let cancelled = false;
    let socket: WebSocket;

    async function connect() {
      if (cancelled) return;
      const ticket = await getDraftWsTicket();
      if (cancelled || !ticket) return;
      socket = new WebSocket(getDraftWebSocketUrl(ticket, season!));
      socketRef.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = (event) => {
        setConnected(false);
        if (!cancelled && event.code !== 4401 && event.code !== 4404) {
          setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
      socket.onmessage = () => {
        // Every event type (pick_made/draft_status/pick_undone) just
        // means "something changed" — a draft pick happens roughly
        // once every 90 seconds for a handful of connected clients, so
        // a full REST refetch on each event is simpler and safer than
        // merging partial WS payloads client-side, at negligible cost.
        refreshState();
        refreshPool();
      };
    }

    connect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  const config = draftState?.config;
  const secondsRemaining = useCountdown(config?.current_pick_deadline ?? null);
  const currentPick = draftState?.picks.find((p) => p.pick_number === config?.current_pick_number);
  const isMyTurn = currentPick?.owner_id === myOwnerId && config?.status === "in_progress";

  const teamNameByOwner = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of teams) m.set(t.owner_id, t.team_name);
    return m;
  }, [teams]);

  const myPicks = useMemo(
    () => draftState?.picks.filter((p) => p.owner_id === myOwnerId && p.sleeper_player_id) ?? [],
    [draftState, myOwnerId]
  );
  const recentPicks = useMemo(
    () => [...(draftState?.picks.filter((p) => p.made_at) ?? [])].reverse().slice(0, 15),
    [draftState]
  );

  // Queued-and-still-available players float to the top of whatever
  // the current position/search filter already narrowed `pool` down
  // to — queueing doesn't override a filter, it just re-priorities
  // within it, same as Sleeper's own queue behaves.
  const sortedPool = useMemo(
    () =>
      [...pool].sort((a, b) => {
        const aQ = queue.isQueued(a.sleeper_player_id);
        const bQ = queue.isQueued(b.sleeper_player_id);
        if (aQ !== bQ) return aQ ? -1 : 1;
        return 0; // stable sort — pool already arrives sorted by search_rank
      }),
    [pool, queue]
  );

  const queuedPlayers = useMemo(
    () => queue.queue.map((id) => knownPlayers.get(id)).filter((p): p is DraftPoolPlayer => Boolean(p)),
    [queue.queue, knownPlayers]
  );

  async function pick(sleeperPlayerId: string) {
    setSubmitting(true);
    setError(null);
    try {
      await submitDraftPick(sleeperPlayerId);
      await refreshState();
      await refreshPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pick failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError && !draftState) {
    return isCommissioner ? (
      <DraftSetupPanel teams={teams} onDraftCreated={refreshState} />
    ) : (
      <p className="text-sm text-black/50 dark:text-white/50">No draft has been set up yet.</p>
    );
  }
  if (!draftState) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading draft…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="neon-panel flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
        <div>
          <p className="text-xs text-black/50 dark:text-white/50">
            {config!.status === "complete"
              ? "Draft complete"
              : config!.status === "paused"
                ? "Paused"
                : config!.status === "not_started"
                  ? "Not started"
                  : `Round ${currentPick?.round ?? "—"} · Pick ${config!.current_pick_number}`}
          </p>
          {config!.status === "in_progress" && currentPick && (
            <p className="text-lg font-semibold">
              On the clock: {teamNameByOwner.get(currentPick.owner_id) ?? currentPick.owner_name}
              {isMyTurn && <span className="ml-2 text-sky-500">(you)</span>}
            </p>
          )}
        </div>
        {config!.status === "in_progress" && config!.current_pick_deadline && (
          <div className={`text-3xl font-bold tabular-nums ${secondsRemaining <= 10 ? "text-red-500" : ""}`}>
            {secondsRemaining}s
          </div>
        )}
        <span className="text-xs text-black/50 dark:text-white/50">{connected ? "● live" : "○ reconnecting…"}</span>
      </div>

      {isCommissioner && <DraftSetupPanel teams={teams} config={config!} onDraftCreated={refreshState} />}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {config!.status !== "not_started" && (
        <DraftBoard
          config={config!}
          picks={draftState.picks}
          teamNameByOwner={teamNameByOwner}
          currentPickNumber={config!.current_pick_number}
        />
      )}

      {config!.status !== "not_started" && (
        <div className="flex flex-col gap-4 sm:grid sm:grid-cols-3">
          <section className="neon-panel flex flex-col gap-2 rounded-xl p-4 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players…"
                aria-label="Search players"
                className="min-w-40 flex-1 rounded-full border border-black/10 bg-transparent px-3 py-1 text-sm dark:border-white/10"
              />
              {POSITIONS.map((pos) => {
                const color = positionColor(pos);
                const active = positionFilter === pos;
                return (
                  <button
                    key={pos}
                    onClick={() => setPositionFilter(active ? null : pos)}
                    className="rounded-full border px-2 py-1 text-xs font-medium"
                    style={
                      active
                        ? { borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }
                        : { borderColor: "var(--wl-border)", color: "var(--wl-text-secondary)" }
                    }
                  >
                    {pos}
                  </button>
                );
              })}
            </div>
            <ul className="max-h-[28rem] overflow-y-auto">
              {sortedPool.map((p) => {
                const queued = queue.isQueued(p.sleeper_player_id);
                return (
                  <li
                    key={p.sleeper_player_id}
                    className={`flex items-center justify-between gap-2 border-b border-black/5 py-2 last:border-0 dark:border-white/5 ${
                      queued ? "bg-[color-mix(in_srgb,var(--wl-accent)_6%,transparent)]" : ""
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        onClick={() => queue.toggle(p.sleeper_player_id)}
                        disabled={p.drafted}
                        aria-label={queued ? "Remove from queue" : "Add to queue"}
                        className="shrink-0 text-base text-black/25 hover:text-amber-400 disabled:opacity-30 dark:text-white/25"
                      >
                        {queued ? "★" : "☆"}
                      </button>
                      <span
                        title="ADP (Sleeper overall rank)"
                        className="w-7 shrink-0 text-right text-[10px] text-black/30 tabular-nums dark:text-white/30"
                      >
                        {p.search_rank ?? "—"}
                      </span>
                      <PositionBadge position={p.position} />
                      <div className="flex min-w-0 flex-col">
                        <button
                          onClick={() => openPlayerCard(p.sleeper_player_id)}
                          className={`truncate text-left text-sm font-medium hover:underline ${p.drafted ? "line-through opacity-40" : ""}`}
                        >
                          {p.full_name}
                        </button>
                        <span className="truncate text-xs text-black/50 dark:text-white/50">
                          {p.pro_team ?? "—"} · Proj {p.projected_points !== null ? p.projected_points.toFixed(1) : "—"} · Bye{" "}
                          {p.bye_week ?? "—"}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => pick(p.sleeper_player_id)}
                      disabled={p.drafted || !isMyTurn || submitting}
                      className="shrink-0 rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-30"
                    >
                      Draft
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="flex flex-col gap-4">
            {queuedPlayers.length > 0 && (
              <section className="neon-panel flex flex-col gap-1 rounded-xl p-4">
                <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                  My Queue ({queuedPlayers.length})
                </h2>
                {queuedPlayers.map((p, i) => (
                  <div key={p.sleeper_player_id} className="flex items-center justify-between gap-1 py-0.5 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="w-4 shrink-0 text-black/30 tabular-nums dark:text-white/30">{i + 1}</span>
                      <button onClick={() => openPlayerCard(p.sleeper_player_id)} className="truncate hover:underline">
                        {p.full_name}
                      </button>
                      <PositionBadge position={p.position} />
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      {isMyTurn && (
                        <button
                          onClick={() => pick(p.sleeper_player_id)}
                          disabled={submitting}
                          className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-30"
                        >
                          Draft
                        </button>
                      )}
                      <button
                        onClick={() => queue.move(p.sleeper_player_id, -1)}
                        disabled={i === 0}
                        aria-label="Move up"
                        className="px-1 text-black/50 disabled:opacity-20 dark:text-white/50"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => queue.move(p.sleeper_player_id, 1)}
                        disabled={i === queuedPlayers.length - 1}
                        aria-label="Move down"
                        className="px-1 text-black/50 disabled:opacity-20 dark:text-white/50"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => queue.remove(p.sleeper_player_id)}
                        aria-label="Remove from queue"
                        className="px-1 text-black/50 dark:text-white/50"
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ))}
              </section>
            )}

            <section className="neon-panel flex flex-col gap-1 rounded-xl p-4">
              <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                My team ({myPicks.length})
              </h2>
              {myPicks.map((p) => (
                <p key={p.pick_number} className="flex items-center gap-1.5 text-sm">
                  <PositionBadge position={p.player_position} />
                  <button onClick={() => openPlayerCard(p.sleeper_player_id!)} className="hover:underline">
                    {p.player_name}
                  </button>
                </p>
              ))}
            </section>

            <section className="neon-panel flex flex-col gap-1 rounded-xl p-4">
              <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                Recent picks
              </h2>
              {recentPicks.map((p) => (
                <p key={p.pick_number} className="text-sm">
                  <span className="text-black/50 dark:text-white/50">#{p.pick_number}</span>{" "}
                  {teamNameByOwner.get(p.owner_id) ?? p.owner_name}:{" "}
                  {p.sleeper_player_id ? (
                    <button onClick={() => openPlayerCard(p.sleeper_player_id!)} className="hover:underline">
                      {p.player_name}
                    </button>
                  ) : (
                    p.player_name
                  )}
                  {p.is_autopick && <span className="ml-1 text-[10px] text-amber-500">AUTO</span>}
                  {p.is_keeper && <span className="ml-1 text-[10px] text-emerald-500">KEEPER</span>}
                </p>
              ))}
            </section>
          </div>
        </div>
      )}

    </div>
  );
}
