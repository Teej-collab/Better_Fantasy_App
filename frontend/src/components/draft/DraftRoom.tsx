"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getDraftPool,
  getDraftState,
  getDraftWebSocketUrl,
  getDraftWsTicket,
  submitDraftPick,
  type DraftChatMessage,
  type DraftPoolPlayer,
  type DraftState,
} from "@/lib/draftApi";
import { listSeasons, listTeams, type DraftGrade, type Team } from "@/lib/api";
import { DraftSetupPanel } from "@/components/draft/DraftSetupPanel";
import { DraftBoard } from "@/components/draft/DraftBoard";
import { DraftGradesLeaderboard } from "@/components/draft/DraftGradesLeaderboard";
import { PositionBadge } from "@/components/draft/PositionBadge";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { useDraftQueue } from "@/lib/useDraftQueue";
import { positionColor } from "@/lib/positionColors";

const RECONNECT_DELAY_MS = 2000;
const CLOCK_TICK_MS = 1000;
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
// Same unbounded-growth issue ChatApp.tsx's own MAX_LIVE_MESSAGES_PER_
// CONVERSATION fixed this session, just missed here at the time: a
// draft room left open for a full multi-hour draft accumulates every
// chat message from every manager with no ceiling, each one staying
// mounted for the rest of the session (2026-09 memory audit, following
// the same real iOS reload/crash report). Capped at the live-append
// site only — the initial load from getDraftState()'s own
// chat_messages is a real, already-bounded server response, not a
// growth site.
const MAX_LIVE_DRAFT_CHAT_MESSAGES = 200;
// The room opens for queue-building 1 hour before the real draft — see
// backend/app/scheduler.py's _run_draft_auto_start_job, which is the
// actual server-authoritative thing that flips status to in_progress
// at scheduled_start. This constant only decides what THIS client
// shows while waiting for that — real pick submission is gated
// entirely on config.status === "in_progress" (isMyTurn below), never
// on this window calculation, so a wrong/stale client clock can only
// ever affect what's DISPLAYED here, never what's actually allowed.
const PRE_DRAFT_WINDOW_MS = 60 * 60 * 1000;

function formatCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

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
  grades,
  narratives,
  beta = false,
}: {
  myOwnerId: number;
  isCommissioner: boolean;
  initialDraftState: DraftState | null;
  initialPool: DraftPoolPlayer[];
  initialTeams: Team[];
  // Only ever populated once the draft is complete and the scheduler's
  // grading job has run (app/scheduler.py's _run_draft_grades_job) —
  // undefined during a live draft. Fetched server-side by (app)/draft/
  // page.tsx rather than by this component, so a live draft's page load
  // never waits on an extra request that has nothing to show yet.
  grades?: DraftGrade[];
  narratives?: Record<string, string | null>;
  // Settings > Labs > "Try the new look" — visual-only (card tier
  // classNames), never threaded into any state/WebSocket/pick-submit
  // logic above. Documentation/UX/00_UX_Audit.md's Draft finding: the
  // live room could stack 5-6 simultaneously-glowing .neon-panel
  // blocks at once. The pick-clock bar becomes the one live-tier card
  // while a pick is actually running; everything else goes flat.
  beta?: boolean;
}) {
  const [openGradeOwnerId, setOpenGradeOwnerId] = useState<number | null>(null);
  const [draftState, setDraftState] = useState<DraftState | null>(initialDraftState);
  const [pool, setPool] = useState<DraftPoolPlayer[]>(initialPool);
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [connected, setConnected] = useState(false);
  // Who's actually got the draft room open right now (any device) —
  // separate from `connected` above, which is THIS client's own socket
  // state. Seeded from the initial state's snapshot, kept live by
  // "presence" WS events from there (see the message handler below).
  const [connectedOwnerIds, setConnectedOwnerIds] = useState<Set<number>>(
    () => new Set(initialDraftState?.connected_owner_ids ?? [])
  );
  const [chatMessages, setChatMessages] = useState<DraftChatMessage[]>(initialDraftState?.chat_messages ?? []);
  const [chatDraft, setChatDraft] = useState("");
  // Ephemeral "so-and-so joined/left the room" lines interleaved with
  // real chat — sourced from the same `presence` WS events that already
  // drive the online-dot indicator above, never persisted (see
  // draft_room_messages' own migration docstring: "who's online" is
  // deliberately not stored). Capped so a flaky connection reconnecting
  // over and over can't grow this list forever.
  const [presenceEvents, setPresenceEvents] = useState<{ ownerId: number; online: boolean; at: number }[]>([]);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
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
      setConnectedOwnerIds(new Set(state.connected_owner_ids ?? []));
      setChatMessages(state.chat_messages ?? []);
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

  // DraftSetupPanel's onDraftCreated covers reset/start/order changes
  // AND seeding keepers — a seeded keeper is a real draft_picks row
  // (see seed_keeper_pick's own docstring), so the pool has to refresh
  // too or that player keeps showing as available on the caller's own
  // screen until something else happens to trigger a refetch. Every
  // OTHER connected client gets this from the keeper_seeded/
  // keepers_seeded WS broadcast instead (see the onmessage handler
  // below) — this covers the one client that isn't relying on its own
  // broadcast to reach itself.
  const refreshStateAndPool = async () => {
    await refreshState();
    await refreshPool();
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
    // Debounced (2026-09 memory audit) — this used to re-fetch AND
    // fully re-render the entire pool (hundreds of undrafted players,
    // unfiltered — no pagination/virtualization on this list) on every
    // single keystroke, with no cancellation of the previous request.
    // Same 300ms debounce PlayerSearchInput.tsx already uses for the
    // same reason on Free Agents/Player Research.
    const id = setTimeout(() => {
      getDraftPool(positionFilter ?? undefined, search || undefined).then(setPool).catch(() => {});
    }, 300);
    return () => clearTimeout(id);
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
      socket.onmessage = (event) => {
        let msg: { type?: string; owner_id?: number; online?: boolean; message?: DraftChatMessage } | null = null;
        try {
          msg = JSON.parse(event.data);
        } catch {
          msg = null;
        }
        // Presence updates just toggle one owner_id in a local set —
        // handled directly instead of the full refetch below, since a
        // connection blip shouldn't trigger a round trip for state
        // that hasn't actually changed. Also drops an ephemeral
        // "joined/left the room" line into the chat log (never
        // persisted server-side — see draft_room_messages' own
        // migration docstring).
        if (msg?.type === "presence" && typeof msg.owner_id === "number") {
          const ownerId = msg.owner_id;
          const online = msg.online;
          setConnectedOwnerIds((prev) => {
            const next = new Set(prev);
            if (online) next.add(ownerId);
            else next.delete(ownerId);
            return next;
          });
          setPresenceEvents((prev) => [...prev, { ownerId, online: Boolean(online), at: Date.now() }].slice(-20));
          return;
        }
        // A real draft-room chat message — appended directly, no
        // refetch needed (the server already broadcasts the full
        // persisted row, same "trust the WS payload" shape as
        // pick_made elsewhere in this handler).
        if (msg?.type === "chat" && msg.message) {
          const message = msg.message;
          setChatMessages((prev) => {
            const next = [...prev, message];
            return next.length > MAX_LIVE_DRAFT_CHAT_MESSAGES
              ? next.slice(next.length - MAX_LIVE_DRAFT_CHAT_MESSAGES)
              : next;
          });
          return;
        }
        // Every other event type (pick_made/draft_status/pick_undone) just
        // means "something changed" — a draft pick happens roughly
        // once every 90 seconds for a handful of connected clients, so
        // a full REST refetch on each event is simpler and safer than
        // merging partial WS payloads client-side, at negligible cost.
        // The queue refetch is what makes "a player on my queue just
        // got drafted by someone else" disappear live (server already
        // removed it — app/domain/draft_engine.py's make_pick — this
        // just syncs this client's own view of that).
        refreshState();
        refreshPool();
        queue.refresh();
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

  // Pre-draft room: 1 hour of queue-building before the real draft
  // (see PRE_DRAFT_WINDOW_MS above). secondsUntilStart reuses the same
  // ticking-countdown hook the pick timer above already uses — only
  // relevant while status is still "not_started"; once the server
  // actually flips it to in_progress (auto-start job, or a
  // commissioner's manual click), the normal live-draft view below
  // takes over regardless of what this countdown still says.
  const secondsUntilStart = useCountdown(
    config?.status === "not_started" ? (config?.scheduled_start ?? null) : null
  );
  const preDraftWindowActive =
    config?.status === "not_started" && config?.scheduled_start != null && secondsUntilStart <= PRE_DRAFT_WINDOW_MS / 1000;

  const teamNameByOwner = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of teams) m.set(t.owner_id, t.team_name);
    return m;
  }, [teams]);

  const gradesByOwner = useMemo(() => new Map((grades ?? []).map((g) => [g.owner_id, g])), [grades]);

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

  function sendChatMessage() {
    const text = chatDraft.trim();
    if (!text || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "chat", text }));
    setChatDraft("");
  }

  // Merges real persisted chat with ephemeral join/leave lines into one
  // timeline, oldest first — the only place these two sources meet.
  const chatTimeline = useMemo(() => {
    const items: { key: string; at: number; node: ReactNode }[] = [];
    for (const m of chatMessages) {
      items.push({
        key: `msg-${m.id}`,
        at: new Date(m.created_at).getTime(),
        node: (
          <p key={`msg-${m.id}`} className={m.owner_id === myOwnerId ? "text-right" : ""}>
            <span className="text-black/50 dark:text-white/50">{teamNameByOwner.get(m.owner_id) ?? m.owner_name}: </span>
            <span>{m.text}</span>
          </p>
        ),
      });
    }
    for (const p of presenceEvents) {
      items.push({
        key: `presence-${p.ownerId}-${p.at}`,
        at: p.at,
        node: (
          <p key={`presence-${p.ownerId}-${p.at}`} className="text-center text-xs text-black/40 italic dark:text-white/40">
            {teamNameByOwner.get(p.ownerId) ?? `Owner ${p.ownerId}`} {p.online ? "joined" : "left"} the room
          </p>
        ),
      });
    }
    items.sort((a, b) => a.at - b.at);
    return items;
  }, [chatMessages, presenceEvents, teamNameByOwner, myOwnerId]);

  useEffect(() => {
    chatLogRef.current?.scrollTo({ top: chatLogRef.current.scrollHeight });
  }, [chatTimeline.length]);

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
      <DraftSetupPanel teams={teams} onDraftCreated={refreshStateAndPool} />
    ) : (
      <p className="text-sm text-black/50 dark:text-white/50">No draft has been set up yet.</p>
    );
  }
  if (!draftState) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading draft…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-4 ${
          beta ? (config!.status === "in_progress" ? "wl-card--live" : "wl-card") : "neon-panel"
        }`}
      >
        <div>
          <p className="text-xs text-black/50 dark:text-white/50">
            {config!.status === "complete"
              ? "Draft complete"
              : config!.status === "paused"
                ? "Paused"
                : config!.status === "not_started"
                  ? preDraftWindowActive
                    ? "Draft room open"
                    : "Not started"
                  : `Round ${currentPick?.round ?? "—"} · Pick ${config!.current_pick_number}`}
          </p>
          {config!.status === "in_progress" && currentPick && (
            <p className="flex items-center gap-1.5 text-lg font-semibold">
              {/* ESPN-style "are they actually here" indicator — the
                  same signal the round-2+ post-autopick grace period
                  is really watching for (app/domain/draft_engine.py's
                  AUTOPICK_GRACE_SECONDS), surfaced visually so the room
                  can see it too, not just infer it from a fast
                  autopick after the fact. */}
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  connectedOwnerIds.has(currentPick.owner_id) ? "bg-emerald-500" : "bg-black/20 dark:bg-white/20"
                }`}
                title={connectedOwnerIds.has(currentPick.owner_id) ? "Signed into the draft" : "Not signed in"}
                aria-hidden
              />
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
        {preDraftWindowActive && (
          <div className="text-3xl font-bold tabular-nums">{formatCountdown(secondsUntilStart)}</div>
        )}
        <span className="text-xs text-black/50 dark:text-white/50">{connected ? "● live" : "○ reconnecting…"}</span>
      </div>

      {preDraftWindowActive && (
        <div className={`flex flex-col items-center gap-1 rounded-xl p-6 text-center ${beta ? "wl-card" : "neon-panel"}`}>
          <p className="text-lg font-semibold">
            {secondsUntilStart > 0 ? (
              <>
                Draft begins in <span className="tabular-nums">{formatCountdown(secondsUntilStart)}</span>
              </>
            ) : (
              "Draft is starting momentarily…"
            )}
          </p>
          <p className="text-sm text-black/60 dark:text-white/60">
            You&apos;re early — build your player queue while you wait. Your queue will automatically be used first
            if you&apos;re on autodraft when your pick comes up.
          </p>
        </div>
      )}

      {config!.status === "not_started" && !preDraftWindowActive && !isCommissioner && (
        <div className={`rounded-xl p-6 text-center text-sm text-black/60 dark:text-white/60 ${beta ? "wl-card" : "neon-panel"}`}>
          {config!.scheduled_start ? (
            <>
              The draft room opens 1 hour before the draft starts.
              <br />
              Draft begins {new Date(config!.scheduled_start).toLocaleString()}.
            </>
          ) : (
            "The draft hasn't been scheduled yet — check back soon."
          )}
        </div>
      )}

      {isCommissioner && <DraftSetupPanel teams={teams} config={config!} onDraftCreated={refreshStateAndPool} />}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {gradesByOwner.size > 0 && (
        <DraftGradesLeaderboard
          grades={grades ?? []}
          narratives={narratives}
          teamNameByOwner={teamNameByOwner}
          openOwnerId={openGradeOwnerId}
          onToggle={(ownerId) => setOpenGradeOwnerId(openGradeOwnerId === ownerId ? null : ownerId)}
        />
      )}

      {config!.status !== "not_started" && (
        <DraftBoard
          config={config!}
          picks={draftState.picks}
          teamNameByOwner={teamNameByOwner}
          currentPickNumber={config!.current_pick_number}
          gradesByOwner={gradesByOwner}
          onOpenGrade={setOpenGradeOwnerId}
          beta={beta}
        />
      )}


      {(config!.status !== "not_started" || preDraftWindowActive) && (
        <div className="flex flex-col gap-4 sm:grid sm:grid-cols-3">
          <section className={`flex flex-col gap-2 rounded-xl p-4 sm:col-span-2 ${beta ? "wl-card" : "neon-panel"}`}>
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
              <section className={`flex flex-col gap-1 rounded-xl p-4 ${beta ? "wl-card" : "neon-panel"}`}>
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

            <section className={`flex flex-col gap-1 rounded-xl p-4 ${beta ? "wl-card" : "neon-panel"}`}>
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

            <section className={`flex flex-col gap-1 rounded-xl p-4 ${beta ? "wl-card" : "neon-panel"}`}>
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

            <section className={`flex flex-col gap-2 rounded-xl p-4 ${beta ? "wl-card" : "neon-panel"}`}>
              <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                Draft room chat
              </h2>
              <div ref={chatLogRef} className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
                {chatTimeline.length === 0 ? (
                  <p className="text-xs text-black/40 dark:text-white/40">No messages yet — say hi.</p>
                ) : (
                  chatTimeline.map((item) => item.node)
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendChatMessage();
                  }}
                  placeholder={connected ? "Message the room…" : "Reconnecting…"}
                  disabled={!connected}
                  aria-label="Draft room chat message"
                  maxLength={500}
                  className="min-w-0 flex-1 rounded-full border border-black/10 bg-transparent px-3 py-1 text-sm disabled:opacity-50 dark:border-white/10"
                />
                <button
                  onClick={sendChatMessage}
                  disabled={!connected || !chatDraft.trim()}
                  className="shrink-0 rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-30"
                >
                  Send
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

    </div>
  );
}
