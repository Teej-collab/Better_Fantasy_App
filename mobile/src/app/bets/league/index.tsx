import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import {
  AMBER,
  AvatarStack,
  BetAvatar,
  formatUnits,
  LeagueBetCard,
  LOSS,
  unitsColor,
  WIN,
} from '@/components/bets/LeagueBetCard';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing, withAlpha } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { formatOdds, formatStat, legPick } from '@/lib/bets';
import { haptics } from '@/lib/haptics';
import { useLeagueBetGames, useLeagueBets, useLeagueBetsBoard } from '@/lib/queries';
import type { LeagueBet, LeagueBoard, LeagueFeed, LeagueGameSummary } from '@/lib/types';

// League Bets (2026-10-17, "League Bets Mockups" canvas): every bet
// shared in the league and who placed it. Feed, The Board (records and
// units — every bet one unit at its odds, so no wager ever shows) and
// By Game. Tracking only; nothing here places a bet.

type Tab = 'feed' | 'board' | 'games';
type Filter = 'all' | 'live' | 'hit' | 'busted' | 'parlays';

const TABS: { key: Tab; label: string }[] = [
  { key: 'feed', label: 'Feed' },
  { key: 'board', label: 'The Board' },
  { key: 'games', label: 'By Game' },
];

export default function LeagueBetsScreen() {
  const accent = useAppearance().accent;
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'board' || params.tab === 'games' ? params.tab : 'feed');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: 'League Bets', headerBackTitle: 'Back' }} />
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={[styles.kicker, { color: accent }]}>Every bet in the league</Text>
          <Display style={styles.title}>{tab === 'board' ? 'Sharps & Squares' : 'League Bets'}</Display>
        </View>
        <Pressable
          onPress={() => router.push('/bets/add')}
          accessibilityRole="button"
          accessibilityLabel="Add a bet"
          style={({ pressed }) => [styles.add, { backgroundColor: accent }, pressed && styles.pressed]}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#06110a" strokeWidth={2.6} strokeLinecap="round">
            <Path d="M12 5v14M5 12h14" />
          </Svg>
        </Pressable>
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => {
              haptics.tap();
              setTab(t.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            style={[styles.tab, tab === t.key && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'feed' && <Feed />}
      {tab === 'board' && <Board />}
      {tab === 'games' && <Games />}

      <Text style={styles.disclaimer}>
        Wagers and payouts are never shown here. The Weekend only tracks bets — it never places them. 21+. If gambling stops being
        fun, call or text 1-800-GAMBLER.
      </Text>
    </ScrollView>
  );
}

// ---- Feed ----

function Feed() {
  const q = useLeagueBets();
  const [filter, setFilter] = useState<Filter>('all');
  if (q.isPending) return <LoadingState />;
  if (q.isError || !q.data) return <MessageState message={q.error instanceof Error ? q.error.message : "Couldn't load League Bets."} />;
  if (!q.data.enabled) return <MessageState message="Bet tracking is off. Turn it on in Settings to see League Bets." />;
  const data = q.data;
  const bets = data.bets;

  const matches: Record<Filter, (b: LeagueBet) => boolean> = {
    all: () => true,
    live: (b) => b.status === 'open',
    hit: (b) => b.status === 'won',
    busted: (b) => b.status === 'lost',
    parlays: (b) => b.legs.length > 1,
  };
  const shown = bets.filter(matches[filter]);
  const count = (f: Filter) => bets.filter(matches[f]).length;
  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: `All ${bets.length}` },
    { key: 'live', label: `Live ${count('live')}` },
    { key: 'hit', label: `Hit ${count('hit')}` },
    { key: 'busted', label: `Busted ${count('busted')}` },
    { key: 'parlays', label: 'Parlays' },
  ];

  return (
    <>
      {data.sweat.alive > 0 && <Sweat sweat={data.sweat} />}
      {data.consensus && <Consensus consensus={data.consensus} />}
      {bets.length > 0 && <Chips value={filter} onChange={setFilter} options={chips} />}
      {bets.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No bets shared yet</Text>
          <Text style={styles.softCenter}>
            New bets share with the league when you save them. Add one and it shows up here for everyone, picks only.
          </Text>
          <Pressable onPress={() => router.push('/bets/add')} accessibilityRole="button" style={styles.emptyButton}>
            <Text style={styles.emptyButtonText}>Add a bet</Text>
          </Pressable>
        </View>
      )}
      {bets.length > 0 && shown.length === 0 && <Text style={styles.softCenter}>Nothing here yet.</Text>}
      {shown.map((b) => (
        <LeagueBetCard key={b.id} bet={b} />
      ))}
    </>
  );
}

function Sweat({ sweat }: { sweat: Extract<LeagueFeed, { enabled: true }>['sweat'] }) {
  const accent = useAppearance().accent;
  const c = sweat.closest;
  const leg = c?.leg;
  const g = leg?.game;
  const pick = leg ? `${leg.player_name ? `${leg.player_name} ` : ''}${legPick({ ...leg, stat_label: leg.stat_label }).toLowerCase()}` : '';
  const headline = c
    ? c.needs_more !== null && leg?.player_name
      ? `${c.member.name} needs ${formatStat(c.needs_more)} more ${leg.player_name.split(' ').slice(-1)[0]} ${(leg.stat_label ?? '').toLowerCase()}`
      : `${c.member.name} is one leg from hitting`
    : null;
  return (
    <View style={styles.sweat}>
      <View style={styles.rowBetween}>
        <View style={styles.rowCenter}>
          <View style={styles.liveDot} />
          <Text style={[styles.kicker, { color: Colors.text }]}>The Sweat · this week</Text>
        </View>
      </View>
      <View style={styles.statRow}>
        <Stat value={String(sweat.alive)} label={sweat.alive === 1 ? 'bet still alive' : 'bets still alive'} />
        <Stat value={String(sweat.one_leg_away)} label="one leg away" color={AMBER} />
        <Stat value={formatUnits(sweat.riding_units)} label="riding on it" color={accent} />
      </View>
      {c && headline && (
        <Pressable
          onPress={() => router.push({ pathname: '/bets/league/member/[id]', params: { id: String(c.member.user_id) } })}
          accessibilityRole="button"
          accessibilityHint={`Opens ${c.member.name}'s betting card`}
          style={({ pressed }) => [styles.closest, pressed && styles.pressed]}>
          <BetAvatar member={c.member} size={30} ring={AMBER} />
          <View style={styles.flex}>
            <Text style={styles.closestTitle} numberOfLines={2}>
              {headline}
            </Text>
            <Text style={styles.soft} numberOfLines={1}>
              {c.odds_american !== null ? `to hit a ${formatOdds(c.odds_american)} ${c.legs > 1 ? 'parlay' : 'bet'}` : pick}
              {g?.away_team ? ` · ${g.away_team} @ ${g.home_team}` : ''}
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.soft}>{label}</Text>
    </View>
  );
}

function Consensus({ consensus }: { consensus: NonNullable<Extract<LeagueFeed, { enabled: true }>['consensus']> }) {
  const picks = consensus.top_picks
    .map((p) => {
      const dir = p.direction === 'under' ? 'Under' : p.direction === 'no' ? 'No' : p.direction === 'yes' ? '' : 'Over';
      const line = p.line !== null && p.direction !== 'yes' ? ` ${p.line}` : '';
      return `${p.count} on ${`${dir}${line} ${p.stat_label ?? ''}`.trim().toLowerCase()}`;
    })
    .join(' · ');
  return (
    <View style={styles.consensus} accessible accessibilityLabel={`League consensus: ${consensus.count} of ${consensus.of} are on ${consensus.player_name}. ${picks}`}>
      <View style={styles.flex}>
        <Text style={styles.kicker}>League consensus</Text>
        <Text style={styles.consensusTitle}>
          {consensus.count} of {consensus.of} are on {consensus.player_name}
        </Text>
        {picks ? <Text style={styles.soft}>{picks}</Text> : null}
      </View>
      <AvatarStack members={consensus.members.slice(0, 3)} extra={Math.max(0, consensus.count - 3)} />
    </View>
  );
}

function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  const accent = useAppearance().accent;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              haptics.tap();
              onChange(o.key);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.chip, on && { backgroundColor: accent, borderColor: accent }]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---- The Board ----

type Range = 'season' | 'week' | 'parlays';

function Board() {
  const accent = useAppearance().accent;
  const [range, setRange] = useState<Range>('season');
  const q = useLeagueBetsBoard(range === 'week' ? 'week' : 'season', range === 'parlays');
  const ranges: { key: Range; label: string }[] = [
    { key: 'season', label: 'Season' },
    { key: 'week', label: 'This week' },
    { key: 'parlays', label: 'Parlays only' },
  ];
  return (
    <>
      <Chips value={range} onChange={setRange} options={ranges} />
      {q.isPending ? (
        <LoadingState />
      ) : q.isError || !q.data ? (
        <MessageState message="Couldn't load The Board." />
      ) : q.data.rows.length === 0 ? (
        <Text style={styles.softCenter}>No shared bets {range === 'week' ? 'this week' : 'yet'}. The Board fills in as they settle.</Text>
      ) : (
        <BoardBody board={q.data} accent={accent} />
      )}
    </>
  );
}

function BoardBody({ board, accent }: { board: LeagueBoard; accent: string }) {
  const [first, second, third] = board.rows;
  const rest = board.rows.slice(3);
  const t = board.trophies;
  const tend = board.tendencies;
  const openMember = (id: number) => router.push({ pathname: '/bets/league/member/[id]', params: { id: String(id) } });
  return (
    <>
      <View style={styles.podium}>
        {second ? <Podium row={second} place={2} onPress={() => openMember(second.user_id)} accent={accent} /> : <View style={styles.flex} />}
        {first && <Podium row={first} place={1} onPress={() => openMember(first.user_id)} accent={accent} />}
        {third ? <Podium row={third} place={3} onPress={() => openMember(third.user_id)} accent={accent} /> : <View style={styles.flex} />}
      </View>

      {rest.length > 0 && (
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHead]}>
            <Text style={[styles.kicker, styles.rankCol]}>#</Text>
            <Text style={[styles.kicker, styles.flex]}>Member</Text>
            <Text style={[styles.kicker, styles.numCol]}>Rec</Text>
            <Text style={[styles.kicker, styles.numCol]}>Units</Text>
          </View>
          {rest.map((r) => (
            <Pressable
              key={r.user_id}
              onPress={() => openMember(r.user_id)}
              accessibilityRole="button"
              accessibilityLabel={`${r.rank}. ${r.name}, ${r.wins} and ${r.losses}, ${formatUnits(r.units)}`}
              style={({ pressed }) => [styles.tableRow, r.me && { backgroundColor: withAlpha(accent, 0.06) }, pressed && styles.pressed]}>
              <Text style={[styles.mono, styles.rankCol, styles.softText]}>{r.rank}</Text>
              <BetAvatar member={r} size={32} />
              <View style={styles.flex}>
                <Text style={styles.name} numberOfLines={1}>
                  {r.name}
                  {r.me ? <Text style={[styles.soft, { color: accent }]}> · you</Text> : null}
                </Text>
                <Text style={[styles.soft, rowTag(r).color ? { color: rowTag(r).color, fontWeight: '600' } : null]} numberOfLines={1}>
                  {rowTag(r).text}
                </Text>
              </View>
              <Text style={[styles.mono, styles.numCol]}>
                {r.wins}–{r.losses}
              </Text>
              <Text style={[styles.mono, styles.numCol, { color: unitsColor(r.units, accent) }]}>{formatUnits(r.units)}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {(t.longest_shot || t.bad_beat_king || t.most_tailed || t.best_fade) && (
        <>
          <Display style={styles.section}>Trophy case</Display>
          <View style={styles.trophies}>
            {t.longest_shot && (
              <Trophy title="Longest shot hit" color="#facc15" value={formatOdds(t.longest_shot.odds_american)} sub={`${t.longest_shot.member.name} · ${t.longest_shot.legs > 1 ? `${t.longest_shot.legs}-leg` : 'straight'}`} />
            )}
            {t.bad_beat_king && (
              <Trophy title="Bad Beat King" color={LOSS} value={String(t.bad_beat_king.count)} sub={`${t.bad_beat_king.member.name} · lost by one leg`} />
            )}
            {t.most_tailed && <Trophy title="Most tailed" color={accent} value={String(t.most_tailed.count)} sub={`${t.most_tailed.member.name} · tails earned`} />}
            {t.best_fade && (
              <Trophy title="Best fade" color="#38bdf8" value={`${t.best_fade.wins}–${t.best_fade.losses}`} sub={`${t.best_fade.member.name} · fading`} />
            )}
          </View>
        </>
      )}

      {tend.overs_share !== null && (
        <View style={styles.panel}>
          <Text style={styles.kicker}>League tendencies</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.body}>Overs</Text>
            <Text style={styles.mono}>{Math.round(tend.overs_share * 100)}%</Text>
          </View>
          <View style={styles.splitTrack}>
            <View style={{ flex: tend.overs_share, backgroundColor: '#38bdf8' }} />
            <View style={{ flex: 1 - tend.overs_share, backgroundColor: AMBER }} />
          </View>
          <Text style={styles.soft}>
            Overs are {tend.overs.wins}–{tend.overs.losses}. Unders are {tend.unders.wins}–{tend.unders.losses}.
            {tend.unders.wins > tend.unders.losses && tend.overs.wins < tend.overs.losses ? ' Just saying.' : ''}
          </Text>
          {tend.parlay_hit_rate !== null && (
            <>
              <View style={[styles.rowBetween, { marginTop: Spacing.sm }]}>
                <Text style={styles.body}>Parlays hit</Text>
                <Text style={styles.mono}>{Math.round(tend.parlay_hit_rate * 100)}%</Text>
              </View>
              <View style={styles.splitTrack}>
                <View style={{ flex: Math.max(0.001, tend.parlay_hit_rate), backgroundColor: accent }} />
                <View style={{ flex: 1 - tend.parlay_hit_rate, backgroundColor: Colors.tileRaised }} />
              </View>
            </>
          )}
        </View>
      )}
      <Text style={styles.softCenter}>Units: every bet counts as 1 unit at its odds, so The Board ranks picks, not bankrolls.</Text>
    </>
  );
}

function rowTag(r: LeagueBoard['rows'][number]): { text: string; color?: string } {
  if (r.streak && r.streak.startsWith('W') && Number(r.streak.slice(1)) >= 3) return { text: `${r.streak} streak`, color: WIN };
  if (r.streak && r.streak.startsWith('L') && Number(r.streak.slice(1)) >= 4) return { text: `${r.streak} · fade material`, color: LOSS };
  if (r.bad_beats >= 2) return { text: `${r.bad_beats} bad beats` };
  if (r.hit_rate !== null) return { text: `${Math.round(r.hit_rate * 100)}% hit rate` };
  return { text: `${r.open} open` };
}

function Podium({ row, place, onPress, accent }: { row: LeagueBoard['rows'][number]; place: 1 | 2 | 3; onPress: () => void; accent: string }) {
  const ringColor = place === 1 ? '#facc15' : place === 2 ? '#c0c7d2' : '#b45309';
  const big = place === 1;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${place === 1 ? 'First' : place === 2 ? 'Second' : 'Third'}: ${row.name}, ${formatUnits(row.units)}, ${row.wins} and ${row.losses}`}
      style={({ pressed }) => [styles.podiumCard, big && styles.podiumFirst, pressed && styles.pressed]}>
      {big ? (
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth={2} strokeLinejoin="round">
          <Path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
        </Svg>
      ) : (
        <Text style={[styles.mono, styles.softText]}>{place}</Text>
      )}
      <BetAvatar member={row} size={big ? 56 : 46} ring={ringColor} />
      <Text style={[styles.name, big && { fontSize: 15, fontWeight: '700' }]} numberOfLines={1}>
        {row.name}
      </Text>
      <Text style={[styles.mono, { fontSize: big ? 20 : 16, color: unitsColor(row.units, accent) }]} numberOfLines={1} adjustsFontSizeToFit>
        {formatUnits(row.units)}
      </Text>
      <Text style={styles.soft}>
        {row.wins}–{row.losses}
        {big && row.hit_rate !== null ? ` · ${Math.round(row.hit_rate * 100)}%` : ''}
      </Text>
    </Pressable>
  );
}

function Trophy({ title, color, value, sub }: { title: string; color: string; value: string; sub: string }) {
  return (
    <View style={styles.trophy} accessible accessibilityLabel={`${title}: ${value}, ${sub}`}>
      <Text style={[styles.kicker, { color }]}>{title}</Text>
      <Text style={[styles.mono, { fontSize: 20 }]}>{value}</Text>
      <Text style={styles.soft} numberOfLines={2}>
        {sub}
      </Text>
    </View>
  );
}

// ---- By Game ----

function Games() {
  const q = useLeagueBetGames();
  if (q.isPending) return <LoadingState />;
  if (q.isError || !q.data) return <MessageState message="Couldn't load this week's games." />;
  if (q.data.games.length === 0) return <Text style={styles.softCenter}>No league bets on this week&apos;s games yet.</Text>;
  return (
    <>
      {q.data.games.map((g) => (
        <GameRow key={g.event_id} game={g} />
      ))}
    </>
  );
}

function GameRow({ game }: { game: LeagueGameSummary }) {
  const g = game.game;
  const live = g?.state === 'in';
  const final = g?.state === 'post';
  const matchup = g?.away_team ? `${g.away_team} @ ${g.home_team}` : 'Game';
  const score = g && g.state !== 'pre' ? `${g.away_score ?? 0}–${g.home_score ?? 0}` : null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/bets/league/game/[id]', params: { id: game.event_id } })}
      accessibilityRole="button"
      accessibilityLabel={`${matchup}${score ? `, ${score}` : ''}. ${game.legs} legs from ${game.member_count} members.`}
      style={({ pressed }) => [styles.gameRow, pressed && styles.pressed]}>
      <View style={styles.flex}>
        <View style={styles.rowCenter}>
          {live && <View style={styles.liveDot} />}
          <Text style={[styles.kicker, live && { color: Colors.text }]}>{live ? 'Live' : final ? 'Final' : 'Upcoming'}</Text>
        </View>
        <View style={styles.rowCenter}>
          <Display style={styles.gameTeams}>{matchup}</Display>
          {score && <Text style={[styles.mono, { fontSize: 16 }]}>{score}</Text>}
        </View>
        <Text style={styles.soft}>
          {game.legs} {game.legs === 1 ? 'leg' : 'legs'} · {game.member_count} {game.member_count === 1 ? 'member' : 'members'}
          {game.alive > 0 && !final ? ` · ${game.alive} alive` : ''}
        </Text>
      </View>
      <AvatarStack members={game.members.slice(0, 3)} extra={Math.max(0, game.member_count - 3)} />
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={Colors.textSecondary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M9 6l6 6-6 6" />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 3, gap: Spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { color: Colors.text, fontSize: 32, lineHeight: 36 },
  add: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.pill, padding: 4 },
  tab: { flex: 1, minHeight: 38, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: Colors.tileRaised },
  tabText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: Colors.text },
  soft: { color: Colors.textSecondary, fontSize: 12 },
  softText: { color: Colors.textSecondary },
  softCenter: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  body: { color: Colors.text, fontSize: 13 },
  name: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  mono: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 13 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  sweat: {
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: '#213a1c',
    backgroundColor: '#13201a',
  },
  statRow: { flexDirection: 'row', gap: Spacing.sm },
  stat: { flex: 1, gap: 2 },
  statValue: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 24 },
  closest: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.bg, borderRadius: Radius.md, padding: Spacing.md },
  closestTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  consensus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  consensusTitle: { color: Colors.text, fontSize: 15, fontWeight: '600', marginTop: 2 },
  chips: { gap: Spacing.sm },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipText: { color: Colors.text, fontSize: 13 },
  chipTextOn: { color: '#06110a', fontWeight: '700' },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  emptyButton: { marginTop: Spacing.sm, minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.xl, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  emptyButtonText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  podiumCard: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  podiumFirst: {
    paddingTop: 18,
    borderColor: 'rgba(250,204,21,0.45)',
    backgroundColor: '#1d1a0e',
    shadowColor: '#facc15',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  table: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, overflow: 'hidden' },
  tableHead: { paddingVertical: Spacing.sm },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rankCol: { width: 20 },
  numCol: { width: 56, textAlign: 'right' },
  section: { color: Colors.text, fontSize: 18 },
  trophies: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  trophy: {
    flexBasis: '48%',
    flexGrow: 1,
    gap: 4,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  panel: { gap: 6, padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  splitTrack: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: Colors.tileRaised },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  gameTeams: { color: Colors.text, fontSize: 20 },
  disclaimer: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: Spacing.lg },
});
