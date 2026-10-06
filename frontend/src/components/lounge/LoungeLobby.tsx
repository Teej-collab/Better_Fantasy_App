"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createWatchParty, getWatchPartyRooms, type WatchPartyRoom, type WatchPartyRoomsResponse } from "@/lib/api";
import { lastName, loungeApi } from "@/lib/loungeLive";

// The Lounge lobby on the web — the same screen as the native app's
// (mobile/src/app/lounge-lobby.tsx, mockup 4): who's watching what, the
// games that matter to you right now, and one click to start a room for
// one. The site's own NFL and league tickers sit above it (the (app)
// layout's AppTickerBar). Rooms open in Chat (/chat?party=<id>), where
// the web runs the call.

type LobbyGame = {
  game_id: string;
  home_team: string;
  away_team: string;
  home_score: string | null;
  away_score: string | null;
  state: "pre" | "in" | "post" | null;
  status_detail: string | null;
  is_redzone: boolean;
  my_players: string[];
  opponent_players: string[];
  opponent_team_name: string | null;
  open_bet_legs: number;
};

const FACE_COLORS = ["#7c2d12", "#4c1d95", "#1e3a8a", "#065f46", "#831843", "#3f3f46"];
const ACCENT = "var(--user-accent, var(--wl-accent))";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

function scoreLine(g: LobbyGame): string {
  if (g.state === "pre") return `${g.away_team} @ ${g.home_team}`;
  return `${g.away_team} ${g.away_score ?? 0} · ${g.home_team} ${g.home_score ?? 0}`;
}

function stakesLine(g: LobbyGame): { text: string; tone: "mine" | "theirs" | "none" } {
  if (g.state === "post") return { text: "Final", tone: "none" };
  const parts: string[] = [];
  if (g.my_players.length) parts.push(`${g.my_players.length} of yours`);
  if (g.is_redzone && g.my_players.length) parts.push(`${lastName(g.my_players[0])}'s team in the red zone`);
  else if (g.opponent_players.length) parts.push(`${g.opponent_players.length} of ${g.opponent_team_name ?? "your opponent"}'s`);
  if (g.open_bet_legs) parts.push(`${g.open_bet_legs} bet${g.open_bet_legs === 1 ? "" : "s"} riding`);
  if (parts.length === 0) return { text: "No stakes — just a good game", tone: "none" };
  return { text: parts.join(" · "), tone: g.my_players.length ? "mine" : "theirs" };
}

export function LoungeLobby() {
  const router = useRouter();
  const [rooms, setRooms] = useState<WatchPartyRoomsResponse | null>(null);
  const [games, setGames] = useState<LobbyGame[]>([]);
  const [noLeague, setNoLeague] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [r, lobby] = await Promise.all([
          getWatchPartyRooms(),
          fetch("/api/backend/watch-party/lobby", { cache: "no-store" }).then((res) => (res.ok ? res.json() : { games: [] })),
        ]);
        if (cancelled) return;
        setRooms(r);
        setGames(lobby.games ?? []);
      } catch {
        if (!cancelled) setNoLeague(true);
      }
    }
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const gameById = new Map(games.map((g) => [g.game_id, g]));
  const open = rooms?.open_room ?? null;
  const privateRooms = rooms?.private_rooms ?? [];
  const parties = rooms?.party_rooms ?? [];
  const anyLive = !!open?.is_live || parties.some((r) => r.is_live) || privateRooms.some((r) => r.is_live);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /** A new open room for the whole league, with this game on its TV. */
  async function startParty(gameId?: string) {
    setStarting(true);
    setStartError(null);
    try {
      const id = await createWatchParty(gameId);
      router.push(`/chat?party=${id}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Couldn't start the party");
      setStarting(false);
    }
  }
  const mattering = games.filter((g) => g.state !== "post").slice(0, 4);

  async function enter(room: WatchPartyRoom, gameId?: string) {
    setBusy(room.id);
    try {
      if (gameId) await loungeApi.setTv(room.id, { game_id: gameId });
    } catch {
      // Still open the room; the sharer can pick the game there.
    }
    router.push(`/chat?party=${room.id}`);
  }

  function startRoom(g: LobbyGame) {
    if (!open) return;
    // The League Lounge takes the game unless it's already watching a
    // different one with people in it — then start a party for it.
    if (!open.is_live || !open.tv_game_id || open.tv_game_id === g.game_id) void enter(open, g.game_id);
    else void startParty(g.game_id);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 py-4" style={{ color: "#f3f4f6" }}>
      <header className="flex flex-col gap-1 pb-2">
        <h1 className="font-display m-0 text-3xl font-bold tracking-wide uppercase">The Lounge</h1>
        <p className="m-0 text-sm text-[#9aa3b2]">Watch it together. Sweat it together.</p>
      </header>

      {noLeague && (
        <p className="rounded-xl border border-white/[0.08] bg-[#12151d] p-4 text-sm text-[#9aa3b2]">
          Join or create a league to watch with your league. You can still start a private lounge below.
        </p>
      )}

      {open && (
        <>
          <span className="font-display text-[11px] font-semibold tracking-[1.2px] text-[#9aa3b2]">{anyLive ? "LIVE NOW" : "ROOMS"}</span>
          <LoungeCard room={open} game={open.tv_game_id ? gameById.get(open.tv_game_id) : undefined} busy={busy === open.id} onJoin={() => void enter(open)} />
        </>
      )}
      {parties.length > 0 && (
        <span className="font-display mt-2 text-[11px] font-semibold tracking-[1.2px] text-[#9aa3b2]">WATCH PARTIES — OPEN TO THE LEAGUE</span>
      )}
      {parties.map((r) => {
        const g = r.tv_game_id ? gameById.get(r.tv_game_id) : undefined;
        return (
          <div
            key={r.id}
            className="flex items-center gap-3 rounded-[14px] border px-3.5 py-3"
            style={r.is_live ? { background: "rgba(220,20,60,0.08)", borderColor: "rgba(220,20,60,0.4)" } : { background: "#12151d", borderColor: "rgba(255,255,255,0.08)" }}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                {r.is_live && <span className="rounded bg-[#dc143c] px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white">LIVE</span>}
                <b className="truncate text-sm">{r.name}</b>
              </span>
              <span className="truncate text-xs text-[#9aa3b2]">
                {g ? `${scoreLine(g)} ${g.status_detail} on the TV` : "Nothing on the TV yet"}
                {r.is_live ? ` · ${r.watchers?.length ?? 0} watching` : ""}
              </span>
            </div>
            <button onClick={() => void enter(r)} className="h-9 rounded-full px-3.5 text-[13px] font-bold" style={{ background: ACCENT, color: "#06110a" }}>
              {busy === r.id ? "…" : "Join"}
            </button>
          </div>
        );
      })}

      {privateRooms.map((r) => {
        const g = r.tv_game_id ? gameById.get(r.tv_game_id) : undefined;
        return (
          <div key={r.id} className="flex items-center gap-3 rounded-[14px] border border-white/[0.08] bg-[#12151d] px-3.5 py-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa3b2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 018 0v4" />
            </svg>
            <div className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-sm">{r.name}</b>
              <span className="truncate text-xs text-[#9aa3b2]">
                {r.is_live ? `${r.watchers?.length ?? 0} watching` : `${r.member_count} invited`}
                {g ? ` · ${g.away_team} @ ${g.home_team}` : ""}
              </span>
            </div>
            <button onClick={() => void enter(r)} className="h-9 rounded-full border border-white/[0.14] px-3.5 text-[13px] font-bold">
              {busy === r.id ? "…" : "Join"}
            </button>
          </div>
        );
      })}

      {mattering.length > 0 && (
        <span className="font-display mt-3 text-[11px] font-semibold tracking-[1.2px] text-[#9aa3b2]">GAMES THAT MATTER TO YOU</span>
      )}
      {mattering.map((g) => {
        const stakes = stakesLine(g);
        return (
          <div key={g.game_id} className="flex items-center gap-3 rounded-[14px] border border-white/[0.08] bg-[#12151d] px-3.5 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-mono text-sm">
                <b>{scoreLine(g)}</b> <span className="text-xs text-[#9aa3b2]">{g.status_detail}</span>
              </span>
              <span className="truncate text-xs" style={{ color: stakes.tone === "mine" ? ACCENT : stakes.tone === "theirs" ? "#fde68a" : "#9aa3b2" }}>
                {stakes.text}
              </span>
            </div>
            <button onClick={() => startRoom(g)} className="h-9 shrink-0 rounded-full border border-white/[0.14] px-3.5 text-xs font-bold whitespace-nowrap">
              Start a room
            </button>
          </div>
        );
      })}

      {!noLeague && (
        <>
          <button
            onClick={() => void startParty()}
            disabled={starting}
            className="mt-4 flex h-[50px] items-center justify-center rounded-full text-[15px] font-extrabold disabled:opacity-60"
            style={{ background: ACCENT, color: "#06110a" }}
          >
            {starting ? "Starting…" : "Start a watch party"}
          </button>
          <p className="m-0 text-center text-xs text-[#9aa3b2]">Opens a new room the whole league can join, with its own TV. It closes itself once everyone&apos;s gone.</p>
          {startError && <p className="m-0 text-center text-xs text-red-400">{startError}</p>}
        </>
      )}
      <Link href="/lounge/private" className="text-center text-xs font-semibold text-[#9aa3b2] hover:underline">
        Private lounge with a password — no league needed →
      </Link>
    </div>
  );
}

function LoungeCard({ room, game, busy, onJoin }: { room: WatchPartyRoom; game: LobbyGame | undefined; busy: boolean; onJoin: () => void }) {
  const watchers = room.watchers ?? [];
  const live = room.is_live;
  return (
    <button
      onClick={onJoin}
      className="flex w-full flex-col gap-2.5 rounded-2xl border p-3.5 text-left"
      style={live ? { background: "linear-gradient(180deg, rgba(220,20,60,0.16), rgba(220,20,60,0.04))", borderColor: "rgba(220,20,60,0.45)" } : { background: "#12151d", borderColor: "rgba(255,255,255,0.08)" }}
    >
      <span className="flex items-center gap-2">
        {live && <span className="rounded bg-[#dc143c] px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white">LIVE</span>}
        <b className="font-display text-lg tracking-wide uppercase">League Lounge</b>
        <span className="ml-auto text-xs" style={{ color: live ? "#fecdd3" : "#9aa3b2" }}>
          {live ? `${watchers.length} watching` : "always open"}
        </span>
      </span>
      {game ? (
        <span className="font-mono text-[13px]">
          <b>{scoreLine(game)}</b> <span className="text-[#9aa3b2]">{game.status_detail} on the TV</span>
        </span>
      ) : (
        <span className="text-[13px] text-[#9aa3b2]">{live ? "Hanging out — nothing on the TV yet" : `${room.member_count} in your league`}</span>
      )}
      <span className="flex items-center">
        {watchers.slice(0, 5).map((w, i) => (
          <span
            key={w.owner_id}
            className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-[#0b0d14] text-[10px] font-bold"
            style={{ background: FACE_COLORS[i % FACE_COLORS.length], marginLeft: i === 0 ? 0 : -6 }}
          >
            {initials(w.display_name)}
          </span>
        ))}
        <span className="ml-auto rounded-full px-4 py-2 text-[13px] font-extrabold" style={{ background: ACCENT, color: "#06110a" }}>
          {busy ? "Joining…" : "Jump in"}
        </span>
      </span>
    </button>
  );
}
