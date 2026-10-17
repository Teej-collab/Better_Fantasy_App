import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { AMBER, AvatarStack, BetAvatar, LOSS, WIN } from '@/components/bets/LeagueBetCard';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { formatStat, legPick } from '@/lib/bets';
import { useLeagueBetGame } from '@/lib/queries';
import type { BetMember, LeagueGame, LeagueGameEntry } from '@/lib/types';

// Riding on this game (League Bets): every leg the league has on one
// NFL game. Player props put everyone's line on one bar, so you can see
// who's cashed and who still needs yards.

function headshot(sleeperId: string | null): string | null {
  return sleeperId && /^\d+$/.test(sleeperId) ? `https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg` : null;
}

export default function LeagueGameScreen() {
  const accent = useAppearance().accent;
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useLeagueBetGame(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError || !q.data) return <MessageState message={q.error instanceof Error ? q.error.message : "Couldn't load this game."} />;
  const data = q.data;
  const g = data.game;
  const live = g?.state === 'in';
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: 'Riding on this game', headerBackTitle: 'League Bets' }} />

      <View style={styles.scoreboard}>
        <View style={styles.rowCenter}>
          {live && <View style={styles.liveDot} />}
          <Text style={[styles.kicker, live && { color: Colors.text }]}>{live ? 'Live' : g?.state === 'post' ? 'Final' : 'Upcoming'}</Text>
        </View>
        <View style={styles.teams}>
          <Display style={styles.team}>{g?.away_team ?? '—'}</Display>
          {g && g.state !== 'pre' ? (
            <Text style={styles.score}>
              {g.away_score ?? 0}
              <Text style={styles.softText}> – </Text>
              {g.home_score ?? 0}
            </Text>
          ) : (
            <Text style={[styles.score, styles.softText]}>@</Text>
          )}
          <Display style={[styles.team, { textAlign: 'right' }]}>{g?.home_team ?? '—'}</Display>
        </View>
        <Text style={styles.body}>
          <Text style={styles.mono}>{data.legs}</Text> {data.legs === 1 ? 'leg' : 'legs'} · <Text style={styles.mono}>{data.member_count}</Text>{' '}
          {data.member_count === 1 ? 'member' : 'members'} riding this game
        </Text>
      </View>

      {data.props.map((p) => (
        <PropCard key={`${p.player_name}-${p.stat_key}`} prop={p} accent={accent} />
      ))}

      {data.lines.length > 0 && (
        <View style={styles.panel}>
          <Text style={styles.kicker}>Game lines</Text>
          {data.lines.map((l, i) => {
            const status = l.status;
            return (
              <View key={i} style={styles.lineRow}>
                <View style={styles.flex}>
                  <Text style={styles.name}>{legPick(l)}</Text>
                  <Text style={[styles.soft, status === 'won' && { color: WIN }, status === 'lost' && { color: LOSS }]}>
                    {status === 'won' ? 'Hit' : status === 'lost' ? 'Missed' : status === 'open' ? 'In play' : status}
                  </Text>
                </View>
                <AvatarStack members={uniqueMembers(l.entries).slice(0, 3)} size={24} extra={Math.max(0, uniqueMembers(l.entries).length - 3)} />
              </View>
            );
          })}
        </View>
      )}

      {data.rooting.length > 0 && <Rooting rooting={data.rooting} game={data} />}

      <Pressable
        onPress={() => router.push({ pathname: '/gamecast/[id]', params: { id: data.event_id } })}
        accessibilityRole="button"
        style={({ pressed }) => [styles.primary, { backgroundColor: accent }, pressed && styles.pressed]}>
        <Text style={styles.primaryText}>Open the Gamecast</Text>
      </Pressable>
    </ScrollView>
  );
}

function uniqueMembers(entries: LeagueGameEntry[]): BetMember[] {
  const seen = new Map<number, BetMember>();
  for (const e of entries) seen.set(e.member.user_id, e.member);
  return [...seen.values()];
}

function PropCard({ prop, accent }: { prop: LeagueGame['props'][number]; accent: string }) {
  const [width, setWidth] = useState(0);
  const lines = prop.entries.map((e) => e.line).filter((n): n is number => n !== null);
  const current = prop.current ?? 0;
  const max = Math.max(1, current, ...lines) * 1.15;
  // Everyone on the same number shares one pin.
  const pins = new Map<number, LeagueGameEntry[]>();
  for (const e of prop.entries) if (e.line !== null) pins.set(e.line, [...(pins.get(e.line) ?? []), e]);
  const toGo = lines.filter((l) => l > current);
  const cashed = prop.entries.filter((e) => e.status === 'won');
  const yesNo = prop.stat_key === 'anytime_td';
  return (
    <View style={styles.panel}>
      <View style={styles.rowCenter}>
        <PlayerHeadshot url={headshot(prop.sleeper_player_id)} position={prop.team_abbr ?? ''} size={44} />
        <View style={styles.flex}>
          <Text style={styles.name}>
            {prop.player_name} · {prop.stat_label ?? 'Prop'}
          </Text>
          <Text style={styles.soft}>
            {prop.team_abbr ?? ''} · {prop.entries.length} {prop.entries.length === 1 ? 'bet' : 'bets'} on it
          </Text>
        </View>
        {prop.current !== null && <Text style={[styles.mono, { fontSize: 26 }]}>{formatStat(prop.current)}</Text>}
      </View>

      {!yesNo && lines.length > 0 ? (
        <View style={styles.bar} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, (current / max) * 100)}%` }]} />
          </View>
          {width > 0 &&
            [...pins.entries()].map(([line, entries]) => {
              const left = Math.min(width - 2, (line / max) * width);
              const hit = entries.some((e) => e.status === 'won') || (entries[0].direction !== 'under' && current > line);
              const tagLeft = Math.max(0, Math.min(width - 60, left - 30));
              return (
                <View key={line}>
                  <View style={[styles.pin, { left, backgroundColor: hit ? WIN : Colors.text }]} />
                  <View style={[styles.tag, { left: tagLeft }]}>
                    <AvatarStack members={uniqueMembers(entries).slice(0, 3)} size={22} />
                    <Text style={[styles.mono, { fontSize: 10, color: hit ? WIN : Colors.text }]}>
                      {entries[0].direction === 'under' ? 'U ' : ''}
                      {formatStat(line)}
                    </Text>
                  </View>
                </View>
              );
            })}
        </View>
      ) : (
        <View style={styles.chips}>
          {prop.entries.map((e, i) => (
            <View key={i} style={styles.entryChip}>
              <BetAvatar member={e.member} size={22} />
              <Text style={styles.body}>
                {e.member.name}
                {e.status === 'won' ? ' · hit' : e.status === 'lost' ? ' · missed' : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      {!yesNo && lines.length > 0 && (
        <View style={styles.rowBetween}>
          <Text style={styles.soft}>
            {cashed.length > 0 ? (
              <Text style={{ color: WIN, fontWeight: '600' }}>
                {cashed.map((e) => e.member.name).join(', ')} cashed
              </Text>
            ) : (
              'Nobody’s cashed yet'
            )}
          </Text>
          {toGo.length > 0 && prop.current !== null && (
            <Text style={[styles.soft, { color: AMBER }]}>
              {formatStat(Math.min(...toGo) - current)} to go for {prop.entries.filter((e) => e.line !== null && e.line > current && e.status === 'open').length} more
            </Text>
          )}
        </View>
      )}
      {prop.current === null && <Text style={[styles.soft, { color: accent }]}>Updates live once the game starts.</Text>}
    </View>
  );
}

function Rooting({ rooting, game }: { rooting: LeagueGame['rooting']; game: LeagueGame }) {
  const g = game.game;
  const order = g?.away_team && g.home_team ? [g.away_team, g.home_team] : rooting.map((r) => r.team);
  const shares = order.map((t) => ({ team: t, share: rooting.find((r) => r.team === t)?.share ?? 0 }));
  const colors = ['#1f6fb2', '#b4202a'];
  return (
    <View style={styles.panel} accessible accessibilityLabel={`Who the league is rooting for: ${shares.map((s) => `${s.team} ${Math.round(s.share * 100)}%`).join(', ')}`}>
      <Text style={styles.kicker}>Who the league is rooting for</Text>
      <View style={styles.split}>
        {shares.map((s, i) =>
          s.share > 0 ? (
            <View key={s.team} style={[styles.splitPart, { flex: s.share, backgroundColor: colors[i % 2], alignItems: i === 0 ? 'flex-start' : 'flex-end' }]}>
              <Text style={styles.splitText} numberOfLines={1}>
                {s.team} {Math.round(s.share * 100)}%
              </Text>
            </View>
          ) : null,
        )}
      </View>
      <Text style={styles.soft}>Weighted by every leg riding on a team: spreads, moneylines and overs.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 3, gap: Spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  soft: { color: Colors.textSecondary, fontSize: 12, flexShrink: 1 },
  softText: { color: Colors.textSecondary },
  body: { color: Colors.text, fontSize: 13 },
  name: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  mono: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 13 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  scoreboard: {
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#17142a',
  },
  teams: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  team: { flex: 1, color: Colors.text, fontSize: 28 },
  score: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 30 },
  panel: { gap: Spacing.md, padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  bar: { height: 66, marginHorizontal: 4 },
  track: { position: 'absolute', left: 0, right: 0, top: 0, height: 14, borderRadius: 7, backgroundColor: Colors.tileRaised, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#38bdf8' },
  pin: { position: 'absolute', top: -4, width: 3, height: 22, borderRadius: 2 },
  tag: { position: 'absolute', top: 24, width: 60, alignItems: 'center', gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  entryChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingLeft: 5, paddingRight: 10, borderRadius: Radius.pill, backgroundColor: Colors.tile },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  split: { flexDirection: 'row', height: 28, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.tileRaised },
  splitPart: { justifyContent: 'center', paddingHorizontal: 10 },
  splitText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  primary: { minHeight: 48, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#06110a', fontSize: 14, fontWeight: '700' },
});
