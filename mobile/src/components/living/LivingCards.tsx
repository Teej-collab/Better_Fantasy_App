import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { OutcomeChip } from '@/components/players/OutcomeChip';
import { Display, Text } from '@/components/Text';
import { NeonPanel } from '@/components/NeonPanel';
import { Colors, Radius, SectionColors, Spacing, withAlpha } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { fmt, isStarter, nextEt, untilText } from '@/lib/livingHome';
import type { MatchupContextSide, RosterEntry, RosterPlayer, WaiverClaim, WaiverClaimsResponse } from '@/lib/types';
import { useScreenFocused } from '@/lib/screenFocus';
import { pendingClaims } from '@/lib/waiverClaims';

// Re-renders every `ms` so countdowns tick, while its screen is on
// view; catches up the moment you come back.
export function useNow(ms = 30_000): Date {
  const focused = useScreenFocused();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!focused) return;
    const tick = () => setNow(new Date());
    const catchUp = setTimeout(tick, 0);
    const id = setInterval(tick, ms);
    return () => {
      clearTimeout(catchUp);
      clearInterval(id);
    };
  }, [ms, focused]);
  return now;
}

// Every living-home card sits in the classic home's NeonPanel: the same
// dark card with a segment of color sweeping around its border. `tint`
// sets the ring's color (the day's color, a warning); without it the
// ring is the owner's own ring color, like the classic cards. `style`
// styles the card's inside.
export function Panel({
  children,
  tint,
  style,
  outerStyle,
  onPress,
  label,
}: {
  children: ReactNode;
  tint?: string;
  style?: StyleProp<ViewStyle>;
  outerStyle?: StyleProp<ViewStyle>;
  onPress?: () => void;
  label?: string;
}) {
  const card = (
    <NeonPanel ring={tint} color={SectionColors.home} contentStyle={[styles.panel, style]} style={onPress ? undefined : outerStyle}>
      {children}
    </NeonPanel>
  );
  if (!onPress) return card;
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [outerStyle, pressed && styles.pressed]}>
      {card}
    </Pressable>
  );
}

export function Kicker({ children, color }: { children: ReactNode; color?: string }) {
  return <Text style={[styles.kicker, color ? { color } : null]}>{children}</Text>;
}

export function LinkText({ children, color, onPress }: { children: ReactNode; color: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="link"
      style={styles.link}>
      <Text style={[styles.linkText, { color }]}>{children}</Text>
    </Pressable>
  );
}

export function Row({ left, right, first }: { left: ReactNode; right: ReactNode; first?: boolean }) {
  return (
    <View style={[styles.row, !first && styles.rowDivided]}>
      <View style={styles.rowLeft}>{typeof left === 'string' ? <Text style={styles.rowText}>{left}</Text> : left}</View>
      {typeof right === 'string' ? <Text style={styles.rowRight}>{right}</Text> : right}
    </View>
  );
}

// Big "113.7 to 98.1" score line.
export function ScoreLine({
  mine,
  theirs,
  color,
  mineLabel,
  theirLabel,
  middle,
}: {
  mine: number | null;
  theirs: number | null;
  color: string;
  mineLabel?: string;
  theirLabel?: string;
  middle?: ReactNode;
}) {
  return (
    <View style={styles.scoreLine}>
      <View style={styles.scoreSide}>
        <Display style={[styles.bigScore, { color }]}>{fmt(mine)}</Display>
        {mineLabel && (
          <Text style={styles.scoreLabel} numberOfLines={1}>
            {mineLabel}
          </Text>
        )}
      </View>
      {middle ?? <Text style={styles.scoreTo}>to</Text>}
      <View style={[styles.scoreSide, styles.scoreSideRight]}>
        <Display style={styles.bigScore}>{fmt(theirs)}</Display>
        {theirLabel && (
          <Text style={[styles.scoreLabel, styles.right]} numberOfLines={1}>
            {theirLabel}
          </Text>
        )}
      </View>
    </View>
  );
}

export function Chip({ children, color }: { children: ReactNode; color: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: withAlpha(color, 0.16) }]}>
      <Text style={[styles.chipText, { color }]}>{children}</Text>
    </View>
  );
}

export function WinBar({ percent, color }: { percent: number; color: string }) {
  return (
    <View style={styles.bar} accessibilityLabel={`${Math.round(percent)} percent to win`}>
      <View style={[styles.barFill, { width: `${Math.max(2, Math.min(100, percent))}%`, backgroundColor: color }]} />
    </View>
  );
}

// "How the week ended": your MVP, your bench, the league's closest game.
export function WeekEndedCard({
  me,
  closest,
}: {
  me: MatchupContextSide | null;
  closest: { label: string; margin: number } | null;
}) {
  const mvp = (me?.roster ?? [])
    .filter((p) => isStarter(p.lineup_slot) && p.points_scored != null)
    .sort((a, b) => (b.points_scored ?? 0) - (a.points_scored ?? 0))[0];
  const crime = me?.bench_crime;
  return (
    <Panel>
      <Kicker>How the week ended</Kicker>
      {mvp && <Row first left="Your MVP" right={`${mvp.player_name} · ${fmt(mvp.points_scored)}`} />}
      <Row
        first={!mvp}
        left="Your bench"
        right={crime ? `${crime.bench_player} +${crime.points_diff.toFixed(1)} over ${crime.started_player}` : 'No bench crimes'}
      />
      {closest && <Row left="Closest finish" right={`${closest.label} by ${closest.margin.toFixed(1)}`} />}
    </Panel>
  );
}

// Waivers clear Wednesday 3:00 AM ET: the countdown, your spot, your claims.
export function WaiversCountdownCard({ claims, now, color }: { claims: WaiverClaimsResponse | null; now: Date; color: string }) {
  const clear = nextEt(3, 3, now);
  const pending = pendingClaims(claims?.claims ?? []);
  const priority = claims?.priority;
  return (
    <Panel tint={color} onPress={() => router.push('/waivers')} label="Your waiver claims">
      <Kicker color={color}>Waivers clear in</Kicker>
      <Display style={styles.countdown}>{untilText(clear, now)}</Display>
      <Text style={styles.muted}>
        Wed 3:00 AM ET{priority ? ` · you're #${priority.rank} of ${priority.of} in the order` : ''}
      </Text>
      <Text style={[styles.linkText, { color }]}>
        {pending.length === 0 ? 'No claims yet · Find players →' : `${pending.length} claim${pending.length === 1 ? '' : 's'} in line · Rank them →`}
      </Text>
    </Panel>
  );
}

// What the last waiver run did for you.
export function ClaimResultsCard({ run, color }: { run: WaiverClaim[]; color: string }) {
  const won = run.filter((c) => c.status === 'successful');
  return (
    <Panel tint={color}>
      <Kicker color={color}>Your claims · last run</Kicker>
      {run.length === 0 ? (
        <Text style={styles.body}>No claims ran for you this week.</Text>
      ) : (
        run.map((c, i) => (
          <Row
            key={c.id}
            first={i === 0}
            left={
              <View style={styles.gap2}>
                <Text style={styles.rowText}>{c.status === 'successful' ? `You got ${c.add_player_name}` : c.add_player_name}</Text>
                <Text style={styles.small} numberOfLines={1}>
                  {c.status === 'successful' ? (c.drop_player_name ? `Dropped ${c.drop_player_name}` : 'No drop') : c.failure_reason}
                </Text>
              </View>
            }
            right={<OutcomeChip status={c.status} />}
          />
        ))
      )}
      {won.length > 0 ? (
        <LinkText color={color} onPress={() => router.navigate('/team')}>
          Set {won[0].add_player_name} in your lineup →
        </LinkText>
      ) : (
        <LinkText color={color} onPress={() => router.navigate('/players')}>
          Browse free agents →
        </LinkText>
      )}
    </Panel>
  );
}

// This week's matchup on paper.
export function MatchupPreviewCard({
  matchupId,
  myProjection,
  theirProjection,
  opponent,
  winProbability,
  color,
}: {
  matchupId: number;
  myProjection: number;
  theirProjection: number;
  opponent: string;
  winProbability: number | null;
  color: string;
}) {
  return (
    <Panel onPress={() => router.push({ pathname: '/matchup/[id]', params: { id: String(matchupId) } })} label="Open your matchup">
      <Kicker>This week’s matchup</Kicker>
      <ScoreLine
        mine={myProjection}
        theirs={theirProjection}
        color={color}
        mineLabel="Your projection"
        theirLabel={opponent}
        middle={winProbability != null ? <Chip color={color}>{Math.round(winProbability)}% to win</Chip> : <Text style={styles.scoreTo}>vs</Text>}
      />
    </Panel>
  );
}

// Counting down to your next starter's kickoff.
export function KickoffCard({
  players,
  now,
  color,
  title,
}: {
  players: RosterEntry[];
  now: Date;
  color: string;
  title: string;
}) {
  const sorted = players.filter((p) => p.game_time).sort((a, b) => a.game_time!.localeCompare(b.game_time!));
  if (sorted.length === 0) return null;
  const first = sorted[0];
  const kickoff = new Date(first.game_time!);
  const together = sorted.filter((p) => p.game_time === first.game_time);
  return (
    <Panel tint={color}>
      <Kicker color={color}>{title}</Kicker>
      <Display style={styles.countdown}>{untilText(kickoff, now)}</Display>
      <Text style={styles.muted}>
        {first.pro_team && first.next_opponent ? `${first.pro_team} vs ${first.next_opponent} · ` : ''}
        {kickoff.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
      </Text>
      <Row first left={`You start ${together.length} in that game`} right={together.map((p) => p.player_name.split(' ').slice(-1)[0]).join(', ')} />
    </Panel>
  );
}

// Live: your starters whose games are on right now.
export function PlayersNowCard({ players, title }: { players: RosterPlayer[]; title: string }) {
  if (players.length === 0) return null;
  return (
    <Panel>
      <Kicker>{title}</Kicker>
      {players.map((p, i) => (
        <Row
          key={`${p.player_id}-${p.player_name}`}
          first={i === 0}
          left={
            <Text style={styles.rowText} numberOfLines={1}>
              {p.player_name}
              {p.is_redzone ? <Text style={styles.redzone}>  · red zone</Text> : null}
            </Text>
          }
          right={<Display style={styles.rowScore}>{fmt(p.points_scored)}</Display>}
        />
      ))}
    </Panel>
  );
}

export function LoungeCard({ title, body }: { title: string; body: string }) {
  return (
    <Panel tint="#a78bfa" style={styles.lounge} onPress={() => router.push('/lounge')} label="Open the Lounge">
      <View style={styles.spread}>
        <View style={styles.gap2}>
          <Kicker color="#c4b5fd">{title}</Kicker>
          <Text style={styles.body}>{body}</Text>
        </View>
        <Chip color="#a78bfa">Join</Chip>
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10 },
  pressed: { opacity: 0.75 },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' },
  link: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  linkText: { fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 8 },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  rowLeft: { flex: 1, minWidth: 0 },
  rowText: { color: Colors.text, fontSize: 14 },
  rowRight: { color: Colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  rowScore: { fontSize: 20 },
  redzone: { color: '#ef4444', fontSize: 12, fontWeight: '700' },
  scoreLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  scoreSide: { flex: 1, minWidth: 0 },
  scoreSideRight: { alignItems: 'flex-end' },
  right: { textAlign: 'right' },
  bigScore: { fontSize: 44, lineHeight: 50 },
  scoreLabel: { color: Colors.textSecondary, fontSize: 12 },
  scoreTo: { color: Colors.textSecondary, fontSize: 16 },
  chip: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 12, fontWeight: '700' },
  bar: { height: 8, borderRadius: 99, backgroundColor: Colors.tileRaised, overflow: 'hidden' },
  barFill: { height: 8 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  cardTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, minWidth: 0, backgroundColor: Colors.tile, borderRadius: Radius.md, padding: 12, gap: 4 },
  tileTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  tileSub: { color: Colors.textSecondary, fontSize: 12 },
  countdown: { fontSize: 44, lineHeight: 50, color: Colors.text },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  body: { color: Colors.text, fontSize: 14 },
  small: { color: Colors.textSecondary, fontSize: 12 },
  gap2: { gap: 2, flexShrink: 1 },
  lounge: { backgroundColor: '#1d1630' },
});
