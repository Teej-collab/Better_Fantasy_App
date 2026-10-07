import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { PreviewLink } from '@/components/PreviewLink';
import { RankBadge } from '@/components/home/YourWeekCard';
import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { Colors, Radius, SectionColors, Spacing, withAlpha } from '@/constants/theme';
import type { NflGame, Rivalry, StandingsRow, WeekMatchupContextItem, WeekPowerRanking } from '@/lib/types';

// The home page's list cards (frontend/src/app/(home)/page.tsx): a
// small uppercase header that links through, over a neon list panel in
// the section's color.

function Header({ title, onPress }: { title: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} hitSlop={6} accessibilityRole="header" accessibilityHint={onPress ? 'Opens the full list' : undefined}>
      <Text style={styles.header}>{title}</Text>
    </Pressable>
  );
}

function ListPanel({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <NeonPanel color={color} radius={Radius.md} contentStyle={styles.list}>
      {children}
    </NeonPanel>
  );
}

// Opens a League tab section (app/(tabs)/league.tsx).
export function openLeague(section: string) {
  router.navigate({ pathname: '/league', params: { section } });
}

function openMatchup(id: number) {
  router.push({ pathname: '/matchup/[id]', params: { id: String(id) } });
}

export function StandingsCard({ standings }: { standings: StandingsRow[] }) {
  return (
    <View style={styles.section}>
      <Header title="League Standings" onPress={() => openLeague('standings')} />
      <ListPanel color={SectionColors.standings}>
        {standings.slice(0, 5).map((row, i) => (
          <View key={row.team_id} style={[styles.row, i > 0 && styles.divided]}>
            <View style={styles.rowLeft}>
              <Text style={styles.rank}>{i + 1}</Text>
              <Text style={styles.name}>{row.team_name}</Text>
            </View>
            <Text style={styles.value}>
              {row.wins}-{row.losses}
              {row.ties ? `-${row.ties}` : ''}
            </Text>
          </View>
        ))}
      </ListPanel>
    </View>
  );
}

function Movement({ movement }: { movement: number | null }) {
  if (movement === null || movement === 0) return <Text style={styles.flat}>—</Text>;
  const up = movement > 0;
  return (
    <Text style={[styles.movement, { color: up ? '#10b981' : '#ef4444' }]}>
      {up ? '▲' : '▼'} {Math.abs(movement)}
    </Text>
  );
}

export function PowerRankingsCard({ rankings, waiting }: { rankings: WeekPowerRanking[]; waiting: boolean }) {
  return (
    <View style={styles.section}>
      <Header title="Power Rankings" onPress={() => openLeague('powerRankings')} />
      <ListPanel color={SectionColors.powerRankings}>
        {waiting ? (
          // Nothing to rank until the season's first game finishes; a
          // missing card reads as broken, so say so (same as the web).
          <Text style={styles.empty}>Power rankings will appear here once this week&apos;s games have been played.</Text>
        ) : (
          rankings.slice(0, 5).map((row, i) => (
            <View key={row.team_id} style={[styles.row, i > 0 && styles.divided]}>
              <View style={styles.rowLeft}>
                <Text style={[styles.rank, styles.bold]}>{row.power_rank}</Text>
                <Text style={styles.name}>{row.team_name}</Text>
              </View>
              <Movement movement={row.movement} />
            </View>
          ))
        )}
      </ListPanel>
    </View>
  );
}

export function OtherMatchupsCard({ matchups, isGameDay }: { matchups: WeekMatchupContextItem[]; isGameDay: boolean }) {
  return (
    <View style={styles.section}>
      <Header title="Other Matchups" onPress={() => openMatchup(matchups[0].matchup_id)} />
      <ListPanel color={SectionColors.matchups}>
        {matchups.map((m, i) => {
          const started = m.home.score !== null && m.away.score !== null && !(m.home.score === 0 && m.away.score === 0);
          return (
            <PreviewLink
              key={m.matchup_id}
              href={{ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } }}
              style={[styles.row, i > 0 && styles.divided]}
              pressedStyle={styles.pressed}>
              <View style={styles.matchupNames}>
                <View style={styles.nameLine}>
                  {isGameDay && started && <View style={styles.liveDot} />}
                  {m.is_game_of_the_week && <Text>⭐</Text>}
                  {m.is_rivalry && <Text>{m.rivalry?.emoji ?? '⚔️'}</Text>}
                  <Text style={styles.name}>{m.home.team_name}</Text>
                  <RankBadge rank={m.home.power_rank} />
                </View>
                <View style={styles.nameLine}>
                  <Text style={[styles.name, styles.muted]}>{m.away.team_name}</Text>
                  <RankBadge rank={m.away.power_rank} />
                </View>
              </View>
              <View style={styles.scoreCol}>
                <Text style={styles.value}>{m.home.score !== null ? m.home.score.toFixed(1) : '—'}</Text>
                <Text style={styles.value}>{m.away.score !== null ? m.away.score.toFixed(1) : '—'}</Text>
              </View>
            </PreviewLink>
          );
        })}
      </ListPanel>
    </View>
  );
}

// This week's rivalry games if there are any, else the league's top
// three rivalries by tier with their all-time records.
export function RivalriesCard({ games, top }: { games: WeekMatchupContextItem[]; top: Rivalry[] }) {
  return (
    <View style={styles.section}>
      <Header title="Rivalries" onPress={() => openLeague('rivalries')} />
      <ListPanel color={SectionColors.rivalries}>
        {games.length > 0
          ? games.map((m, i) => (
              <PreviewLink
                key={m.matchup_id}
                href={{ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } }}
                style={[styles.row, i > 0 && styles.divided]}
                pressedStyle={styles.pressed}>
                <View style={styles.rowLeft}>
                  <Text>{m.rivalry?.emoji ?? '⚔️'}</Text>
                  <Text style={[styles.name, styles.medium]}>{m.rivalry?.name}</Text>
                </View>
                <Text style={styles.valueMuted}>
                  {m.head_to_head.wins_home}-{m.head_to_head.wins_away}
                </Text>
              </PreviewLink>
            ))
          : top.map((r, i) => (
              <View key={r.id} style={[styles.row, i > 0 && styles.divided]}>
                <View style={styles.rowLeft}>
                  <Text>{r.emoji ?? '⚔️'}</Text>
                  <Text style={[styles.name, styles.medium]}>{r.name}</Text>
                </View>
                <Text style={styles.valueMuted}>
                  {r.owner_a_name} {r.all_time_wins_a}-{r.all_time_wins_b} {r.owner_b_name}
                </Text>
              </View>
            ))}
      </ListPanel>
    </View>
  );
}

// Games in progress right now, each opening its Gamecast.
export function LiveNowCard({ games, findGamecastId }: { games: NflGame[]; findGamecastId: (h: string | null, a: string | null) => string | null }) {
  return (
    <View style={styles.section}>
      <Header title="Live Now" />
      <View style={styles.liveList}>
        {games.map((g) => {
          const id = findGamecastId(g.home_team, g.away_team);
          return (
            <Pressable
              key={g.id}
              disabled={!id}
              onPress={() => id && router.push({ pathname: '/gamecast/[id]', params: { id } })}>
              <NeonPanel color={SectionColors.gamecast} radius={Radius.md} contentStyle={styles.liveGame}>
                <View style={styles.liveTeams}>
                  <Text style={styles.name}>
                    {g.away_team} <Text style={styles.bold}>{g.away_score}</Text>
                  </Text>
                  <Text style={styles.name}>
                    {g.home_team} <Text style={styles.bold}>{g.home_score}</Text>
                  </Text>
                </View>
                <View style={styles.liveStatus}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>{g.status_detail ?? 'Live'}</Text>
                </View>
              </NeonPanel>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  header: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  list: { padding: 0, backgroundColor: withAlpha(Colors.surface, 0.92) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.05)' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  rank: { width: 16, color: 'rgba(255,255,255,0.5)', fontSize: 14, fontVariant: ['tabular-nums'] },
  bold: { fontWeight: '700' },
  medium: { fontWeight: '500' },
  name: { color: Colors.text, fontSize: 14, flexShrink: 1 },
  muted: { color: 'rgba(255,255,255,0.5)' },
  value: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontVariant: ['tabular-nums'], textAlign: 'right' },
  valueMuted: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  flat: { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
  movement: { fontSize: 12, fontVariant: ['tabular-nums'] },
  empty: { color: 'rgba(255,255,255,0.5)', fontSize: 14, padding: Spacing.md },
  matchupNames: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  scoreCol: { alignItems: 'flex-end', gap: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.live },
  liveList: { gap: Spacing.sm },
  liveGame: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  liveTeams: { gap: 2 },
  liveStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveText: { color: '#f87171', fontSize: 13, fontWeight: '700' },
  discoverGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  discoverTile: { width: '48.5%', flexGrow: 1 },
  discoverInner: { gap: 2, padding: Spacing.md, minHeight: 72 },
  discoverTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  discoverDot: { width: 6, height: 6, borderRadius: 3, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  discoverLabel: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  discoverDesc: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
});

// Home's Discover grid (frontend/src/app/(home)/page.tsx DiscoveryGrid):
// a tile per League section, in LEAGUE_SUBNAV_ORDER, minus League
// itself, plus Gamecast — the web's DiscoveryGrid leads with it.
const DISCOVER_TILES = [
  { section: 'gamecast', label: 'Gamecast', description: "Live play-by-play for this week's real NFL games", color: SectionColors.gamecast },
  { section: 'standings', label: 'Standings', description: 'Full league standings and records', color: SectionColors.standings },
  {
    section: 'powerRankings',
    label: 'Power Rankings',
    description: "Who's actually good this week, plus Luck and Strength of Schedule",
    color: SectionColors.powerRankings,
  },
  { section: 'rivalries', label: 'Rivalries', description: 'All-time rivalry history and grudges', color: SectionColors.rivalries },
  { section: 'rules', label: 'Rules', description: 'Scoring, roster, and league settings', color: SectionColors.rules },
  { section: 'history', label: 'History', description: 'Recaps, awards, trading cards, and draft grades', color: SectionColors.history },
  { section: 'activity', label: 'Activity', description: 'Activity', color: '#64748b' },
];

export function DiscoverCard({ ringColor }: { ringColor: string }) {
  return (
    <View style={styles.section}>
      <Header title="Discover" />
      <View style={styles.discoverGrid}>
        {DISCOVER_TILES.map((t) => (
          <Pressable key={t.section} onPress={() => (t.section === 'gamecast' ? router.push('/gamecast') : openLeague(t.section))} style={styles.discoverTile}>
            {({ pressed }) => (
              <NeonPanel color={t.color} radius={Radius.md} contentStyle={[styles.discoverInner, pressed && styles.pressed]}>
                <View style={styles.discoverTitle}>
                  <View style={[styles.discoverDot, { backgroundColor: ringColor, shadowColor: ringColor }]} />
                  <Text style={styles.discoverLabel}>{t.label}</Text>
                </View>
                <Text style={styles.discoverDesc}>{t.description}</Text>
              </NeonPanel>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
