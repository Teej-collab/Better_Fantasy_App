import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Chip, Kicker, Panel, Row } from '@/components/living/LivingCards';
import { Display, Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { fmt, isStarter } from '@/lib/livingHome';
import type { MatchupContextSide, NflGame, RosterPlayer, WatchPartyRoom, WeekMatchupContextItem, WinProbHistory } from '@/lib/types';

const UP = '#39ff14';
const DOWN = '#ff8a3d';

const left = (p: RosterPlayer) => Math.max(0, (p.live_projected ?? p.points_projected ?? 0) - (p.points_scored ?? 0));
const stillToPlay = (side: MatchupContextSide) => side.roster.filter((p) => isStarter(p.lineup_slot) && p.game_status !== 'final');

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

// Touchdowns on both sides this week.
export function TouchdownFeedCard({ me, them }: { me: MatchupContextSide; them: MatchupContextSide }) {
  const rows = [
    ...me.touchdowns.map((t) => ({ ...t, mine: true })),
    ...them.touchdowns.map((t) => ({ ...t, mine: false })),
  ].filter((t) => t.touchdowns > 0);
  if (rows.length === 0) return null;
  return (
    <Panel>
      <Kicker>Touchdowns this week</Kicker>
      {rows.map((t, i) => (
        <Row
          key={`${t.mine}-${t.player_name}`}
          first={i === 0}
          left={
            <Text style={styles.rowText}>
              {t.player_name} <Text style={styles.small}>{t.mine ? 'yours' : `${them.owner_name}'s`}</Text>
            </Text>
          }
          right={<Chip color={t.mine ? UP : DOWN}>{t.touchdowns > 1 ? `${t.touchdowns} TDs` : 'TD'}</Chip>}
        />
      ))}
    </Panel>
  );
}

// The player carrying you and the one hurting you most.
export function SwingPlayersCard({ me, them }: { me: MatchupContextSide; them: MatchupContextSide }) {
  const top = (side: MatchupContextSide) =>
    side.roster.filter((p) => isStarter(p.lineup_slot) && (p.points_scored ?? 0) > 0).sort((a, b) => (b.points_scored ?? 0) - (a.points_scored ?? 0))[0];
  const carry = top(me);
  const hurt = top(them);
  if (!carry && !hurt) return null;
  return (
    <View style={styles.tiles}>
      {carry && (
        <Panel outerStyle={styles.tileOuter}>
          <Kicker color={UP}>Carrying you</Kicker>
          <Text style={styles.tileName} numberOfLines={1}>
            {carry.player_name}
          </Text>
          <Display style={styles.tileNum}>{fmt(carry.points_scored)}</Display>
        </Panel>
      )}
      {hurt && (
        <Panel outerStyle={styles.tileOuter}>
          <Kicker color={DOWN}>Hurting you</Kicker>
          <Text style={styles.tileName} numberOfLines={1}>
            {hurt.player_name}
          </Text>
          <Display style={styles.tileNum}>{fmt(hurt.points_scored)}</Display>
        </Panel>
      )}
    </View>
  );
}

// How many players each side has in each kickoff window.
export function GameWindowsCard({ me, them, now }: { me: MatchupContextSide; them: MatchupContextSide; now: Date }) {
  const windows = new Map<string, { at: number; label: string; mine: number; theirs: number; done: boolean; live: boolean }>();
  const add = (p: RosterPlayer, mine: boolean) => {
    if (!isStarter(p.lineup_slot) || !p.game_time) return;
    const t = new Date(p.game_time);
    const key = t.toISOString().slice(0, 13);
    const w = windows.get(key) ?? {
      at: t.getTime(),
      label: when(p.game_time),
      mine: 0,
      theirs: 0,
      done: true,
      live: false,
    };
    if (mine) w.mine += 1;
    else w.theirs += 1;
    if (p.game_status !== 'final') w.done = false;
    if (p.game_status === 'in_progress') w.live = true;
    windows.set(key, w);
  };
  me.roster.forEach((p) => add(p, true));
  them.roster.forEach((p) => add(p, false));
  const rows = [...windows.values()].filter((w) => !w.done || w.at > now.getTime() - 12 * 3600_000).sort((a, b) => a.at - b.at);
  if (rows.length < 2) return null;
  return (
    <Panel>
      <Kicker>Game windows</Kicker>
      {rows.map((w, i) => (
        <Row
          key={w.at}
          first={i === 0}
          left={
            <Text style={[styles.rowText, w.done && styles.done]}>
              {w.label}
              {w.live ? <Text style={styles.live}>  · live</Text> : null}
            </Text>
          }
          right={`You ${w.mine} · Them ${w.theirs}`}
        />
      ))}
    </Panel>
  );
}

// The Monday math: how much your remaining players need to outscore theirs.
export function WhatYouNeedCard({ me, them, winProbability }: { me: MatchupContextSide; them: MatchupContextSide; winProbability: number | null }) {
  const margin = (me.score ?? 0) - (them.score ?? 0);
  const mine = stillToPlay(me);
  const theirs = stillToPlay(them);
  const myLeft = mine.reduce((s, p) => s + left(p), 0);
  const theirLeft = theirs.reduce((s, p) => s + left(p), 0);
  const need = theirLeft - margin;
  const color = margin >= 0 ? UP : DOWN;
  return (
    <Panel tint={color}>
      <Kicker color={color}>
        {margin >= 0 ? `You're up ${margin.toFixed(1)}` : `You're down ${Math.abs(margin).toFixed(1)}`} · {mine.length} left vs {theirs.length}
      </Kicker>
      {mine.length === 0 ? (
        <Text style={styles.body}>{theirs.length === 0 ? 'Everyone has played.' : `You're done. They need ${(-margin).toFixed(1)} to ${margin > 0 ? 'catch you' : 'stay ahead'}.`}</Text>
      ) : (
        <>
          <Text style={styles.body}>{mine.length === 1 ? 'Your last player needs' : `Your ${mine.length} players need`}</Text>
          <Display style={[styles.huge, { color }]}>{need <= 0 ? 'Nothing' : `${need.toFixed(1)}+`}</Display>
          <Text style={styles.body}>
            {need <= 0
              ? `You're ahead even if everyone hits projection — they need ${(margin + myLeft - theirLeft).toFixed(1)} more than projected to catch you.`
              : `to beat ${theirs.length === 0 ? 'their final' : "their players' projection"} (projected to add ${myLeft.toFixed(1)})`}
          </Text>
        </>
      )}
      {[...mine.map((p) => ({ p, mine: true })), ...theirs.map((p) => ({ p, mine: false }))].map(({ p, mine: isMine }, i) => (
        <Row
          key={`${isMine}-${p.player_name}`}
          first={i === 0}
          left={
            <View style={styles.gap2}>
              <Text style={styles.rowText}>
                {p.player_name} <Text style={styles.small}>{isMine ? 'yours' : 'theirs'}</Text>
              </Text>
              <Text style={styles.small}>
                {p.game_status === 'in_progress' ? `Playing · ${fmt(p.points_scored)} so far` : when(p.game_time)}
              </Text>
            </View>
          }
          right={<Text style={[styles.right, { color: isMine ? UP : DOWN }]}>proj +{left(p).toFixed(1)}</Text>}
        />
      ))}
      {winProbability != null && <Chip color={color}>{Math.round(winProbability)}% to win</Chip>}
    </Panel>
  );
}

// How the odds moved this week and what moved them.
export function TurningPointsCard({ history, meIsHome, opponent }: { history: WinProbHistory; meIsHome: boolean; opponent: string }) {
  // Tap a bar, or drag across the chart, to read the odds at that moment.
  const [picked, setPicked] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const pts = history.points;
  if (pts.length < 2) return null;
  const mine = (pct: number) => (meIsHome ? pct : 100 - pct);
  const first = mine(pts[0].home_win_pct);
  const last = mine(pts[pts.length - 1].home_win_pct);
  const step = Math.max(1, Math.floor(pts.length / 40));
  const bars = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const barAt = (x: number) => {
    const inner = chartWidth - 8;
    return inner > 0 ? Math.min(bars.length - 1, Math.max(0, Math.floor(((x - 4) / inner) * bars.length))) : null;
  };
  const scrub = (x: number) => {
    const i = barAt(x);
    if (i === null || i === picked) return;
    haptics.select();
    setPicked(i);
  };
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      const i = barAt(e.x);
      if (i === null) return;
      haptics.select();
      setPicked(i === picked ? null : i);
    });
  // Sideways only, so a vertical drag still scrolls the page.
  const drag = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-8, 8])
    .failOffsetY([-10, 10])
    .onStart((e) => scrub(e.x))
    .onUpdate((e) => scrub(e.x));
  const at = picked !== null ? bars[picked] : null;
  return (
    <Panel>
      <Kicker>Win % this week</Kicker>
      <View style={styles.bigRow}>
        <Display style={styles.big}>{Math.round(last)}%</Display>
        <Chip color={last >= first ? UP : DOWN}>
          {last >= first ? '+' : '−'}
          {Math.abs(last - first).toFixed(0)} since kickoff
        </Chip>
      </View>
      <GestureDetector gesture={Gesture.Race(drag, tap)}>
        <View
          style={styles.chart}
          onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
          accessibilityLabel={`Win chance went from ${Math.round(first)} to ${Math.round(last)} percent`}>
          <View style={styles.midline} />
          {bars.map((p, i) => {
            const v = mine(p.home_win_pct);
            return (
              <View
                key={p.at}
                style={[
                  styles.chartBar,
                  { height: `${Math.max(3, v)}%`, backgroundColor: v >= 50 ? UP : DOWN },
                  picked !== null && (i === picked ? styles.chartBarPicked : styles.chartBarDim),
                ]}
              />
            );
          })}
        </View>
      </GestureDetector>
      {at ? (
        <View style={styles.readout}>
          <Text style={[styles.readoutPct, { color: mine(at.home_win_pct) >= 50 ? UP : DOWN }]}>{Math.round(mine(at.home_win_pct))}%</Text>
          <Text style={styles.small}>
            {when(at.at)} · You {(meIsHome ? at.home_score : at.away_score).toFixed(1)} – {(meIsHome ? at.away_score : at.home_score).toFixed(1)} {opponent}
          </Text>
        </View>
      ) : (
        <Text style={[styles.small, styles.readout]}>Tap or drag across the bars to see your odds at any point</Text>
      )}
      {history.turning_points.map((t, i) => {
        const forMe = (t.side === 'home') === meIsHome;
        const change = meIsHome ? t.home_win_pct_change : -t.home_win_pct_change;
        return (
          <Row
            key={t.at}
            first={i === 0}
            left={
              <View style={styles.gap2}>
                <Text style={styles.rowText}>
                  {t.player_name ? `${t.player_name} +${t.points.toFixed(1)}` : forMe ? 'Your players scored' : `${opponent} scored`}
                </Text>
                <Text style={styles.small}>{when(t.at)}</Text>
              </View>
            }
            right={<Chip color={change >= 0 ? UP : DOWN}>{`${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(0)}%`}</Chip>}
          />
        );
      })}
    </Panel>
  );
}

// Every matchup around the league still undecided.
export function MatchupsAliveCard({ matchups, teamId }: { matchups: WeekMatchupContextItem[]; teamId: number }) {
  const alive = matchups.filter(
    (m) => m.home.team_id !== teamId && m.away.team_id !== teamId && (stillToPlay(m.home).length > 0 || stillToPlay(m.away).length > 0),
  );
  if (alive.length === 0) return null;
  return (
    <Panel>
      <Kicker>Still alive around the league</Kicker>
      {alive.map((m, i) => {
        const diff = (m.home.score ?? 0) - (m.away.score ?? 0);
        const leader = diff >= 0 ? m.home : m.away;
        return (
          <Row
            key={m.matchup_id}
            first={i === 0}
            left={
              <Text style={styles.rowText} numberOfLines={1}>
                {m.home.owner_name} vs {m.away.owner_name}
              </Text>
            }
            right={`${leader.owner_name} +${Math.abs(diff).toFixed(1)} · ${stillToPlay(m.home).length}v${stillToPlay(m.away).length} left`}
          />
        );
      })}
    </Panel>
  );
}

// Tonight's NFL game(s): kickoff, channel, Gamecast.
export function TonightGamesCard({
  games,
  title,
  findGamecastId,
}: {
  games: NflGame[];
  title: string;
  findGamecastId: (home: string | null, away: string | null) => string | null;
}) {
  if (games.length === 0) return null;
  return (
    <Panel>
      <Kicker>{title}</Kicker>
      {games.map((g, i) => {
        const id = findGamecastId(g.home_team, g.away_team);
        return (
          <Row
            key={g.id}
            first={i === 0}
            left={
              <View style={styles.gap2}>
                <Text style={styles.rowText}>
                  {g.away_team} @ {g.home_team}
                  {g.state === 'in' ? <Text style={styles.live}>  · {g.status_detail}</Text> : null}
                </Text>
                <Text style={styles.small}>
                  {g.state === 'in' ? `${g.away_score}–${g.home_score}` : g.date ? when(g.date) : g.status_detail}
                  {g.broadcast ? ` · ${g.broadcast}` : ''}
                </Text>
              </View>
            }
            right={
              id ? (
                <Text style={styles.link} onPress={() => router.push({ pathname: '/gamecast/[id]', params: { id } })}>
                  Gamecast →
                </Text>
              ) : (
                ''
              )
            }
          />
        );
      })}
    </Panel>
  );
}

// Watch parties people are in right now.
export function WatchPartiesCard({ rooms }: { rooms: WatchPartyRoom[] }) {
  const live = rooms.filter((r) => r.is_live && r.member_count > 0);
  if (live.length === 0) return null;
  return (
    <Panel tint="#a78bfa" style={styles.lounge}>
      <Kicker color="#c4b5fd">Watch parties on now</Kicker>
      {live.map((r, i) => (
        <Row
          key={r.id}
          first={i === 0}
          left={r.name}
          right={
            <Text style={[styles.link, { color: '#c4b5fd' }]} onPress={() => router.push({ pathname: '/watch-party/[id]', params: { id: String(r.id) } })}>
              {r.member_count} watching · Join
            </Text>
          }
        />
      ))}
    </Panel>
  );
}

const styles = StyleSheet.create({
  rowText: { color: Colors.text, fontSize: 14 },
  small: { color: Colors.textSecondary, fontSize: 12 },
  body: { color: Colors.text, fontSize: 14 },
  right: { fontSize: 13, fontWeight: '700' },
  gap2: { gap: 2, flexShrink: 1 },
  done: { color: Colors.textSecondary },
  live: { color: Colors.live, fontSize: 12, fontWeight: '700' },
  link: { color: Colors.accent, fontSize: 13, fontWeight: '700' },
  tiles: { flexDirection: 'row', gap: 10 },
  tileOuter: { flex: 1, minWidth: 0 },
  tileName: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  tileNum: { fontSize: 28, color: Colors.text },
  huge: { fontSize: 56, lineHeight: 62 },
  bigRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  big: { fontSize: 40, lineHeight: 46, color: Colors.text },
  chart: { height: 64, flexDirection: 'row', alignItems: 'flex-end', gap: 1, backgroundColor: Colors.tile, borderRadius: 8, padding: 4 },
  midline: { position: 'absolute', left: 4, right: 4, top: '50%', height: StyleSheet.hairlineWidth, backgroundColor: Colors.textSecondary },
  chartBar: { flex: 1, borderRadius: 1, opacity: 0.85 },
  chartBarPicked: { opacity: 1, borderWidth: 1, borderColor: '#ffffff' },
  chartBarDim: { opacity: 0.35 },
  readout: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, minHeight: 22 },
  readoutPct: { fontSize: 17, fontWeight: '700' },
  lounge: { backgroundColor: '#1d1630' },
});
