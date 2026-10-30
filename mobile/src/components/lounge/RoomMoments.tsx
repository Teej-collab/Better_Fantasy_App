import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { scoringHeadline, shade } from '@/lib/loungeLive';
import type { LoungeSweat } from '@/lib/loungeSweat';
import { lastName } from '@/lib/loungeSweat';
import { nflTeamColor } from '@/lib/nflTeams';
import { BIG_SWING, redZoneNow, useLeagueMoments, type RedZone } from '@/lib/leagueMoments';
import type { MomentsMode } from '@/lib/momentsMode';
import type { GamecastPlay, LiveGame, PlayFantasyPlayer } from '@/lib/types';

// The Lounge's pop-ups (2026-10, mockup "Combined" on the Lounge Moment
// Pop-ups canvas): one system, three sizes of moment, sized by how much
// a play matters to the people in the room rather than how big it is.
//
//   Tier 1, big moment: a touchdown, turnover or safety in the TV's game
//     that moves someone in the room by a point or more. A ribbon across
//     the bottom of the TV (the stream keeps playing), everyone's camera
//     tile lights up with what it did to them, and a strip shows how your
//     win chance and the league's other matchups swung. About 8 seconds.
//   Tier 2, fantasy play: any other play worth 2+ points to someone in the
//     room (or, with no game on the TV, your own player's big play from any
//     game). A tile glow and a small notification, about 5 seconds.
//   Tier 3, league moment: a starter finishing at zero under the league's
//     chug rule (a full card the whole room sees), one of your bet legs
//     hitting or missing, or a rivalry matchup changing hands (small
//     notifications).
//
// Everything arrives on the room's delay (plays come from useDelayedGame,
// league data from useLoungeSweat), so nothing beats the TV. One big
// moment at a time; the rest queue. No new Tier 1 within 30 seconds of
// the last unless it's a touchdown. Every moment also goes into the
// Moments history and the room's chat.

// How long a touchdown or turnover holds the TV (NeonTakeover.tsx).
const TIER1_MS = 5200;
const TOAST_MS = 5000;
const CHUG_MS = 12000;
const TIER1_COOLDOWN_MS = 30_000;
const SWING_HOLD_MS = 25_000;
const MAX_TOASTS = 3;

export type MomentKind = 'touchdown' | 'turnover' | 'safety' | 'play' | 'roster' | 'chug' | 'bet' | 'rivalry' | 'swing' | 'elsewhere' | 'cash';

export type RoomMoment = {
  id: string;
  tier: 1 | 2 | 3;
  kind: MomentKind;
  at: number;
  title: string;
  detail: string;
  teamAbbr?: string | null;
  // Fantasy points for you on this play, when any.
  myPoints?: number;
  // owner_id (as a string, a room participant's identity) → points.
  impacts?: Record<string, number>;
  score?: { scorer: string; scorerScore: number | null; other: string; otherScore: number | null };
  // Chug alerts: whose starter, and whether it's you.
  chugOwnerName?: string;
  chugIsMe?: boolean;
  good?: boolean;
  // For or against you (the "Mine only" setting keeps just these).
  mine?: boolean;
  // Notifications folded into this one (several plays close together).
  folded?: number;
};

/** A touchdown on the TV that nobody in the room has a stake in: a slim
 *  broadcast strip across the bottom of the picture. */
export type TvTouchdown = { id: string; team: string; text: string; score: string };

// Plays this close together fold into one notification.
const FOLD_MS = 20_000;

export type Swing = {
  before: number | null;
  after: number | null;
  moved: { label: string; delta: number }[];
  ready: boolean;
};

/** A touchdown, as the TV shows it (on the room's delay). */
export function isTouchdown(play: GamecastPlay): boolean {
  return play.is_scoring_play && (/touchdown/i.test(play.description) || play.event_type === 'TOUCHDOWN');
}

function bigKind(play: GamecastPlay): MomentKind | null {
  if (isTouchdown(play)) return 'touchdown';
  if (/safety/i.test(play.description)) return 'safety';
  if (play.is_turnover) return 'turnover';
  return null;
}

function fmtPts(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;
}

export function useRoomMoments({
  sweat,
  myOwnerId,
  roomOwnerIds,
  chugEnabled,
  chugRuleName,
  mode = 'all',
  tvTeams,
}: {
  sweat: LoungeSweat;
  myOwnerId: number | null;
  // Who's in the room right now, by owner id (participant identities).
  roomOwnerIds: string[];
  chugEnabled: boolean;
  chugRuleName: string | null;
  // The Moments setting (lib/momentsMode.ts).
  mode?: MomentsMode;
  // The two teams in the TV's game: its own play-by-play covers them.
  tvTeams?: { current: string[] };
}) {
  const [tvTd, setTvTd] = useState<TvTouchdown | null>(null);
  const [big, setBig] = useState<RoomMoment | null>(null);
  const bigQueue = useRef<RoomMoment[]>([]);
  const [toasts, setToasts] = useState<RoomMoment[]>([]);
  const [history, setHistory] = useState<RoomMoment[]>([]);
  const [swing, setSwing] = useState<Swing | null>(null);
  const swingBase = useRef<{ mine: number | null; league: Map<number, number>; at: number } | null>(null);
  const lastTier1 = useRef(0);
  const room = useRef<Set<string>>(new Set());
  const sweatRef = useRef(sweat);
  const roomKey = roomOwnerIds.join(',');
  useEffect(() => {
    room.current = new Set(roomKey ? roomKey.split(',') : []);
  }, [roomKey]);
  useEffect(() => {
    sweatRef.current = sweat;
  }, [sweat]);

  const record = useCallback((m: RoomMoment) => {
    setHistory((h) => (h.some((x) => x.id === m.id) ? h : [m, ...h].slice(0, 60)));
  }, []);

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const showBig = useCallback(
    (m: RoomMoment) => {
      record(m);
      // "Mine only": someone else's touchdown just gets the TV strip.
      if (modeRef.current === 'mine' && m.tier === 1 && !m.mine && m.kind !== 'cash') return;
      setBig((current) => {
        if (current) {
          if (bigQueue.current.length < 3) bigQueue.current.push(m);
          return current;
        }
        return m;
      });
    },
    [record],
  );

  const toast = useCallback(
    (m: RoomMoment) => {
      record(m);
      if (modeRef.current === 'big') return;
      if (modeRef.current === 'mine' && !m.mine) return;
      setToasts((t) => {
        if (t.some((x) => x.id === m.id)) return t;
        // Plays close together fold into one: "3 plays · +12.4 for you".
        const last = t[t.length - 1];
        const foldable = (k: MomentKind) => k === 'play' || k === 'roster' || k === 'elsewhere';
        if (last && foldable(last.kind) && foldable(m.kind) && m.at - last.at < FOLD_MS) {
          const n = (last.folded ?? 1) + 1;
          const mine = (last.myPoints ?? 0) + (m.myPoints ?? 0);
          return [
            ...t.slice(0, -1),
            {
              ...m,
              id: `${last.id}+${m.id}`,
              folded: n,
              title: `${n} plays`,
              detail: mine ? `${fmtPts(mine)} for you · latest ${m.title}` : `Latest: ${m.title}`,
              myPoints: mine || undefined,
              good: mine ? mine >= 0 : m.good,
              mine: last.mine || m.mine,
            },
          ];
        }
        return [...t, m];
      });
    },
    [record],
  );

  // Big moments play one at a time, then the next in line.
  useEffect(() => {
    if (!big) return;
    if (big.tier === 1) haptics.success();
    else haptics.warning();
    const id = setTimeout(() => setBig(bigQueue.current.shift() ?? null), big.kind === 'chug' ? CHUG_MS : TIER1_MS);
    return () => clearTimeout(id);
  }, [big]);

  // Each notification clears itself; the oldest goes first.
  useEffect(() => {
    if (toasts.length === 0) return;
    const id = setTimeout(() => setToasts((t) => t.slice(1)), TOAST_MS);
    return () => clearTimeout(id);
  }, [toasts]);

  /** Owner (as a participant identity) for each player on this week's rosters. */
  const ownerOfPlayer = useCallback((): Map<string, string> => {
    const map = new Map<string, string>();
    for (const m of sweatRef.current.league) {
      for (const side of [m.home, m.away]) {
        for (const p of side.roster) if (p.player_id !== null) map.set(String(p.player_id), String(side.owner_id));
      }
    }
    return map;
  }, []);

  /** A play from the TV's game, with its fantasy points. */
  const onPlay = useCallback(
    (play: GamecastPlay, game: LiveGame, players: PlayFantasyPlayer[]) => {
      const owners = ownerOfPlayer();
      const impacts: Record<string, number> = {};
      let myPoints = 0;
      for (const p of players) {
        if (Math.abs(p.points) < 0.05) continue;
        const owner = owners.get(String(p.player_id)) ?? (p.is_mine && myOwnerId !== null ? String(myOwnerId) : null);
        if (p.is_mine) myPoints += p.points;
        if (owner) impacts[owner] = (impacts[owner] ?? 0) + p.points;
      }
      const me = myOwnerId !== null ? String(myOwnerId) : null;
      const relevant = (min: number) =>
        Object.entries(impacts).some(([owner, pts]) => Math.abs(pts) >= min && (room.current.has(owner) || owner === me));
      const kind = bigKind(play);
      const now = Date.now();
      const coolingDown = now - lastTier1.current < TIER1_COOLDOWN_MS && kind !== 'touchdown';
      const scorer = play.team_abbr ?? game.home_team.abbr;
      const scorerSide = scorer === game.home_team.abbr ? game.home_team : game.away_team;
      const otherSide = scorerSide === game.home_team ? game.away_team : game.home_team;

      if (kind === 'touchdown' && !(relevant(1) && !coolingDown && !(modeRef.current === 'mine' && !myPoints))) {
        // Nobody in the room (or, with "Mine only", you) has a stake: the
        // TV still gets its touchdown, as a broadcast strip.
        setTvTd({
          id: play.play_id,
          team: scorer,
          text: scoringHeadline(play, game),
          score: `${scorerSide.abbr} ${scorerSide.score ?? ''} · ${otherSide.abbr} ${otherSide.score ?? ''}`,
        });
      }
      if (kind && relevant(1) && !coolingDown) {
        lastTier1.current = now;
        swingBase.current = {
          mine: sweatRef.current.winPct,
          league: new Map(sweatRef.current.league.map((m) => [m.matchup_id, m.home.win_probability ?? -1])),
          at: now,
        };
        setSwing({ before: sweatRef.current.winPct, after: null, moved: [], ready: false });
        showBig({
          id: `play-${play.play_id}`,
          tier: 1,
          kind,
          at: now,
          title: kind === 'touchdown' ? 'Touchdown' : kind === 'safety' ? 'Safety' : 'Turnover',
          detail: kind === 'touchdown' ? scoringHeadline(play, game) : play.description.replace(/\.$/, ''),
          teamAbbr: kind === 'turnover' ? otherSide.abbr : scorer,
          myPoints: myPoints || undefined,
          mine: !!myPoints,
          impacts,
          score: { scorer: scorerSide.abbr, scorerScore: scorerSide.score, other: otherSide.abbr, otherScore: otherSide.score },
        });
        return;
      }
      if (relevant(2) || (kind && relevant(1))) {
        const top = [...players].sort((a, b) => Number(b.is_mine) - Number(a.is_mine) || Math.abs(b.points) - Math.abs(a.points))[0];
        if (!top) return;
        const yards = play.yards_gained ? `${Math.abs(play.yards_gained)}-yd ${play.play_type === 'pass' ? 'catch' : play.play_type === 'rush' ? 'run' : 'play'}` : 'big play';
        toast({
          id: `play-${play.play_id}`,
          tier: 2,
          kind: 'play',
          at: now,
          title: `${lastName(top.player_name)}, ${kind === 'touchdown' ? 'touchdown' : kind === 'turnover' ? 'turnover' : yards}`,
          detail: top.is_mine ? `${fmtPts(top.points)} for you` : `${fmtPts(top.points)} for ${top.owner_name.split(' ')[0]}`,
          teamAbbr: top.team_name,
          myPoints: myPoints || undefined,
          impacts,
          good: top.is_mine ? top.points >= 0 : undefined,
          mine: !!myPoints,
        });
      }
    },
    [myOwnerId, ownerOfPlayer, showBig, toast],
  );

  /** With no game on the TV: your own player's big play from any game. */
  const onRosterPlay = useCallback(
    (id: string, playerName: string, touchdown: boolean, points: number, proTeam: string | null) => {
      toast({
        id: `roster-${id}`,
        tier: 2,
        kind: 'roster',
        at: Date.now(),
        title: `${lastName(playerName)}, ${touchdown ? 'touchdown' : 'big play'}`,
        detail: `${fmtPts(points)} for you`,
        teamAbbr: proTeam,
        myPoints: points,
        impacts: myOwnerId !== null ? { [String(myOwnerId)]: points } : undefined,
        good: points >= 0,
        mine: true,
      });
    },
    [myOwnerId, toast],
  );

  // How the big moment swung things, once the league's numbers catch up
  // (they arrive on the same delay as the TV, a poll or so after the play).
  useEffect(() => {
    const base = swingBase.current;
    if (!base) return;
    if (Date.now() - base.at > SWING_HOLD_MS) {
      swingBase.current = null;
      setSwing(null);
      return;
    }
    const moved: Swing['moved'] = [];
    let changed = sweat.winPct !== base.mine;
    for (const m of sweat.league) {
      const before = base.league.get(m.matchup_id);
      const after = m.home.win_probability;
      if (before === undefined || before < 0 || after === null) continue;
      const delta = after - before;
      if (Math.abs(delta) >= 0.5) changed = true;
      if (Math.abs(delta) < 3) continue;
      // Name the owner whose odds went up.
      const up = delta > 0 ? m.home : m.away;
      moved.push({ label: up.owner_name.split(' ')[0], delta: Math.abs(delta) });
    }
    if (!changed) return;
    setSwing({ before: base.mine, after: sweat.winPct, moved: moved.sort((a, b) => b.delta - a.delta).slice(0, 4), ready: true });
  }, [sweat.league, sweat.winPct]);
  useEffect(() => {
    if (!swing) return;
    const id = setTimeout(() => {
      swingBase.current = null;
      setSwing(null);
    }, SWING_HOLD_MS);
    return () => clearTimeout(id);
  }, [swing?.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // League moments: watch the (delayed) league data and your bets for
  // what changed. The first look only remembers what's already true, so
  // walking into a room doesn't replay the afternoon at you.
  const seen = useRef<{ chug: Set<string>; leaders: Map<number, string>; legs: Map<number, string> } | null>(null);
  useEffect(() => {
    if (sweat.league.length === 0) return;
    const first = seen.current === null;
    if (first) seen.current = { chug: new Set(), leaders: new Map(), legs: new Map() };
    const s = seen.current!;
    for (const m of sweat.league) {
      for (const side of [m.home, m.away]) {
        if (!chugEnabled) continue;
        for (const p of side.roster) {
          if (['BE', 'IR', 'TAXI'].includes(p.lineup_slot ?? '') || p.on_bye || p.game_status !== 'final' || (p.points_scored ?? 0) > 0) continue;
          const key = `${m.week}-${side.team_id}-${p.player_id}`;
          if (s.chug.has(key)) continue;
          s.chug.add(key);
          if (first) continue;
          const mine = myOwnerId !== null && side.owner_id === myOwnerId;
          showBig({
            id: `chug-${key}`,
            tier: 3,
            kind: 'chug',
            at: Date.now(),
            title: 'Chug alert',
            detail: `${mine ? 'Your' : `${side.owner_name.split(' ')[0]}'s`} starter ${p.player_name} finished at ${(p.points_scored ?? 0).toFixed(1)}. One chug owed.`,
            chugOwnerName: chugRuleName ?? 'The chug rule',
            chugIsMe: mine,
            impacts: { [String(side.owner_id)]: 0 },
          });
        }
      }
      if (m.is_rivalry && (m.home.score ?? 0) > 0 && (m.away.score ?? 0) > 0 && m.home.score !== m.away.score) {
        const leader = (m.home.score ?? 0) > (m.away.score ?? 0) ? m.home : m.away;
        const trailer = leader === m.home ? m.away : m.home;
        const prev = s.leaders.get(m.matchup_id);
        s.leaders.set(m.matchup_id, String(leader.team_id));
        if (prev !== undefined && prev !== String(leader.team_id)) {
          const me = myOwnerId !== null && leader.owner_id === myOwnerId;
          toast({
            id: `rivalry-${m.matchup_id}-${Date.now()}`,
            tier: 3,
            kind: 'rivalry',
            at: Date.now(),
            title: me ? `You took the lead on ${trailer.owner_name.split(' ')[0]}` : `${leader.owner_name.split(' ')[0]} took the lead on ${trailer.owner_name.split(' ')[0]}`,
            detail: `${m.rivalry?.name ?? 'Rivalry'} · ${(leader.score ?? 0).toFixed(1)}–${(trailer.score ?? 0).toFixed(1)}`,
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweat.league]);

  useEffect(() => {
    if (!seen.current) return;
    const s = seen.current;
    for (const bet of sweat.allBets) {
      for (const leg of bet.legs) {
        const prev = s.legs.get(leg.id);
        s.legs.set(leg.id, leg.status);
        if (prev === 'open' && (leg.status === 'won' || leg.status === 'lost')) {
          const left = bet.legs.filter((l) => l.status === 'open').length;
          toast({
            id: `bet-${leg.id}`,
            tier: 3,
            kind: 'bet',
            at: Date.now(),
            title: leg.status === 'won' ? `${leg.description} · hit` : `${leg.description} · missed`,
            detail: bet.legs.length > 1 ? (left > 0 ? `${left} leg${left === 1 ? '' : 's'} left` : 'Parlay settled') : 'Your bet',
            good: leg.status === 'won',
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweat.allBets]);

  // Everyone's starters in every game (lib/leagueMoments.ts): yours and
  // your opponent's anywhere, everyone else in the room's, and any play
  // that swings someone in the room's chance to win by BIG_SWING points.
  const leagueKey = sweat.league[0] ? `${sweat.league[0].season}-${sweat.league[0].week}` : null;
  const leagueMoments = useLeagueMoments(sweat.league, leagueKey);
  const handled = useRef(new Set<string>());
  useEffect(() => {
    const me = myOwnerId !== null ? String(myOwnerId) : null;
    for (const lm of leagueMoments) {
      if (handled.current.has(lm.id)) continue;
      handled.current.add(lm.id);
      const forMe = lm.ownerId === me;
      const againstMe = lm.againstId === me;
      const inRoom = room.current.has(lm.ownerId);
      if (!forMe && !againstMe && !inRoom) continue;
      const onTv = !!lm.proTeam && (tvTeams?.current ?? []).includes(lm.proTeam);
      const swing = lm.winBefore !== null && lm.winAfter !== null ? lm.winAfter - lm.winBefore : 0;
      const myView = forMe ? swing : againstMe ? -swing : 0;
      const what = lm.touchdown ? 'touchdown' : `${fmtPts(lm.points)}`;
      const first = (n: string) => n.split(' ')[0];
      // A big swing on the TV that wasn't a touchdown (those take over
      // already) gets its own takeover.
      if (onTv) {
        if (!lm.touchdown && Math.abs(swing) >= BIG_SWING) {
          // Each league moment is handled once (handled.current), so this
          // can't cascade.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          showBig({
            id: `swing-${lm.id}`,
            tier: 1,
            kind: 'swing',
            at: lm.at,
            title: 'Big swing',
            detail: `${lastName(lm.playerName)} ${fmtPts(lm.points)} · ${first(lm.ownerName)} ${Math.round(lm.winBefore ?? 0)}% → ${Math.round(lm.winAfter ?? 0)}%`,
            teamAbbr: lm.proTeam,
            myPoints: forMe ? lm.points : againstMe ? -lm.points : undefined,
            impacts: { [lm.ownerId]: lm.points },
            mine: forMe || againstMe,
          });
        }
        continue;
      }
      const odds = forMe || againstMe ? (Math.abs(myView) >= 3 ? ` · you ${Math.round((forMe ? lm.winBefore : 100 - (lm.winBefore ?? 0)) ?? 0)}% → ${Math.round((forMe ? lm.winAfter : 100 - (lm.winAfter ?? 0)) ?? 0)}%` : '') : '';
      toast({
        id: `else-${lm.id}`,
        tier: 2,
        kind: 'elsewhere',
        at: lm.at,
        title: forMe
          ? `${lastName(lm.playerName)}, ${what}`
          : againstMe
            ? `Ouch · ${lastName(lm.playerName)}, ${what}`
            : `${first(lm.ownerName)} · ${lastName(lm.playerName)}, ${what}`,
        detail: `Elsewhere${lm.proTeam ? ` · ${lm.proTeam}` : ''} · ${fmtPts(lm.points)} for ${forMe ? 'you' : first(lm.ownerName)}${odds}`,
        teamAbbr: lm.proTeam,
        myPoints: forMe ? lm.points : againstMe ? -lm.points : undefined,
        impacts: { [lm.ownerId]: lm.points },
        good: forMe ? true : againstMe ? false : undefined,
        mine: forMe || againstMe,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueMoments]);

  // Bets: yours cashing takes over the TV in gold; one leg left is a
  // nudge; a shared bet cashing anywhere in the league is a notification.
  const betSeen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const first = betSeen.current === null;
    if (first) betSeen.current = new Map();
    const s = betSeen.current!;
    const look = (key: string, state: string, fire: () => void) => {
      const prev = s.get(key);
      s.set(key, state);
      if (!first && prev !== undefined && prev !== state) fire();
    };
    for (const bet of sweat.allBets) {
      const open = bet.legs.filter((l) => l.status === 'open').length;
      const lost = bet.legs.some((l) => l.status === 'lost');
      const desc = bet.legs.length > 1 ? `${bet.legs.length}-leg parlay` : (bet.legs[0]?.description ?? 'Your bet');
      look(`mine-${bet.id}`, bet.status, () => {
        if (bet.status !== 'won') return;
        showBig({ id: `cash-${bet.id}`, tier: 1, kind: 'cash', at: Date.now(), title: 'Cashed', detail: `${desc}${bet.payout ? ` · ${bet.payout.toFixed(2)} back` : ''}`, mine: true });
      });
      look(`mine-leg-${bet.id}`, bet.legs.length > 1 && open === 1 && !lost ? 'one' : 'no', () => {
        if (!(bet.legs.length > 1 && open === 1 && !lost)) return;
        const left = bet.legs.find((l) => l.status === 'open');
        toast({ id: `one-${bet.id}`, tier: 3, kind: 'bet', at: Date.now(), title: 'One leg away', detail: left ? `Needs ${left.description}` : desc, good: true, mine: true });
      });
    }
    for (const bet of sweat.leagueOpenBets) {
      look(`league-${bet.id}`, bet.status, () => {
        if (bet.status !== 'won') return;
        toast({ id: `lcash-${bet.id}`, tier: 3, kind: 'bet', at: Date.now(), title: `${bet.member.name.split(' ')[0]} cashed`, detail: bet.legs.length > 1 ? `${bet.legs.length}-leg parlay` : (bet.legs[0]?.description ?? 'A bet'), good: true });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweat.allBets, sweat.leagueOpenBets]);

  // Who's in the red zone right now: yours, your opponent's, and anyone
  // in the room's.
  const me = myOwnerId !== null ? String(myOwnerId) : null;
  const inRoom = new Set(roomKey ? roomKey.split(',') : []);
  const redZone: RedZone[] = redZoneNow(sweat.league).filter(
    (r) => r.ownerId === me || inRoom.has(r.ownerId) || sweat.opponentStarters.some((p) => p.player_name === r.playerName),
  );

  // The TV's touchdown strip clears itself.
  useEffect(() => {
    if (!tvTd) return;
    const id = setTimeout(() => setTvTd(null), 6000);
    return () => clearTimeout(id);
  }, [tvTd]);

  const dismissBig = useCallback(() => setBig(bigQueue.current.shift() ?? null), []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Tiles light up with whatever the moment on screen did to them.
  const latestToast = toasts[toasts.length - 1];
  const tileImpacts = big?.impacts ?? latestToast?.impacts ?? {};
  const chugOwner = big?.kind === 'chug' ? Object.keys(big.impacts ?? {})[0] ?? null : null;

  return {
    big,
    toasts,
    history,
    swing,
    tileImpacts,
    chugOwner,
    onPlay,
    onRosterPlay,
    dismissBig,
    dismissToast,
    tvTd,
    redZone,
  };
}

/** Tier 1: across the bottom of the TV, the stream still playing above. */
export function MomentRibbon({ moment, accent, onDismiss }: { moment: RoomMoment; accent: string; onDismiss: () => void }) {
  const color = nflTeamColor(moment.teamAbbr) ?? '#e31837';
  return (
    <Pressable onPress={onDismiss} style={styles.ribbon} accessibilityRole="button" accessibilityLabel={`${moment.title}. ${moment.detail}. Dismiss`}>
      <View style={[styles.ribbonTop, { backgroundColor: color }]}>
        <Text style={styles.ribbonTitle} maxFontSizeMultiplier={1.1}>
          {moment.title.toUpperCase()}
        </Text>
        {moment.score && (
          <Text style={styles.ribbonScore} maxFontSizeMultiplier={1.1}>
            {moment.score.scorer} {moment.score.scorerScore ?? ''}
            <Text style={styles.ribbonScoreOther}>
              {'  '}
              {moment.score.other} {moment.score.otherScore ?? ''}
            </Text>
          </Text>
        )}
      </View>
      <View style={[styles.ribbonBottom, { backgroundColor: shade(color, 0.75) }]}>
        <Text style={styles.ribbonDetail} numberOfLines={1}>
          {moment.detail}
        </Text>
        {moment.myPoints !== undefined && (
          <Text style={[styles.ribbonChip, { backgroundColor: moment.myPoints >= 0 ? accent : '#f87171' }]} maxFontSizeMultiplier={1.1}>
            {fmtPts(moment.myPoints)} yours
          </Text>
        )}
      </View>
    </Pressable>
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
    <View style={styles.swing}>
      <View style={styles.swingRow}>
        <Text style={styles.swingLabel}>Your win chance</Text>
        <View style={styles.swingBar}>
          <View style={[styles.swingFill, { width: `${lo}%`, backgroundColor: `${accent}59` }]} />
          <View style={[styles.swingFill, { left: `${lo}%`, width: `${Math.max(0, hi - lo)}%`, backgroundColor: up ? accent : '#f87171' }]} />
        </View>
        <Text style={styles.swingValue}>
          {swing.ready && before !== null && after !== null && Math.round(before) !== Math.round(after) ? (
            <>
              <Text style={styles.swingMuted}>{Math.round(before)}→</Text>
              <Text style={{ color: up ? accent : '#f87171' }}>{Math.round(after)}%</Text>
            </>
          ) : after !== null ? (
            `${Math.round(after)}%`
          ) : (
            '—'
          )}
        </Text>
      </View>
      <View style={styles.swingChips}>
        {!swing.ready ? (
          <Text style={styles.swingMuted}>Updating the league…</Text>
        ) : swing.moved.length === 0 ? (
          <Text style={styles.swingMuted}>No other matchup moved much</Text>
        ) : (
          <>
            <Text style={styles.swingMuted}>
              {swing.moved.length} matchup{swing.moved.length === 1 ? '' : 's'} moved
            </Text>
            {swing.moved.map((m) => (
              <Text key={m.label} style={styles.swingChip}>
                {m.label} <Text style={{ color: accent }}>+{Math.round(m.delta)}%</Text>
              </Text>
            ))}
          </>
        )}
      </View>
    </View>
  );
}

/** Tier 3's big one: a starter finished at zero, under the chug rule. */
export function ChugAlertCard({ moment, onPileOn, onDismiss }: { moment: RoomMoment; onPileOn: () => void; onDismiss: () => void }) {
  return (
    <View style={styles.chug} accessibilityRole="alert">
      <View style={styles.chugHead}>
        <Text style={styles.chugRule}>{(moment.chugOwnerName ?? 'Chug rule').toUpperCase()}</Text>
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Text style={styles.chugClose}>✕</Text>
        </Pressable>
      </View>
      <Text style={styles.chugTitle}>CHUG ALERT</Text>
      <Text style={styles.chugBody}>{moment.detail}</Text>
      <View style={styles.chugButtons}>
        {moment.chugIsMe ? (
          <Pressable
            onPress={() => {
              onDismiss();
              router.push('/chug');
            }}
            style={[styles.chugBtn, styles.chugBtnDark]}
            accessibilityRole="button">
            <Text style={styles.chugBtnDarkText}>Film it now</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onPileOn} style={[styles.chugBtn, styles.chugBtnDark]} accessibilityRole="button">
            <Text style={styles.chugBtnDarkText}>Pile on</Text>
          </Pressable>
        )}
        <Pressable onPress={onDismiss} style={[styles.chugBtn, styles.chugBtnLight]} accessibilityRole="button">
          <Text style={styles.chugBtnLightText}>Later</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Tier 2 and the small Tier 3s: stacked notifications, newest in front. */
export function MomentToasts({ toasts, accent, onDismiss }: { toasts: RoomMoment[]; accent: string; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  const shown = toasts.slice(-MAX_TOASTS);
  const front = shown[shown.length - 1];
  const behind = shown.length - 1;
  const color = front.kind === 'bet' ? '#93c5fd' : front.kind === 'rivalry' ? '#c4b5fd' : (nflTeamColor(front.teamAbbr) ?? '#3a4558');
  return (
    <View style={styles.toastWrap} pointerEvents="box-none">
      {behind >= 2 && <View style={[styles.toastShadow, styles.toastShadow2]} />}
      {behind >= 1 && <View style={[styles.toastShadow, styles.toastShadow1]} />}
      <Pressable onPress={() => onDismiss(front.id)} style={styles.toast} accessibilityRole="button" accessibilityLabel={`${front.title}. ${front.detail}. Dismiss`}>
        <View style={[styles.toastIcon, { backgroundColor: front.kind === 'bet' || front.kind === 'rivalry' ? `${color}33` : color }]}>
          <Text style={[styles.toastIconText, (front.kind === 'bet' || front.kind === 'rivalry') && { color }]}>
            {front.kind === 'bet' ? 'BET' : front.kind === 'rivalry' ? 'VS' : (front.teamAbbr ?? '').slice(0, 3)}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.toastTitle} numberOfLines={1}>
            {front.title}
          </Text>
          <Text
            style={[styles.toastDetail, front.good === true && { color: accent }, front.good === false && { color: '#f87171' }]}
            numberOfLines={1}>
            {front.detail}
          </Text>
        </View>
        {toasts.length > MAX_TOASTS && <Text style={styles.toastMore}>+{toasts.length - MAX_TOASTS}</Text>}
      </Pressable>
    </View>
  );
}

/** Every moment this visit, newest first. */
/** The room's latest fantasy moment, one slim line above the chat
 *  (2026-10-29: every play used to land in the chat itself). Tap for the
 *  full list. Nothing until something happens. */
export function MomentStrip({ latest, count, accent, onOpen }: { latest: RoomMoment | null; count: number; accent: string; onOpen: () => void }) {
  if (!latest) return null;
  const color = latest.kind === 'turnover' ? '#ff8a2a' : latest.kind === 'chug' ? '#facc15' : latest.myPoints !== undefined && latest.myPoints < 0 ? '#ff5c77' : accent;
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onOpen();
      }}
      style={({ pressed }) => [styles.strip, { borderColor: `${color}66`, shadowColor: color }, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={`Latest moment: ${latest.title}, ${latest.detail}. ${count} in all. Open moments`}>
      <View style={[styles.stripDot, { backgroundColor: color, shadowColor: color }]} />
      <Text style={styles.stripTitle} numberOfLines={1} maxFontSizeMultiplier={1.15}>
        {latest.title}
        <Text style={styles.stripDetail}> · {latest.detail}</Text>
      </Text>
      {latest.myPoints !== undefined && (
        <Text style={[styles.stripPts, { color }]} maxFontSizeMultiplier={1.1}>
          {fmtPts(latest.myPoints)}
        </Text>
      )}
      {count > 1 && (
        <Text style={styles.stripMore} maxFontSizeMultiplier={1.1}>
          +{count - 1}
        </Text>
      )}
      <Text style={styles.stripChev}>›</Text>
    </Pressable>
  );
}

/** A touchdown on the TV nobody in the room has a stake in: a slim
 *  broadcast strip across the bottom of the picture. */
export function TvTouchdownStrip({ td }: { td: TvTouchdown }) {
  const color = nflTeamColor(td.team) ?? '#2b2d31';
  return (
    <View style={styles.tvTd} pointerEvents="none" accessibilityLiveRegion="polite" accessibilityLabel={`Touchdown ${td.team}. ${td.text}. ${td.score}`}>
      <View style={[styles.tvTdTag, { backgroundColor: color }]}>
        <Text style={styles.tvTdTagText} maxFontSizeMultiplier={1}>
          TD {td.team}
        </Text>
      </View>
      <Text style={styles.tvTdText} numberOfLines={1} maxFontSizeMultiplier={1}>
        {td.text}
      </Text>
      <Text style={styles.tvTdScore} maxFontSizeMultiplier={1}>
        {td.score}
      </Text>
    </View>
  );
}

/** Who's inside the 20 in another game, pulsing by the score bug. */
export function RedZoneChip({ zones }: { zones: RedZone[] }) {
  if (zones.length === 0) return null;
  const z = zones[0];
  return (
    <View style={styles.rz} pointerEvents="none" accessibilityLabel={`Red zone: ${z.playerName}${zones.length > 1 ? ` and ${zones.length - 1} more` : ''}`}>
      <View style={styles.rzDot} />
      <Text style={styles.rzText} numberOfLines={1} maxFontSizeMultiplier={1}>
        RED ZONE · {lastName(z.playerName)}
        {z.proTeam ? ` (${z.proTeam})` : ''}
        {zones.length > 1 ? ` +${zones.length - 1}` : ''}
      </Text>
    </View>
  );
}

const MODES: { mode: MomentsMode; label: string }[] = [
  { mode: 'all', label: 'All' },
  { mode: 'mine', label: 'Mine only' },
  { mode: 'big', label: 'Big only' },
];

/** All / Mine only / Big only, for you alone. */
export function MomentsModePicker({ mode, onChange, accent }: { mode: MomentsMode; onChange: (m: MomentsMode) => void; accent: string }) {
  return (
    <View style={styles.modes} accessibilityRole="radiogroup">
      {MODES.map((m) => (
        <Pressable
          key={m.mode}
          onPress={() => {
            haptics.select();
            onChange(m.mode);
          }}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === m.mode }}
          style={[styles.mode, mode === m.mode && { backgroundColor: `${accent}26`, borderColor: accent }]}>
          <Text style={[styles.modeText, mode === m.mode && { color: accent }]}>{m.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function MomentsSheet({
  visible,
  onClose,
  history,
  accent,
  mode,
  onMode,
}: {
  visible: boolean;
  onClose: () => void;
  history: RoomMoment[];
  accent: string;
  mode?: MomentsMode;
  onMode?: (m: MomentsMode) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>MOMENTS</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Text style={styles.sheetDone}>Done</Text>
            </Pressable>
          </View>
          {mode && onMode && <MomentsModePicker mode={mode} onChange={onMode} accent={accent} />}
          <ScrollView contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
            {history.length === 0 && <Text style={styles.swingMuted}>Big plays, fantasy swings and league moments show up here as they happen.</Text>}
            {history.map((m) => (
              <View key={m.id} style={styles.historyRow}>
                <Text style={[styles.historyTier, { color: m.tier === 1 ? accent : m.kind === 'chug' ? '#facc15' : '#9aa3b2' }]}>
                  {m.kind === 'chug' ? 'CHUG' : m.kind === 'bet' ? 'BET' : m.kind === 'rivalry' ? 'RIVAL' : m.kind === 'elsewhere' ? 'ELSEWHERE' : m.tier === 1 ? m.title.toUpperCase() : 'PLAY'}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.toastTitle} numberOfLines={1}>
                    {m.tier === 1 ? m.detail : m.title}
                  </Text>
                  <Text style={styles.toastDetail} numberOfLines={1}>
                    {m.tier === 1 ? (m.myPoints !== undefined ? `${fmtPts(m.myPoints)} for you` : (m.teamAbbr ?? '')) : m.detail}
                  </Text>
                </View>
                <Text style={styles.historyTime}>{new Date(m.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tvTd: { position: 'absolute', left: 10, right: 10, bottom: 0, height: 34, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 10, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(8,10,16,0.92)', zIndex: 15 },
  tvTdTag: { alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: 10 },
  tvTdTagText: { color: '#fff', fontFamily: 'Anton_400Regular', fontSize: 15, letterSpacing: 1 },
  tvTdText: { flex: 1, color: '#f2f5fa', fontFamily: Fonts.displayBold, fontSize: 12 },
  tvTdScore: { color: '#fff', fontFamily: Fonts.monoBold, fontSize: 12 },
  rz: { position: 'absolute', right: 52, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: 'rgba(120,10,24,0.88)', borderWidth: 1, borderColor: '#ff3b5c', zIndex: 14 },
  rzDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ff3b5c' },
  rzText: { color: '#fff', fontFamily: Fonts.monoBold, fontSize: 10, letterSpacing: 0.5 },
  modes: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  mode: { flex: 1, minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: '#2a313b', alignItems: 'center', justifyContent: 'center' },
  modeText: { color: '#c9d2e0', fontSize: 13, fontWeight: '600' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10, marginTop: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: 18, borderWidth: 1, backgroundColor: 'rgba(12,15,22,0.92)', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  stripDot: { width: 7, height: 7, borderRadius: 4, shadowOpacity: 1, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  stripTitle: { flex: 1, color: '#f2f5fa', fontFamily: Fonts.displayBold, fontSize: 14, letterSpacing: 0.3 },
  stripDetail: { color: '#9aa3b2', fontFamily: Fonts.body, fontSize: 13, letterSpacing: 0 },
  stripPts: { fontFamily: Fonts.monoBold, fontSize: 14 },
  stripMore: { color: '#9aa3b2', fontFamily: Fonts.mono, fontSize: 12 },
  stripChev: { color: '#9aa3b2', fontSize: 18, marginTop: -2 },
  ribbon: { position: 'absolute', left: 10, right: 10, bottom: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, overflow: 'hidden' },
  ribbonTop: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 6 },
  ribbonTitle: { color: '#fff', fontFamily: Fonts.displayBold, fontSize: 24, letterSpacing: 1, fontStyle: 'italic' },
  ribbonScore: { marginLeft: 'auto', color: '#fff', fontFamily: Fonts.monoBold, fontSize: 14 },
  ribbonScoreOther: { color: 'rgba(255,255,255,0.75)', fontFamily: Fonts.mono },
  ribbonBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  ribbonDetail: { flex: 1, color: '#fff', fontSize: 12.5 },
  ribbonChip: { color: '#05060a', fontFamily: Fonts.monoBold, fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  swing: { marginHorizontal: 10, marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: '#10131b', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 7 },
  swingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swingLabel: { color: '#9aa3b2', fontSize: 12 },
  swingBar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#2b2f3a', overflow: 'hidden' },
  swingFill: { position: 'absolute', top: 0, bottom: 0 },
  swingValue: { color: '#f3f4f6', fontFamily: Fonts.monoBold, fontSize: 13 },
  swingMuted: { color: '#9aa3b2', fontSize: 11.5 },
  swingChips: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  swingChip: { color: '#f3f4f6', fontSize: 11.5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#1f2533', overflow: 'hidden' },
  chug: { marginHorizontal: 10, marginTop: 8, padding: 14, borderRadius: 16, backgroundColor: '#facc15', gap: 6 },
  chugHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chugRule: { color: '#120f02', fontFamily: Fonts.displayBold, fontSize: 11, letterSpacing: 1 },
  chugClose: { color: '#120f02', fontSize: 16, fontWeight: '800' },
  chugTitle: { color: '#120f02', fontFamily: Fonts.displayBold, fontSize: 38, lineHeight: 40, fontStyle: 'italic' },
  chugBody: { color: '#120f02', fontSize: 14, lineHeight: 19 },
  chugButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },
  chugBtn: { flex: 1, minHeight: 42, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  chugBtnDark: { backgroundColor: '#120f02' },
  chugBtnDarkText: { color: '#facc15', fontSize: 14, fontWeight: '800' },
  chugBtnLight: { backgroundColor: 'rgba(18,15,2,0.12)' },
  chugBtnLightText: { color: '#120f02', fontSize: 14, fontWeight: '700' },
  toastWrap: { position: 'absolute', left: 12, right: 12, bottom: 0 },
  toastShadow: { position: 'absolute', height: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: 'rgba(32,38,50,0.7)' },
  toastShadow1: { left: 10, right: 10, top: -8 },
  toastShadow2: { left: 22, right: 22, top: -15, backgroundColor: 'rgba(32,38,50,0.45)' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 16, backgroundColor: 'rgba(32,38,50,0.97)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  toastIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toastIconText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  toastTitle: { color: '#f3f4f6', fontSize: 14, fontWeight: '700' },
  toastDetail: { color: '#9aa3b2', fontSize: 12.5 },
  toastMore: { color: '#9aa3b2', fontFamily: Fonts.mono, fontSize: 12 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { maxHeight: '75%', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#0f121a', paddingTop: 12 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10 },
  sheetTitle: { color: '#f3f4f6', fontFamily: Fonts.displayBold, fontSize: 18, letterSpacing: 0.5 },
  sheetDone: { color: '#9aa3b2', fontSize: 14 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: '#161a24' },
  historyTier: { width: 76, fontFamily: Fonts.displayBold, fontSize: 11, letterSpacing: 0.8 },
  historyTime: { color: '#9aa3b2', fontFamily: Fonts.mono, fontSize: 11 },
});
