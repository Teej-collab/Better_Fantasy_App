import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ANTON, Elite, EliteCard, EliteSegmented, StatTile, eliteText } from '@/components/elite/Elite';
import { Text } from '@/components/Text';
import { LoadingState, MessageState, TeamAvatar } from '@/components/ui';
import { haptics } from '@/lib/haptics';
import { useMe, useSchedule } from '@/lib/queries';
import type { ScheduleMatchup, ScheduleSide, ScheduleWeek, SeasonSchedule } from '@/lib/types';

// The Schedule (2026-11-08): the whole season, which used to take a trip
// through Standings > Scores one week at a time. By Week is every game
// of a week, opening on this one; My Season is your own run, top to
// bottom. Headlines from the schedule builder (Season Opener, Rivalry
// Week…) ride along on their games.

const LIVE = Elite.green;
const WIN = Elite.green;
const LOSS = '#ff6b5a';
const CHIP_W = 56;

function openMatchup(id: number) {
  haptics.tap();
  router.push({ pathname: '/matchup/[id]', params: { id: String(id) } });
}

function statusLabel(w: ScheduleWeek): string {
  if (w.status === 'live') return 'This week';
  return w.status === 'final' ? 'Final' : 'Upcoming';
}

// Your side first, then theirs.
function sides(m: ScheduleMatchup, ownerId: number | null): [ScheduleSide, ScheduleSide] {
  return m.away.owner_id !== null && m.away.owner_id === ownerId ? [m.away, m.home] : [m.home, m.away];
}

function result(me: ScheduleSide, them: ScheduleSide): 'W' | 'L' | 'T' | null {
  if (me.score === null || them.score === null) return null;
  return me.score > them.score ? 'W' : me.score < them.score ? 'L' : 'T';
}

export function ScheduleSection({ season }: { season: number | null }) {
  const q = useSchedule(season);
  const ownerId = useMe().data?.owner_id ?? null;
  const [view, setView] = useState<'week' | 'mine'>('week');

  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load the schedule." actionLabel="Try again" onAction={() => void q.refetch()} />;
  if (q.data.weeks.length === 0) {
    return <MessageState message="No schedule yet. It comes out once the draft is done." />;
  }
  const inLeague = ownerId !== null && q.data.weeks.some((w) => w.matchups.some((m) => m.home.owner_id === ownerId || m.away.owner_id === ownerId));

  return (
    <View style={styles.gap}>
      {inLeague && (
        <EliteSegmented
          options={[
            { key: 'week', label: 'By Week' },
            { key: 'mine', label: 'My Season' },
          ]}
          value={view}
          onChange={setView}
        />
      )}
      {view === 'mine' && inLeague ? <MySeason data={q.data} ownerId={ownerId} /> : <ByWeek data={q.data} ownerId={ownerId} />}
    </View>
  );
}

// ---- By Week ----

function ByWeek({ data, ownerId }: { data: SeasonSchedule; ownerId: number | null }) {
  const opening = data.weeks.find((w) => w.week === data.current_week) ?? data.weeks.find((w) => w.status !== 'final') ?? data.weeks[data.weeks.length - 1];
  const [picked, setPicked] = useState(opening.week);
  const week = data.weeks.find((w) => w.week === picked) ?? opening;
  const strip = useRef<ScrollView>(null);
  const index = data.weeks.findIndex((w) => w.week === week.week);
  useEffect(() => {
    strip.current?.scrollTo({ x: Math.max(0, index * (CHIP_W + 8) - CHIP_W * 2), animated: true });
  }, [index]);

  const mineFirst = [...week.matchups].sort((a, b) => Number(isMine(b, ownerId)) - Number(isMine(a, ownerId)));
  const headlines = [...new Set(week.matchups.map((m) => m.headline).filter((h): h is string => !!h))];

  return (
    <View style={styles.gap}>
      <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {data.weeks.map((w) => (
          <WeekChip key={w.week} week={w} on={w.week === week.week} onPress={() => setPicked(w.week)} />
        ))}
      </ScrollView>

      <EliteCard tone={week.status === 'live' ? 'green' : 'plain'} style={styles.weekHead}>
        <Pressable
          disabled={index <= 0}
          onPress={() => {
            haptics.select();
            setPicked(data.weeks[index - 1].week);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          style={[styles.arrow, index <= 0 && styles.hidden]}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>
        <View style={styles.weekHeadMid}>
          <Text style={[eliteText.kickerCaps, week.status === 'live' && { color: LIVE }]}>
            {week.is_playoff ? 'PLAYOFFS · ' : ''}
            {statusLabel(week).toUpperCase()}
          </Text>
          <Text style={styles.weekTitle}>WEEK {week.week}</Text>
          {headlines.map((h) => (
            <Text key={h} style={styles.headline}>
              {h.toUpperCase()}
            </Text>
          ))}
        </View>
        <Pressable
          disabled={index >= data.weeks.length - 1}
          onPress={() => {
            haptics.select();
            setPicked(data.weeks[index + 1].week);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Next week"
          style={[styles.arrow, index >= data.weeks.length - 1 && styles.hidden]}>
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </EliteCard>

      {mineFirst.map((m) => (
        <GameCard key={m.matchup_id} matchup={m} week={week} records={data.records} mine={isMine(m, ownerId)} ownerId={ownerId} />
      ))}
    </View>
  );
}

function isMine(m: ScheduleMatchup, ownerId: number | null): boolean {
  return ownerId !== null && (m.home.owner_id === ownerId || m.away.owner_id === ownerId);
}

function WeekChip({ week, on, onPress }: { week: ScheduleWeek; on: boolean; onPress: () => void }) {
  const live = week.status === 'live';
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`Week ${week.week}, ${statusLabel(week)}${week.is_playoff ? ', playoffs' : ''}`}
      style={[styles.chip, week.is_playoff && styles.chipPlayoff, live && styles.chipLive, on && styles.chipOn]}>
      <Text style={[styles.chipWk, on && styles.chipTextOn]}>{week.is_playoff ? '🏆' : 'WK'}</Text>
      <Text style={[styles.chipNum, week.status === 'final' && !on && styles.dim, on && styles.chipTextOn]}>{week.week}</Text>
      {live && !on ? <View style={styles.liveDot} /> : null}
    </Pressable>
  );
}

function GameCard({
  matchup,
  week,
  records,
  mine,
  ownerId,
}: {
  matchup: ScheduleMatchup;
  week: ScheduleWeek;
  records: Record<string, string>;
  mine: boolean;
  ownerId: number | null;
}) {
  const [a, b] = sides(matchup, ownerId);
  return (
    <EliteCard tone={mine ? 'orange' : 'plain'} style={styles.game}>
      {(mine || matchup.headline) && (
        <View style={styles.gameTags}>
          {mine && <Text style={[eliteText.kickerCaps, { color: Elite.peach }]}>YOUR MATCHUP</Text>}
          {matchup.headline && <Text style={styles.tag}>{matchup.headline.toUpperCase()}</Text>}
        </View>
      )}
      <TeamRow side={a} other={b} week={week} record={records[String(a.team_id)]} onPress={() => openMatchup(matchup.matchup_id)} />
      <TeamRow side={b} other={a} week={week} record={records[String(b.team_id)]} onPress={() => openMatchup(matchup.matchup_id)} />
    </EliteCard>
  );
}

function TeamRow({ side, other, week, record, onPress }: { side: ScheduleSide; other: ScheduleSide; week: ScheduleWeek; record?: string; onPress: () => void }) {
  const won = side.score !== null && other.score !== null && side.score > other.score;
  const lost = side.score !== null && other.score !== null && side.score < other.score;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.teamRow, pressed && styles.pressed]}>
      <TeamAvatar name={side.owner_name ?? side.team_name} logoUrl={side.logo_url} size={40} />
      <View style={styles.flex}>
        <Text style={[eliteText.name, week.status === 'final' && lost && styles.dim]} numberOfLines={1}>
          {side.team_name}
        </Text>
        <Text style={eliteText.small} numberOfLines={1}>
          {side.owner_name}
          {record ? ` · ${record}` : ''}
        </Text>
      </View>
      {week.status === 'upcoming' ? (
        <Text style={styles.scoreNone}>—</Text>
      ) : (
        <Text style={[styles.score, week.status === 'final' && won && styles.scoreWon, week.status === 'final' && lost && styles.dim, week.status === 'live' && won && styles.scoreLive]}>
          {side.score !== null ? side.score.toFixed(1) : '—'}
        </Text>
      )}
    </Pressable>
  );
}

// ---- My Season ----

function MySeason({ data, ownerId }: { data: SeasonSchedule; ownerId: number | null }) {
  const games = data.weeks.map((w) => {
    const m = w.matchups.find((x) => isMine(x, ownerId)) ?? null;
    return { week: w, matchup: m, pair: m ? sides(m, ownerId) : null };
  });
  const myTeamId = games.find((g) => g.pair)?.pair?.[0].team_id;
  const record = myTeamId !== undefined ? data.records[String(myTeamId)] : undefined;
  const next = games.find((g) => g.week.status !== 'final' && g.pair);
  const left = games.filter((g) => g.week.status === 'upcoming' && !g.week.is_playoff && g.pair).length;
  const firstPlayoff = games.findIndex((g) => g.week.is_playoff);

  return (
    <View style={styles.gap}>
      <View style={styles.tiles}>
        <StatTile value={record ?? '0-0'} caption="Record" color={Elite.green} />
        <StatTile value={next?.pair ? (next.pair[1].owner_name ?? next.pair[1].team_name).split(' ')[0] : '—'} caption={next?.week.status === 'live' ? 'This week' : 'Next up'} />
        <StatTile value={String(left)} caption="Games left" />
      </View>
      <EliteCard>
        {games.map((g, i) => (
          <View key={g.week.week}>
            {i === firstPlayoff && (
              <Text style={[eliteText.kickerCaps, styles.playoffLabel]}>🏆 PLAYOFFS</Text>
            )}
            <SeasonRow week={g.week} matchup={g.matchup} pair={g.pair} records={data.records} first={i === 0 || i === firstPlayoff} />
          </View>
        ))}
      </EliteCard>
    </View>
  );
}

function SeasonRow({
  week,
  matchup,
  pair,
  records,
  first,
}: {
  week: ScheduleWeek;
  matchup: ScheduleMatchup | null;
  pair: [ScheduleSide, ScheduleSide] | null;
  records: Record<string, string>;
  first: boolean;
}) {
  const live = week.status === 'live';
  const content = (
    <>
      <View style={styles.wkCol}>
        <Text style={styles.wkLabel}>WK</Text>
        <Text style={[styles.wkNum, live && { color: LIVE }]}>{week.week}</Text>
      </View>
      {pair ? (
        <>
          <TeamAvatar name={pair[1].owner_name ?? pair[1].team_name} logoUrl={pair[1].logo_url} size={36} />
          <View style={styles.flex}>
            <Text style={eliteText.name} numberOfLines={1}>
              vs {pair[1].team_name}
            </Text>
            <Text style={eliteText.small} numberOfLines={1}>
              {pair[1].owner_name}
              {records[String(pair[1].team_id)] ? ` · ${records[String(pair[1].team_id)]}` : ''}
            </Text>
            {matchup?.headline ? <Text style={styles.rowTag}>{matchup.headline.toUpperCase()}</Text> : null}
          </View>
          <Outcome week={week} me={pair[0]} them={pair[1]} />
        </>
      ) : (
        <Text style={[eliteText.small, styles.flex]}>{week.is_playoff ? 'No game' : 'Bye'}</Text>
      )}
    </>
  );
  const rowStyle = [styles.seasonRow, !first && styles.divided, live && styles.seasonRowLive];
  return matchup ? (
    <Pressable onPress={() => openMatchup(matchup.matchup_id)} accessibilityRole="button" style={({ pressed }) => [...rowStyle, pressed && styles.pressed]}>
      {content}
    </Pressable>
  ) : (
    <View style={rowStyle}>{content}</View>
  );
}

function Outcome({ week, me, them }: { week: ScheduleWeek; me: ScheduleSide; them: ScheduleSide }) {
  if (week.status === 'upcoming') return <Text style={styles.upcoming}>{week.is_playoff ? 'Playoffs' : 'Upcoming'}</Text>;
  const r = result(me, them);
  const scores = me.score !== null && them.score !== null ? `${me.score.toFixed(1)}–${them.score.toFixed(1)}` : '—';
  if (week.status === 'live') {
    return (
      <View style={styles.alignEnd}>
        <Text style={[styles.pill, styles.pillLive]}>LIVE</Text>
        <Text style={styles.pillScore}>{scores}</Text>
      </View>
    );
  }
  const color = r === 'W' ? WIN : r === 'L' ? LOSS : Elite.cream;
  return (
    <View style={styles.alignEnd}>
      <Text style={[styles.pill, { color, borderColor: color }]}>{r ?? '—'}</Text>
      <Text style={styles.pillScore}>{scores}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  alignEnd: { alignItems: 'flex-end', gap: 4 },
  pressed: { opacity: 0.75 },
  dim: { opacity: 0.5 },
  hidden: { opacity: 0 },
  strip: { gap: 8, paddingVertical: 2 },
  chip: {
    width: CHIP_W,
    height: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(57,255,20,0.22)',
    backgroundColor: Elite.cell,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipPlayoff: { borderColor: 'rgba(255,122,26,0.5)' },
  chipLive: { borderColor: Elite.green },
  chipOn: { backgroundColor: Elite.green, borderColor: Elite.green, shadowColor: Elite.green, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  chipWk: { color: Elite.faint, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  chipNum: { fontFamily: ANTON, color: Elite.cream, fontSize: 22, lineHeight: 26 },
  chipTextOn: { color: '#06110a', opacity: 1 },
  liveDot: { position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: Elite.green },
  weekHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 10 },
  weekHeadMid: { flex: 1, alignItems: 'center', gap: 2 },
  weekTitle: { fontFamily: ANTON, color: Elite.cream, fontSize: 34, lineHeight: 40, letterSpacing: 1 },
  headline: { color: Elite.orange, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  arrow: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: Elite.cell },
  arrowText: { color: Elite.green, fontSize: 24, fontWeight: '700', lineHeight: 28 },
  game: { paddingHorizontal: 14, paddingVertical: 8 },
  gameTags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 6, paddingBottom: 2 },
  tag: { color: Elite.orange, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, borderWidth: 1, borderColor: 'rgba(255,122,26,0.5)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  score: { fontFamily: ANTON, color: Elite.cream, fontSize: 24, lineHeight: 30 },
  scoreWon: { color: WIN, textShadowColor: 'rgba(57,255,20,0.5)', textShadowRadius: 8 },
  scoreLive: { color: LIVE },
  scoreNone: { fontFamily: ANTON, color: Elite.grey, fontSize: 22 },
  tiles: { flexDirection: 'row', gap: 8 },
  playoffLabel: { color: Elite.orange, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 2 },
  seasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  seasonRowLive: { backgroundColor: 'rgba(57,255,20,0.07)' },
  divided: { borderTopWidth: 1, borderTopColor: Elite.line },
  wkCol: { width: 30, alignItems: 'center' },
  wkLabel: { color: Elite.faint, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  wkNum: { fontFamily: ANTON, color: Elite.cream, fontSize: 20, lineHeight: 24 },
  rowTag: { color: Elite.orange, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 3 },
  upcoming: { color: Elite.faint, fontSize: 12, fontWeight: '700' },
  pill: { fontFamily: ANTON, fontSize: 14, lineHeight: 18, minWidth: 28, textAlign: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, overflow: 'hidden' },
  pillLive: { color: LIVE, borderColor: LIVE, fontSize: 11, lineHeight: 16, letterSpacing: 1 },
  pillScore: { color: Elite.soft, fontSize: 11, fontVariant: ['tabular-nums'] },
});
