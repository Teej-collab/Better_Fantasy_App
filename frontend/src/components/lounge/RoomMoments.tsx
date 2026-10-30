"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WeekMatchupContextItem } from "@/lib/api";
import type { Bet } from "@/lib/betsApi";
import type { GamecastPlay, GamecastPlayFantasyPlayer, LiveGame } from "@/lib/gamecastApi";
import { isTouchdown, lastName, scoringHeadline, shade } from "@/lib/loungeLive";
import { nflTeamColor } from "@/lib/nfl-teams";

// The Lounge's pop-ups on the web — the same system as the native app's
// mobile/src/components/lounge/RoomMoments.tsx, keep the two in step.
// Three sizes of moment, sized by how much a play matters to the people
// in the room:
//
//   Tier 1, big moment: a touchdown, turnover or safety in the TV's game
//     that moves someone in the room by a point or more. A ribbon across
//     the bottom of the TV (the stream keeps playing), camera tiles light
//     up with what it did to each person, and a strip shows how your win
//     chance and the league's other matchups swung. About 8 seconds.
//   Tier 2, fantasy play: any other play worth 2+ points to someone in the
//     room (or your own player's big play from any game, with no game on
//     the TV). A tile glow and a notification, about 5 seconds.
//   Tier 3, league moment: a starter finishing at zero under the chug
//     rule (a full card), one of your bet legs hitting or missing, or a
//     rivalry matchup changing hands (notifications).
//
// All on the room's delay. One big moment at a time, the rest queue; no
// new Tier 1 within 30 seconds of the last unless it's a touchdown.

// How long a touchdown or turnover holds the TV (NeonTakeover).
const TIER1_MS = 5200;
const TOAST_MS = 5000;
const CHUG_MS = 12000;
const TIER1_COOLDOWN_MS = 30_000;
const SWING_HOLD_MS = 25_000;
const MAX_TOASTS = 3;

export type MomentKind = "touchdown" | "turnover" | "safety" | "play" | "roster" | "chug" | "bet" | "rivalry";

export type RoomMoment = {
  id: string;
  tier: 1 | 2 | 3;
  kind: MomentKind;
  at: number;
  title: string;
  detail: string;
  teamAbbr?: string | null;
  myPoints?: number;
  // owner_id as a string (a room participant's identity) → points.
  impacts?: Record<string, number>;
  score?: { scorer: string; scorerScore: number | null; other: string; otherScore: number | null };
  chugRule?: string;
  chugIsMe?: boolean;
  good?: boolean;
};

export type Swing = { before: number | null; after: number | null; moved: { label: string; delta: number }[]; ready: boolean };

function bigKind(play: GamecastPlay): MomentKind | null {
  if (isTouchdown(play)) return "touchdown";
  if (/safety/i.test(play.description)) return "safety";
  if (play.is_turnover) return "turnover";
  return null;
}

function fmtPts(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;
}

function scoreOf(team: { score: number | string | null }): number | null {
  return team.score === null || team.score === undefined ? null : Number(team.score);
}

export function useRoomMoments({
  winPct,
  league,
  bets,
  myOwnerId,
  roomOwnerIds,
  chugEnabled,
  chugRuleName,
}: {
  winPct: number | null;
  league: WeekMatchupContextItem[];
  bets: Bet[];
  myOwnerId: number;
  roomOwnerIds: string[];
  chugEnabled: boolean;
  chugRuleName: string | null;
}) {
  const [big, setBig] = useState<RoomMoment | null>(null);
  const bigQueue = useRef<RoomMoment[]>([]);
  const [toasts, setToasts] = useState<RoomMoment[]>([]);
  const [history, setHistory] = useState<RoomMoment[]>([]);
  const [swing, setSwing] = useState<Swing | null>(null);
  const swingBase = useRef<{ mine: number | null; league: Map<number, number>; at: number } | null>(null);
  const lastTier1 = useRef(0);
  const room = useRef<Set<string>>(new Set());
  const latest = useRef({ winPct, league });
  const roomKey = roomOwnerIds.join(",");
  useEffect(() => {
    room.current = new Set(roomKey ? roomKey.split(",") : []);
  }, [roomKey]);
  useEffect(() => {
    latest.current = { winPct, league };
  }, [winPct, league]);

  const record = useCallback((m: RoomMoment) => {
    setHistory((h) => (h.some((x) => x.id === m.id) ? h : [m, ...h].slice(0, 60)));
  }, []);
  const showBig = useCallback(
    (m: RoomMoment) => {
      record(m);
      setBig((current) => {
        if (current) {
          if (bigQueue.current.length < 3) bigQueue.current.push(m);
          return current;
        }
        return m;
      });
    },
    [record]
  );
  const toast = useCallback(
    (m: RoomMoment) => {
      record(m);
      setToasts((t) => (t.some((x) => x.id === m.id) ? t : [...t, m]));
    },
    [record]
  );

  useEffect(() => {
    if (!big) return;
    const id = setTimeout(() => setBig(bigQueue.current.shift() ?? null), big.kind === "chug" ? CHUG_MS : TIER1_MS);
    return () => clearTimeout(id);
  }, [big]);
  useEffect(() => {
    if (toasts.length === 0) return;
    const id = setTimeout(() => setToasts((t) => t.slice(1)), TOAST_MS);
    return () => clearTimeout(id);
  }, [toasts]);

  const onPlay = useCallback(
    (play: GamecastPlay, game: LiveGame, players: GamecastPlayFantasyPlayer[]) => {
      const owners = new Map<string, string>();
      for (const m of latest.current.league) {
        for (const side of [m.home, m.away]) for (const p of side.roster) if (p.player_id !== null) owners.set(String(p.player_id), String(side.owner_id));
      }
      const impacts: Record<string, number> = {};
      let myPoints = 0;
      for (const p of players) {
        if (Math.abs(p.points) < 0.05) continue;
        const owner = owners.get(String(p.player_id)) ?? (p.is_mine ? String(myOwnerId) : null);
        if (p.is_mine) myPoints += p.points;
        if (owner) impacts[owner] = (impacts[owner] ?? 0) + p.points;
      }
      const me = String(myOwnerId);
      const relevant = (min: number) => Object.entries(impacts).some(([o, pts]) => Math.abs(pts) >= min && (room.current.has(o) || o === me));
      const kind = bigKind(play);
      const now = Date.now();
      const coolingDown = now - lastTier1.current < TIER1_COOLDOWN_MS && kind !== "touchdown";
      const scorer = play.team_abbr ?? game.home_team.abbr;
      const scorerSide = scorer === game.home_team.abbr ? game.home_team : game.away_team;
      const otherSide = scorerSide === game.home_team ? game.away_team : game.home_team;

      if (kind && relevant(1) && !coolingDown) {
        lastTier1.current = now;
        swingBase.current = {
          mine: latest.current.winPct,
          league: new Map(latest.current.league.map((m) => [m.matchup_id, m.home.win_probability ?? -1])),
          at: now,
        };
        setSwing({ before: latest.current.winPct, after: null, moved: [], ready: false });
        showBig({
          id: `play-${play.play_id}`,
          tier: 1,
          kind,
          at: now,
          title: kind === "touchdown" ? "Touchdown" : kind === "safety" ? "Safety" : "Turnover",
          detail: kind === "touchdown" ? scoringHeadline(play, game) : play.description.replace(/\.$/, ""),
          teamAbbr: kind === "turnover" ? otherSide.abbr : scorer,
          myPoints: myPoints || undefined,
          impacts,
          score: { scorer: scorerSide.abbr, scorerScore: scoreOf(scorerSide), other: otherSide.abbr, otherScore: scoreOf(otherSide) },
        });
        return;
      }
      if (relevant(2) || (kind && relevant(1))) {
        const top = [...players].sort((a, b) => Number(b.is_mine) - Number(a.is_mine) || Math.abs(b.points) - Math.abs(a.points))[0];
        if (!top) return;
        const yards = play.yards_gained ? `${Math.abs(play.yards_gained)}-yd ${play.play_type === "pass" ? "catch" : play.play_type === "rush" ? "run" : "play"}` : "big play";
        toast({
          id: `play-${play.play_id}`,
          tier: 2,
          kind: "play",
          at: now,
          title: `${lastName(top.player_name)}, ${kind === "touchdown" ? "touchdown" : kind === "turnover" ? "turnover" : yards}`,
          detail: top.is_mine ? `${fmtPts(top.points)} for you` : `${fmtPts(top.points)} for ${top.owner_name.split(" ")[0]}`,
          teamAbbr: top.team_name,
          myPoints: myPoints || undefined,
          impacts,
          good: top.is_mine ? top.points >= 0 : undefined,
        });
      }
    },
    [myOwnerId, showBig, toast]
  );

  const onRosterPlay = useCallback(
    (id: string, playerName: string, touchdown: boolean, points: number, proTeam: string | null) => {
      toast({
        id: `roster-${id}`,
        tier: 2,
        kind: "roster",
        at: Date.now(),
        title: `${lastName(playerName)}, ${touchdown ? "touchdown" : "big play"}`,
        detail: `${fmtPts(points)} for you`,
        teamAbbr: proTeam,
        myPoints: points,
        impacts: { [String(myOwnerId)]: points },
        good: points >= 0,
      });
    },
    [myOwnerId, toast]
  );

  // The swing, once the league's numbers catch up on the room's delay.
  useEffect(() => {
    const base = swingBase.current;
    if (!base) return;
    const moved: Swing["moved"] = [];
    let changed = winPct !== base.mine;
    for (const m of league) {
      const before = base.league.get(m.matchup_id);
      const after = m.home.win_probability;
      if (before === undefined || before < 0 || after === null) continue;
      const delta = after - before;
      if (Math.abs(delta) >= 0.5) changed = true;
      if (Math.abs(delta) < 3) continue;
      const up = delta > 0 ? m.home : m.away;
      moved.push({ label: up.owner_name.split(" ")[0], delta: Math.abs(delta) });
    }
    if (!changed) return;
    setSwing({ before: base.mine, after: winPct, moved: moved.sort((a, b) => b.delta - a.delta).slice(0, 4), ready: true });
  }, [league, winPct]);
  useEffect(() => {
    if (!swing) return;
    const id = setTimeout(() => {
      swingBase.current = null;
      setSwing(null);
    }, SWING_HOLD_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swing?.ready, swing === null]);

  // League moments. The first look only remembers what's already true.
  const seen = useRef<{ chug: Set<string>; leaders: Map<number, string>; legs: Map<number, string> } | null>(null);
  useEffect(() => {
    if (league.length === 0) return;
    const first = seen.current === null;
    if (first) seen.current = { chug: new Set(), leaders: new Map(), legs: new Map() };
    const s = seen.current!;
    for (const m of league) {
      if (chugEnabled) {
        for (const side of [m.home, m.away]) {
          for (const p of side.roster) {
            if (["BE", "IR", "TAXI"].includes(p.lineup_slot ?? "") || p.on_bye || p.game_status !== "final" || (p.points_scored ?? 0) > 0) continue;
            const key = `${m.week}-${side.team_id}-${p.player_id}`;
            if (s.chug.has(key)) continue;
            s.chug.add(key);
            if (first) continue;
            const mine = side.owner_id === myOwnerId;
            showBig({
              id: `chug-${key}`,
              tier: 3,
              kind: "chug",
              at: Date.now(),
              title: "Chug alert",
              detail: `${mine ? "Your" : `${side.owner_name.split(" ")[0]}'s`} starter ${p.player_name} finished at ${(p.points_scored ?? 0).toFixed(1)}. One chug owed.`,
              chugRule: chugRuleName ?? "The chug rule",
              chugIsMe: mine,
              impacts: { [String(side.owner_id)]: 0 },
            });
          }
        }
      }
      if (m.is_rivalry && (m.home.score ?? 0) > 0 && (m.away.score ?? 0) > 0 && m.home.score !== m.away.score) {
        const leader = (m.home.score ?? 0) > (m.away.score ?? 0) ? m.home : m.away;
        const trailer = leader === m.home ? m.away : m.home;
        const prev = s.leaders.get(m.matchup_id);
        s.leaders.set(m.matchup_id, String(leader.team_id));
        if (prev !== undefined && prev !== String(leader.team_id)) {
          const me = leader.owner_id === myOwnerId;
          toast({
            id: `rivalry-${m.matchup_id}-${Date.now()}`,
            tier: 3,
            kind: "rivalry",
            at: Date.now(),
            title: me ? `You took the lead on ${trailer.owner_name.split(" ")[0]}` : `${leader.owner_name.split(" ")[0]} took the lead on ${trailer.owner_name.split(" ")[0]}`,
            detail: `${m.rivalry?.name ?? "Rivalry"} · ${(leader.score ?? 0).toFixed(1)}–${(trailer.score ?? 0).toFixed(1)}`,
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league]);
  useEffect(() => {
    if (!seen.current) return;
    const s = seen.current;
    for (const bet of bets) {
      for (const leg of bet.legs) {
        const prev = s.legs.get(leg.id);
        s.legs.set(leg.id, leg.status);
        if (prev === "open" && (leg.status === "won" || leg.status === "lost")) {
          const left = bet.legs.filter((l) => l.status === "open").length;
          toast({
            id: `bet-${leg.id}`,
            tier: 3,
            kind: "bet",
            at: Date.now(),
            title: `${leg.description} · ${leg.status === "won" ? "hit" : "missed"}`,
            detail: bet.legs.length > 1 ? (left > 0 ? `${left} leg${left === 1 ? "" : "s"} left` : "Parlay settled") : "Your bet",
            good: leg.status === "won",
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bets]);

  const dismissBig = useCallback(() => setBig(bigQueue.current.shift() ?? null), []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const latestToast = toasts[toasts.length - 1];
  const tileImpacts = big?.impacts ?? latestToast?.impacts ?? {};
  const chugOwner = big?.kind === "chug" ? (Object.keys(big.impacts ?? {})[0] ?? null) : null;

  return { big, toasts, history, swing, tileImpacts, chugOwner, onPlay, onRosterPlay, dismissBig, dismissToast };
}

/** Tier 1: across the bottom of the TV, the stream still playing above. */
export function MomentRibbon({ moment, accent, onDismiss }: { moment: RoomMoment; accent: string; onDismiss: () => void }) {
  const color = nflTeamColor(moment.teamAbbr ?? "") ?? "#e31837";
  return (
    <button onClick={onDismiss} aria-label={`${moment.title}. ${moment.detail}. Dismiss`} className="absolute right-0 bottom-0 left-0 z-10 flex flex-col text-left">
      <span className="flex items-center gap-3 px-4 py-2" style={{ background: `linear-gradient(90deg, ${color} 0%, ${color} 65%, ${shade(color, 0.6)} 100%)` }}>
        <span className="font-display text-2xl font-bold tracking-wide italic sm:text-4xl">{moment.title.toUpperCase()}</span>
        {moment.score && (
          <span className="ml-auto font-mono text-sm font-bold sm:text-base">
            {moment.score.scorer} {moment.score.scorerScore ?? ""}
            <span className="font-medium text-white/75">
              {"  "}
              {moment.score.other} {moment.score.otherScore ?? ""}
            </span>
          </span>
        )}
      </span>
      <span className="flex items-center gap-2 px-4 py-1.5" style={{ background: shade(color, 0.75) }}>
        <span className="min-w-0 flex-1 truncate text-[13px]">{moment.detail}</span>
        {moment.myPoints !== undefined && (
          <span className="rounded-full px-2.5 py-0.5 font-mono text-xs font-bold text-[#05060a]" style={{ background: moment.myPoints >= 0 ? accent : "#f87171" }}>
            {fmtPts(moment.myPoints)} yours
          </span>
        )}
      </span>
    </button>
  );
}

/** Tier 1: how your win chance and the league's matchups swung. */
export function SwingStrip({ swing, accent }: { swing: Swing; accent: string }) {
  const before = swing.before;
  const after = swing.after ?? swing.before;
  const lo = before !== null && after !== null ? Math.min(before, after) : (after ?? 0);
  const hi = before !== null && after !== null ? Math.max(before, after) : (after ?? 0);
  const up = before !== null && after !== null ? after >= before : true;
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-white/[0.08] bg-[#10131b] p-3">
      <div className="flex items-center gap-3">
        <span className="text-xs text-[#9aa3b2]">Your win chance</span>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#2b2f3a]">
          <div className="absolute inset-y-0 left-0" style={{ width: `${lo}%`, background: `${accent}59` }} />
          <div className="absolute inset-y-0" style={{ left: `${lo}%`, width: `${Math.max(0, hi - lo)}%`, background: up ? accent : "#f87171" }} />
        </div>
        <span className="font-mono text-[13px] font-bold">
          {swing.ready && before !== null && after !== null && Math.round(before) !== Math.round(after) ? (
            <>
              <span className="text-[#9aa3b2]">{Math.round(before)}→</span>
              <span style={{ color: up ? accent : "#f87171" }}>{Math.round(after)}%</span>
            </>
          ) : after !== null ? (
            `${Math.round(after)}%`
          ) : (
            "—"
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        {!swing.ready ? (
          <span className="text-[#9aa3b2]">Updating the league…</span>
        ) : swing.moved.length === 0 ? (
          <span className="text-[#9aa3b2]">No other matchup moved much</span>
        ) : (
          <>
            <span className="text-[#9aa3b2]">
              {swing.moved.length} matchup{swing.moved.length === 1 ? "" : "s"} moved
            </span>
            {swing.moved.map((m) => (
              <span key={m.label} className="rounded-full bg-[#1f2533] px-2 py-0.5">
                {m.label} <b style={{ color: accent }}>+{Math.round(m.delta)}%</b>
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Tier 3's big one: a starter finished at zero, under the chug rule. */
export function ChugAlertCard({ moment, onPileOn, onDismiss }: { moment: RoomMoment; onPileOn: () => void; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-2xl bg-[#facc15] p-4 text-[#120f02] shadow-[0_0_40px_rgba(250,204,21,0.35)]">
      <div className="flex items-center justify-between">
        <span className="font-display text-xs font-bold tracking-wider">{(moment.chugRule ?? "Chug rule").toUpperCase()}</span>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-base font-extrabold">
          ✕
        </button>
      </div>
      <span className="font-display text-4xl leading-none font-bold italic">CHUG ALERT</span>
      <span className="text-sm">{moment.detail}</span>
      <div className="mt-1 flex gap-2">
        {moment.chugIsMe ? (
          <Link href="/chug" onClick={onDismiss} className="flex h-10 flex-1 items-center justify-center rounded-full bg-[#120f02] text-sm font-extrabold text-[#facc15]">
            Film it now
          </Link>
        ) : (
          <button onClick={onPileOn} className="h-10 flex-1 rounded-full bg-[#120f02] text-sm font-extrabold text-[#facc15]">
            Pile on
          </button>
        )}
        <button onClick={onDismiss} className="h-10 flex-1 rounded-full bg-[rgba(18,15,2,0.12)] text-sm font-bold">
          Later
        </button>
      </div>
    </div>
  );
}

/** Tier 2 and the small Tier 3s: stacked notifications, newest in front. */
export function MomentToasts({ toasts, accent, onDismiss }: { toasts: RoomMoment[]; accent: string; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  const shown = toasts.slice(-MAX_TOASTS);
  const front = shown[shown.length - 1];
  const behind = shown.length - 1;
  const league = front.kind === "bet" || front.kind === "rivalry";
  const color = front.kind === "bet" ? "#93c5fd" : front.kind === "rivalry" ? "#c4b5fd" : (nflTeamColor(front.teamAbbr ?? "") ?? "#3a4558");
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 w-[min(360px,calc(100vw-2rem))]" aria-live="polite">
      {behind >= 2 && <div className="mx-6 -mb-3 h-5 rounded-t-2xl bg-[rgba(32,38,50,0.45)]" />}
      {behind >= 1 && <div className="mx-3 -mb-3 h-5 rounded-t-2xl bg-[rgba(32,38,50,0.7)]" />}
      <button
        onClick={() => onDismiss(front.id)}
        className="pointer-events-auto relative flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-[rgba(32,38,50,0.97)] p-3 text-left shadow-2xl"
        aria-label={`${front.title}. ${front.detail}. Dismiss`}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[11px] font-extrabold"
          style={league ? { background: `${color}33`, color } : { background: color, color: "#fff" }}
        >
          {front.kind === "bet" ? "BET" : front.kind === "rivalry" ? "VS" : (front.teamAbbr ?? "").slice(0, 3)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-sm">{front.title}</b>
          <span className="truncate text-[12.5px]" style={{ color: front.good === true ? accent : front.good === false ? "#f87171" : "#9aa3b2" }}>
            {front.detail}
          </span>
        </span>
        {toasts.length > MAX_TOASTS && <span className="font-mono text-xs text-[#9aa3b2]">+{toasts.length - MAX_TOASTS}</span>}
      </button>
    </div>
  );
}

/** Every moment this visit, newest first: the header's Moments menu. */
/** The big moment on the TV (2026-10-29 "Neon Takeover", the pick from
 *  the Scoring Moments mockups): the picture dims, a neon frame lights
 *  around the TV, the word catches letter by letter, then who did it and
 *  what it's worth to you. Green when it's good for you, red when it's
 *  not, orange for a turnover, the scoring team's color for somebody else
 *  in the room. All CSS (.nt-* in globals.css); click to put it away. */
export function NeonTakeover({ moment, onDismiss }: { moment: RoomMoment; onDismiss: () => void }) {
  const neon =
    moment.kind === "turnover"
      ? "#ff8a2a"
      : moment.myPoints !== undefined && moment.myPoints > 0
        ? "#39ff14"
        : moment.myPoints !== undefined && moment.myPoints < 0
          ? "#ff3b5c"
          : (nflTeamColor(moment.teamAbbr ?? "") ?? "#ffb612");
  const word = moment.title.toUpperCase();
  return (
    <button
      key={moment.id}
      onClick={onDismiss}
      aria-label={`${moment.title}. ${moment.detail}. Dismiss`}
      className="nt absolute inset-0 z-10 block cursor-pointer border-0 bg-transparent p-0 text-left"
      style={{ "--nt": neon } as React.CSSProperties}
    >
      <span className="nt-veil" />
      <span className="nt-frame" />
      <span className="nt-stage">
        <span className="nt-word font-display" aria-hidden>
          {word.split("").map((ch, i) => (
            <span key={i} style={{ animationDelay: `${0.35 + i * 0.06}s` }}>
              {ch}
            </span>
          ))}
        </span>
        <span className="nt-who">
          <b>{moment.detail}</b>
          {moment.score && (
            <span>
              {moment.score.scorer} {moment.score.scorerScore ?? ""} · {moment.score.other} {moment.score.otherScore ?? ""}
            </span>
          )}
        </span>
        {moment.myPoints !== undefined && <span className="nt-pill font-mono">{fmtPts(moment.myPoints)} for you</span>}
      </span>
    </button>
  );
}

/** The room's latest fantasy moment, one slim line over the chat
 *  (2026-10-29: every play used to land in the chat itself). Click for
 *  the full list. */
export function MomentStrip({ latest, count, accent, onOpen }: { latest: RoomMoment | null; count: number; accent: string; onOpen: () => void }) {
  if (!latest) return null;
  const color =
    latest.kind === "turnover" ? "#ff8a2a" : latest.kind === "chug" ? "#facc15" : latest.myPoints !== undefined && latest.myPoints < 0 ? "#ff5c77" : accent;
  return (
    <button
      onClick={onOpen}
      aria-label={`Latest moment: ${latest.title}, ${latest.detail}. ${count} in all. Open moments`}
      className="flex min-h-9 w-full items-center gap-2 rounded-full border bg-[rgba(12,15,22,0.92)] px-3 py-1.5 text-left text-sm hover:bg-white/[0.04]"
      style={{ borderColor: `${color}66`, boxShadow: `0 0 12px ${color}33` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="min-w-0 flex-1 truncate">
        <b className="font-display tracking-wide">{latest.title}</b>
        <span className="text-[#9aa3b2]"> · {latest.detail}</span>
      </span>
      {latest.myPoints !== undefined && (
        <b className="font-mono" style={{ color }}>
          {fmtPts(latest.myPoints)}
        </b>
      )}
      {count > 1 && <span className="font-mono text-xs text-[#9aa3b2]">+{count - 1}</span>}
      <span className="text-[#9aa3b2]">›</span>
    </button>
  );
}

export function MomentsMenu({ history, accent, onClose }: { history: RoomMoment[]; accent: string; onClose: () => void }) {
  return (
    <div className="absolute top-full right-0 z-40 mt-2 flex max-h-[60vh] w-[340px] flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-[#0f1420] p-3 text-[13px] shadow-2xl">
      <div className="flex items-center justify-between">
        <b>Moments</b>
        <button onClick={onClose} aria-label="Close" className="text-[#9aa3b2]">
          ✕
        </button>
      </div>
      {history.length === 0 && <p className="text-[#9aa3b2]">Big plays, fantasy swings and league moments show up here as they happen.</p>}
      {history.map((m) => (
        <div key={m.id} className="flex items-center gap-2.5 rounded-lg bg-[#161a24] p-2.5">
          <span className="font-display w-16 shrink-0 text-[11px] font-bold tracking-wide" style={{ color: m.tier === 1 ? accent : m.kind === "chug" ? "#facc15" : "#9aa3b2" }}>
            {m.kind === "chug" ? "CHUG" : m.kind === "bet" ? "BET" : m.kind === "rivalry" ? "RIVAL" : m.tier === 1 ? m.title.toUpperCase() : "PLAY"}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate">{m.tier === 1 ? m.detail : m.title}</b>
            <span className="truncate text-xs text-[#9aa3b2]">
              {m.tier === 1 ? (m.myPoints !== undefined ? `${fmtPts(m.myPoints)} for you` : (m.teamAbbr ?? "")) : m.detail}
            </span>
          </span>
          <span className="font-mono text-[11px] text-[#9aa3b2]">{new Date(m.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
        </div>
      ))}
    </div>
  );
}
