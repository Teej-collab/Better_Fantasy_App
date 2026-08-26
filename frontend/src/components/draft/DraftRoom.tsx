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

export function DraftRoom({ myOwnerId, isCommissioner }: { myOwnerId: number; isCommissioner: boolean }) {
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [pool, setPool] = useState<DraftPoolPlayer[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [connected, setConnected] = useState(false);
  const [positionFilter, setPositionFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const refreshState = async () => {
    try {
      const state = await getDraftState();
      setDraftState(state);
    } catch (e) {
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
    // Inlined (not a bare call to the refreshState/refreshPool helpers
    // above) so the initial fetch is a direct .then()/.catch() chain,
    // same convention as MyTeamApp.tsx's mount-fetch — calling a
    // component-scope async helper directly in an effect body trips
    // react-hooks/set-state-in-effect even though the actual setState
    // only ever happens after an await. refreshState/refreshPool stay
    // useful as-is for the non-effect call sites below (button
    // handlers, the WS onmessage callback).
    getDraftState().then(setDraftState).catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load draft"));
    // The active season for the draft picker isn't known until
    // draftState loads (chicken-and-egg for the "no draft yet" setup
    // case) — listSeasons() returns every season with a synced
    // teams_by_season row, so the highest one is the current one.
    listSeasons()
      .then(({ seasons }) => listTeams(Math.max(...seasons)))
      .then((r) => setTeams(r.teams))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getDraftPool(positionFilter ?? undefined, search || undefined).then(setPool).catch(() => {});
  }, [positionFilter, search]);

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
        <span className="text-xs text-black/40 dark:text-white/40">{connected ? "● live" : "○ reconnecting…"}</span>
      </div>

      {isCommissioner && <DraftSetupPanel teams={teams} config={config!} onDraftCreated={refreshState} />}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {config!.status !== "not_started" && (
        <div className="flex flex-col gap-4 sm:grid sm:grid-cols-3">
          <section className="neon-panel flex flex-col gap-2 rounded-xl p-4 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players…"
                className="min-w-40 flex-1 rounded-full border border-black/10 bg-transparent px-3 py-1 text-sm dark:border-white/10"
              />
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPositionFilter(positionFilter === pos ? null : pos)}
                  className={`rounded-full border px-2 py-1 text-xs font-medium ${
                    positionFilter === pos
                      ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                      : "border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
            <ul className="max-h-[28rem] overflow-y-auto">
              {pool.map((p) => (
                <li
                  key={p.sleeper_player_id}
                  className="flex items-center justify-between gap-2 border-b border-black/5 py-2 last:border-0 dark:border-white/5"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className={`truncate text-sm font-medium ${p.drafted ? "line-through opacity-40" : ""}`}>
                      {p.full_name}
                    </span>
                    <span className="text-xs text-black/40 dark:text-white/40">
                      {p.position} · {p.pro_team ?? "—"}
                    </span>
                  </div>
                  <button
                    onClick={() => pick(p.sleeper_player_id)}
                    disabled={p.drafted || !isMyTurn || submitting}
                    className="shrink-0 rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-30"
                  >
                    Draft
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex flex-col gap-4">
            <section className="neon-panel flex flex-col gap-1 rounded-xl p-4">
              <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                My team ({myPicks.length})
              </h2>
              {myPicks.map((p) => (
                <p key={p.pick_number} className="text-sm">
                  {p.player_position} · {p.player_name}
                </p>
              ))}
            </section>

            <section className="neon-panel flex flex-col gap-1 rounded-xl p-4">
              <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                Recent picks
              </h2>
              {recentPicks.map((p) => (
                <p key={p.pick_number} className="text-sm">
                  <span className="text-black/40 dark:text-white/40">#{p.pick_number}</span>{" "}
                  {teamNameByOwner.get(p.owner_id) ?? p.owner_name}: {p.player_name}
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
