import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Chip, Kicker, LinkText, Panel, Row } from '@/components/living/LivingCards';
import { Display, Text } from '@/components/Text';
import { Colors, Radius, Spacing, withAlpha } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { fmt, isStarter } from '@/lib/livingHome';
import { queryClient, useLineupChange } from '@/lib/queries';
import type { Bet, MatchupContextSide, NflGame, RosterEntry, RosterPlayer, YourWeekMatchup } from '@/lib/types';

const WARN = '#ff8a3d';
const HEADS_UP = '#f5b942';
const BAD_STATUS = ['out', 'ir', 'injured reserve', 'suspended', 'pup', 'doubtful'];

const proj = (p: RosterEntry) => p.live_projected ?? p.points_projected ?? 0;

// The best healthy bench player who can take this starter's spot.
function bestBackup(roster: RosterEntry[], starter: RosterEntry, week: number | null): RosterEntry | null {
  return (
    roster
      .filter(
        (b) =>
          b.lineup_slot === 'BE' &&
          !b.is_locked &&
          b.position === starter.position &&
          !(week != null && b.bye_week === week) &&
          !BAD_STATUS.includes(b.injury_status?.toLowerCase() ?? ''),
      )
      .sort((a, b) => proj(b) - proj(a))[0] ?? null
  );
}

function SwapButton({ starter, backup, label }: { starter: RosterEntry; backup: RosterEntry; label: string }) {
  const change = useLineupChange();
  return (
    <Pressable
      disabled={change.isPending}
      onPress={() => {
        haptics.tap();
        change.mutate(
          { kind: 'swap', player: backup, other: starter },
          {
            onSuccess: () => {
              haptics.success();
              void queryClient.invalidateQueries({ queryKey: ['matchup-context'] });
            },
            onError: (e) => Alert.alert("Couldn't swap", e instanceof Error ? e.message : 'Try again.'),
          },
        );
      }}
      accessibilityRole="button"
      accessibilityLabel={`Start ${backup.player_name} instead of ${starter.player_name}`}
      style={({ pressed }) => [styles.swap, (pressed || change.isPending) && styles.pressed]}>
      <Text style={styles.swapText}>{change.isPending ? 'Swapping…' : label}</Text>
    </Pressable>
  );
}

type Problem = { starter: RosterEntry | null; text: string };

export function lineupProblems(roster: RosterEntry[], slots: Record<string, number> | null, week: number | null): Problem[] {
  const problems: Problem[] = [];
  const starters = roster.filter((p) => isStarter(p.lineup_slot));
  for (const p of starters) {
    if (p.is_locked) continue;
    const status = p.injury_status?.toLowerCase() ?? '';
    if (week != null && p.bye_week === week) problems.push({ starter: p, text: `${p.player_name} is on bye` });
    else if (BAD_STATUS.includes(status)) problems.push({ starter: p, text: `${p.player_name} is ${p.injury_status}` });
  }
  if (slots) {
    for (const [slot, count] of Object.entries(slots)) {
      if (!isStarter(slot)) continue;
      const filled = starters.filter((p) => p.lineup_slot === slot).length;
      if (filled < count) problems.push({ starter: null, text: `Empty ${slot} spot` });
    }
  }
  return problems;
}

// Every problem in your lineup, each with a one-tap fix when there's a
// healthy backup on your bench; "Lineup is set" once there are none.
export function LineupFixCard({
  roster,
  slots,
  week,
  color,
}: {
  roster: RosterEntry[];
  slots: Record<string, number> | null;
  week: number | null;
  color: string;
}) {
  const problems = lineupProblems(roster, slots, week);
  const questionable = roster.filter((p) => isStarter(p.lineup_slot) && !p.is_locked && p.injury_status?.toLowerCase() === 'questionable');
  const set = problems.length === 0;
  return (
    <Panel tint={set ? color : WARN}>
      <View style={styles.spread}>
        <Kicker color={set ? color : WARN}>{set ? 'Lineup is set ✓' : `${problems.length} lineup problem${problems.length === 1 ? '' : 's'}`}</Kicker>
        <LinkText color={color} onPress={() => router.navigate('/team')}>
          Open lineup
        </LinkText>
      </View>
      {problems.map((p, i) => {
        const backup = p.starter ? bestBackup(roster, p.starter, week) : null;
        return (
          <Row
            key={p.text}
            first={i === 0}
            left={
              <View style={styles.gap2}>
                <Text style={styles.rowText}>{p.text}</Text>
                {backup && <Text style={styles.small}>Best on your bench: {backup.player_name} · {fmt(proj(backup))}</Text>}
              </View>
            }
            right={p.starter && backup ? <SwapButton starter={p.starter} backup={backup} label="Swap in" /> : <Chip color={WARN}>Fix</Chip>}
          />
        );
      })}
      {questionable.map((p, i) => (
        <Row
          key={p.player_id}
          first={problems.length === 0 && i === 0}
          left={
            <View style={styles.gap2}>
              <Text style={styles.rowText}>
                {p.player_name} · {p.position}
              </Text>
              <Text style={styles.small}>
                {p.practice_participation ? `Practice: ${p.practice_participation}` : 'No practice report yet'}
                {p.game_time ? ` · ${new Date(p.game_time).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
              </Text>
            </View>
          }
          right={<Chip color={HEADS_UP}>Questionable</Chip>}
        />
      ))}
    </Panel>
  );
}

// Bench players projected within a couple of points of a starter at the
// same position — the close calls — with how tough each matchup is.
export function StartSitCard({ roster, context, week }: { roster: RosterEntry[]; context: MatchupContextSide | null; week: number | null }) {
  const rank = new Map((context?.roster ?? []).map((p) => [String(p.player_id), p.opponent_position_rank]));
  const calls: { starter: RosterEntry; bench: RosterEntry }[] = [];
  for (const b of roster) {
    if (b.lineup_slot !== 'BE' || b.is_locked || BAD_STATUS.includes(b.injury_status?.toLowerCase() ?? '') || (week != null && b.bye_week === week)) continue;
    const rival = roster
      .filter((s) => isStarter(s.lineup_slot) && !s.is_locked && s.position === b.position)
      .sort((x, y) => proj(x) - proj(y))[0];
    if (rival && proj(b) > 0 && Math.abs(proj(rival) - proj(b)) <= 2.5) calls.push({ starter: rival, bench: b });
  }
  if (calls.length === 0) return null;
  const tough = (p: RosterEntry) => {
    const r = rank.get(p.player_id);
    return r ? `vs ${p.next_opponent ?? '?'} · ${r.rank}${r.rank === 1 ? 'st' : r.rank === 2 ? 'nd' : r.rank === 3 ? 'rd' : 'th'} toughest` : p.next_opponent ? `vs ${p.next_opponent}` : '';
  };
  return (
    <Panel>
      <Kicker>Start / sit · your closest calls</Kicker>
      {calls.slice(0, 3).map(({ starter, bench }) => (
        <View key={`${starter.player_id}-${bench.player_id}`} style={styles.calls}>
          <View style={[styles.call, { borderColor: proj(starter) >= proj(bench) ? Colors.accent : Colors.border }]}>
            <Text style={styles.callLabel}>Starting</Text>
            <Text style={styles.callName} numberOfLines={1}>
              {starter.player_name}
            </Text>
            <Display style={styles.callNum}>{fmt(proj(starter))}</Display>
            <Text style={styles.small} numberOfLines={1}>
              {tough(starter)}
            </Text>
          </View>
          <View style={[styles.call, { borderColor: proj(bench) > proj(starter) ? Colors.accent : Colors.border }]}>
            <Text style={styles.callLabel}>Bench</Text>
            <Text style={styles.callName} numberOfLines={1}>
              {bench.player_name}
            </Text>
            <Display style={styles.callNum}>{fmt(proj(bench))}</Display>
            <Text style={styles.small} numberOfLines={1}>
              {tough(bench)}
            </Text>
            {proj(bench) > proj(starter) && <SwapButton starter={starter} backup={bench} label="Start him" />}
          </View>
        </View>
      ))}
    </Panel>
  );
}

// Outdoor games with snow, rain, wind or freezing temperatures that
// your starters play in.
export function WeatherCard({ games, roster }: { games: NflGame[]; roster: RosterEntry[] }) {
  const mine = new Set(roster.filter((p) => isStarter(p.lineup_slot) && !p.is_locked && p.pro_team).map((p) => p.pro_team!));
  const alerts = games.filter((g) => {
    if (g.state !== 'pre' || g.indoor || !g.weather) return false;
    if (!(mine.has(g.home_team ?? '') || mine.has(g.away_team ?? ''))) return false;
    const c = g.weather.condition?.toLowerCase() ?? '';
    return /snow|rain|storm|wind|sleet|shower/.test(c) || (g.weather.temperature != null && g.weather.temperature <= 32);
  });
  if (alerts.length === 0) return null;
  return (
    <Panel tint="#4cc3ff">
      <Kicker color="#4cc3ff">Weather watch</Kicker>
      {alerts.map((g, i) => {
        const yours = roster.filter((p) => isStarter(p.lineup_slot) && (p.pro_team === g.home_team || p.pro_team === g.away_team));
        return (
          <Row
            key={g.id}
            first={i === 0}
            left={
              <View style={styles.gap2}>
                <Text style={styles.rowText}>
                  {g.away_team} @ {g.home_team}
                </Text>
                <Text style={styles.small} numberOfLines={1}>
                  {yours.map((p) => p.player_name).join(', ')}
                </Text>
              </View>
            }
            right={`${g.weather?.condition ?? ''}${g.weather?.temperature != null ? ` · ${g.weather.temperature}°` : ''}`}
          />
        );
      })}
    </Panel>
  );
}

// The other side: their hurt starters, or who they start today.
export function OpponentIntelCard({ them, title, players }: { them: MatchupContextSide; title: string; players?: RosterPlayer[] }) {
  const hurt = them.roster.filter((p) => isStarter(p.lineup_slot) && p.injury_status && !['active', 'healthy'].includes(p.injury_status.toLowerCase()));
  const list = players ?? hurt;
  if (list.length === 0) return null;
  return (
    <Panel>
      <Kicker>{title}</Kicker>
      {list.map((p, i) => (
        <Row
          key={`${p.player_id}-${p.player_name}`}
          first={i === 0}
          left={`${p.player_name} · ${p.position ?? ''}`}
          right={players ? fmt(p.live_projected ?? p.points_projected) : <Chip color={BAD_STATUS.includes(p.injury_status?.toLowerCase() ?? '') ? WARN : HEADS_UP}>{p.injury_status}</Chip>}
        />
      ))}
    </Panel>
  );
}

// Your open bets for the weekend.
export function BetsCard({ bets }: { bets: Bet[] }) {
  const open = bets.filter((b) => b.status === 'open');
  if (open.length === 0) return null;
  return (
    <Panel onPress={() => router.push('/bets')} label="Open your bets">
      <Kicker>Your open bets · {open.length}</Kicker>
      {open.slice(0, 3).map((b, i) => (
        <Row
          key={b.id}
          first={i === 0}
          left={
            <Text style={styles.rowText} numberOfLines={1}>
              {b.legs.length === 1 ? b.legs[0].description : `${b.legs.length}-leg parlay`}
            </Text>
          }
          right={b.odds_american != null ? `${b.odds_american > 0 ? '+' : ''}${b.odds_american}` : ''}
        />
      ))}
    </Panel>
  );
}

// After Thursday: where you stand going into Sunday.
export function HeadStartCard({ matchup }: { matchup: YourWeekMatchup }) {
  const margin = (matchup.my_score ?? 0) - (matchup.opponent_score ?? 0);
  if ((matchup.my_score ?? 0) + (matchup.opponent_score ?? 0) === 0) return null;
  const up = margin >= 0;
  return (
    <Panel tint={up ? '#39ff14' : WARN}>
      <Kicker color={up ? '#39ff14' : WARN}>{up ? 'Head start' : 'Playing catch-up'}</Kicker>
      <Text style={styles.body}>
        You&apos;re {up ? 'up' : 'down'} {Math.abs(margin).toFixed(1)} going into Sunday ({fmt(matchup.my_score)}–{fmt(matchup.opponent_score)}), with{' '}
        {matchup.my_yet_to_play} left to their {matchup.opponent_yet_to_play}.
      </Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  gap2: { gap: 2, flexShrink: 1 },
  rowText: { color: Colors.text, fontSize: 14 },
  body: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  small: { color: Colors.textSecondary, fontSize: 12 },
  swap: { backgroundColor: withAlpha(Colors.accent, 0.18), borderRadius: Radius.pill, paddingHorizontal: 12, minHeight: 32, justifyContent: 'center' },
  swapText: { color: Colors.accent, fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.6 },
  calls: { flexDirection: 'row', gap: 10 },
  call: { flex: 1, minWidth: 0, backgroundColor: Colors.tile, borderRadius: Radius.md, borderWidth: 1, padding: 10, gap: 3 },
  callLabel: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  callName: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  callNum: { fontSize: 22, color: Colors.text },
});
