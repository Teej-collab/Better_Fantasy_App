import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ANTON, Elite, EliteCard, EliteSegmented, Hex } from '@/components/elite/Elite';
import { LivesPips, pctColor, TeamLogo } from '@/components/survivor/SurvivorKit';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatGameTimeShort } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';
import type { SurvivorBoard, SurvivorBoardTeam, SurvivorPlanner } from '@/lib/survivorTypes';

// The week's pick (2026-11-07, canvas "Elite Survivor Pools": the
// Ladder, with the Hive as a toggle). The Ladder lists the teams you
// haven't used, best win chance first; the Hive shows all 32 as a
// honeycomb; the Planner lays out your unused teams week by week. Each
// pick locks at its own kickoff.
type View3 = 'ladder' | 'hive' | 'planner';
type BoardTeam = SurvivorBoardTeam & { kickoff: string | null };

export default function SurvivorPickScreen() {
  const { entry } = useLocalSearchParams<{ entry: string }>();
  const entryId = Number(entry);
  const q = useQuery({ queryKey: ['survivor-board', entryId], queryFn: () => api.survivorBoard(entryId), enabled: Number.isFinite(entryId) });
  const [view, setView] = useState<View3>('ladder');
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load this week's games." actionLabel="Try again" onAction={() => void q.refetch()} />;
  const board = q.data;
  const teams: BoardTeam[] = board.games.flatMap((g) => g.teams.map((t) => ({ ...t, kickoff: g.kickoff })));
  const byTeam = new Map(teams.map((t) => [t.team, t]));
  const saved = board.picks.flatMap((p) => (!p.hidden && p.team ? [p.team] : []));
  const lockedPicks = board.picks.flatMap((p) => (!p.hidden && p.team && p.locked ? [p.team] : []));
  const picks = chosen ?? saved;
  const out = board.eliminated_week !== null;
  const canPick = board.can_pick && !out;

  function toggle(team: string) {
    const t = byTeam.get(team);
    if (!t || t.locked || t.used_week !== null || !canPick) return;
    haptics.select();
    const current = picks;
    if (current.includes(team)) {
      if (lockedPicks.includes(team)) return;
      setChosen(current.filter((x) => x !== team));
      return;
    }
    const game = board.games.find((g) => g.teams.some((x) => x.team === team));
    const sameGame = current.find((x) => game?.teams.some((g) => g.team === x));
    let next = sameGame ? current.filter((x) => x !== sameGame || lockedPicks.includes(x)) : current;
    if (next.length >= board.slots) {
      const replaceable = next.filter((x) => !lockedPicks.includes(x));
      if (replaceable.length === 0) return;
      next = next.filter((x) => x !== replaceable[replaceable.length - 1]);
    }
    setChosen([...next, team]);
  }

  async function save() {
    setSaving(true);
    try {
      const next = await api.setSurvivorPicks(entryId, picks);
      queryClient.setQueryData(['survivor-board', entryId], next);
      setChosen(null);
      haptics.success();
      void queryClient.invalidateQueries({ queryKey: ['survivor-pools'] });
      void queryClient.invalidateQueries({ queryKey: ['survivor-pool', next.pool.id] });
    } catch (e) {
      haptics.error();
      Alert.alert("Couldn't save your pick", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function buyBack() {
    try {
      await api.survivorBuyBack(entryId);
      haptics.success();
      await q.refetch();
      void queryClient.invalidateQueries({ queryKey: ['survivor-pools'] });
    } catch (e) {
      Alert.alert("Couldn't buy back in", e instanceof Error ? e.message : 'Try again.');
    }
  }

  const dirty = chosen !== null && (chosen.length !== saved.length || chosen.some((t) => !saved.includes(t)));
  const first = picks.map((t) => byTeam.get(t)).filter((t): t is BoardTeam => Boolean(t));

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: board.pool.name }} />
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.head}>
          <View style={styles.flex}>
            <Text style={styles.title} accessibilityRole="header">
              WEEK {board.week} PICK
            </Text>
            <Text style={styles.sub}>
              {board.pool.name}
              {board.entry_no > 1 ? ` · Entry ${board.entry_no}` : ''}
              {board.slots === 2 ? ' · two picks this week' : ''}
            </Text>
          </View>
          {!out && (
            <View style={styles.lives}>
              <LivesPips left={board.lives_left} total={board.lives_total} />
              <Text style={styles.faint}>{board.lives_left === 1 ? '1 life left' : `${board.lives_left} lives left`}</Text>
            </View>
          )}
        </View>

        {out && (
          <EliteCard tone="orange" style={styles.gap}>
            <Text style={styles.outTitle}>You&apos;re out (week {board.eliminated_week})</Text>
            {board.can_buy_back ? (
              <Pressable onPress={() => void buyBack()} style={styles.solid} accessibilityRole="button">
                <Text style={styles.solidText}>Buy back in with one life</Text>
              </Pressable>
            ) : (
              <Text style={styles.muted}>You can still follow the Field.</Text>
            )}
          </EliteCard>
        )}

        <EliteSegmented<View3>
          options={[
            { key: 'ladder', label: 'Best odds' },
            { key: 'hive', label: 'Hive' },
            { key: 'planner', label: 'Planner' },
          ]}
          value={view}
          onChange={setView}
        />
        {view !== 'planner' && <Text style={styles.faint}>Each pick locks at its own kickoff. Other people&apos;s picks show once a game starts.</Text>}

        {view === 'ladder' && <Ladder teams={teams} picks={picks} onPick={toggle} used={board.used} />}
        {view === 'hive' && <Hive board={board} teams={byTeam} picks={picks} onPick={toggle} />}
        {view === 'planner' && <Planner entryId={entryId} />}
      </ScrollView>

      {view !== 'planner' && canPick && (
        <View style={styles.footer}>
          {first.length > 0 ? (
            <View style={styles.footRow}>
              {first.map((t) => (
                <TeamLogo key={t.team} team={t.team} size={28} />
              ))}
              <Text style={[styles.footText, styles.flex]} numberOfLines={2}>
                {first.map((t) => `${t.team} ${t.home ? 'vs' : '@'} ${t.opponent}`).join(' + ')}
                {first[0]?.kickoff ? ` · locks ${formatGameTimeShort(first[0].kickoff)}` : ''}
              </Text>
            </View>
          ) : (
            <Text style={styles.footText}>Tap a team to pick it.</Text>
          )}
          <Pressable
            onPress={() => void save()}
            disabled={!dirty || saving || picks.length === 0}
            style={[styles.lockIn, (!dirty || saving || picks.length === 0) && styles.disabled]}
            accessibilityRole="button">
            <Text style={styles.lockInText}>
              {saving
                ? 'Saving…'
                : !dirty && saved.length > 0
                  ? `Locked in: ${saved.join(' + ')}`
                  : first.length === 1 && first[0].win_pct !== null
                    ? `Lock in ${first[0].team} · ${first[0].win_pct}% to win`
                    : `Lock in ${picks.join(' + ') || 'your pick'}`}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Ladder({ teams, picks, onPick, used }: { teams: BoardTeam[]; picks: string[]; onPick: (t: string) => void; used: { team: string; week: number }[] }) {
  const available = teams.filter((t) => t.used_week === null).sort((a, b) => (b.win_pct ?? -1) - (a.win_pct ?? -1));
  const usedPlaying = teams.filter((t) => t.used_week !== null);
  const [showUsed, setShowUsed] = useState(false);
  return (
    <View style={styles.gap6}>
      {available.map((t, i) => {
        const on = picks.includes(t.team);
        const color = pctColor(t.win_pct);
        return (
          <Pressable
            key={t.team}
            onPress={() => onPick(t.team)}
            disabled={t.locked && !on}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: t.locked }}
            accessibilityLabel={`${t.team} ${t.home ? 'versus' : 'at'} ${t.opponent}, ${t.win_pct === null ? 'no line yet' : `${t.win_pct}% to win`}${t.locked ? ', locked' : ''}`}
            style={[styles.row, on && styles.rowOn, t.locked && !on && styles.rowLocked]}>
            <Text style={styles.rank}>{i + 1}</Text>
            <TeamLogo team={t.team} size={34} />
            <View style={styles.flex}>
              <Text style={styles.rowTeam}>
                {t.team} <Text style={styles.rowVs}>{t.home ? 'vs' : '@'} {t.opponent}</Text>
              </Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${t.win_pct ?? 0}%`, backgroundColor: color }]} />
              </View>
            </View>
            <View style={styles.rowRight}>
              <Text style={[styles.pct, { color }]}>{t.win_pct === null ? '—' : `${t.win_pct}%`}</Text>
              <Text style={styles.faint}>{t.locked ? 'Locked' : t.kickoff ? formatGameTimeShort(t.kickoff) : ''}</Text>
            </View>
          </Pressable>
        );
      })}
      {usedPlaying.length > 0 && (
        <Pressable onPress={() => setShowUsed((v) => !v)} style={styles.usedRow} accessibilityRole="button">
          <View style={styles.usedLogos}>
            {usedPlaying.slice(0, 6).map((t) => (
              <TeamLogo key={t.team} team={t.team} size={18} dim />
            ))}
          </View>
          <Text style={[styles.faint, styles.flex]}>
            {usedPlaying.length} {usedPlaying.length === 1 ? 'team' : 'teams'} you&apos;ve used play this week
          </Text>
          <Text style={styles.faint}>{showUsed ? 'Hide' : 'Show'}</Text>
        </Pressable>
      )}
      {showUsed &&
        usedPlaying.map((t) => (
          <View key={t.team} style={[styles.row, styles.rowLocked]}>
            <TeamLogo team={t.team} size={28} dim />
            <Text style={[styles.rowVs, styles.flex]}>
              {t.team} · used in week {t.used_week}
            </Text>
          </View>
        ))}
      {used.length > 0 && <Text style={styles.faint}>Used so far: {used.map((u) => `W${u.week} ${u.team}`).join(' · ')}</Text>}
    </View>
  );
}

const ALL_TEAMS = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WSH'];

function Hive({ board, teams, picks, onPick }: { board: SurvivorBoard; teams: Map<string, BoardTeam>; picks: string[]; onPick: (t: string) => void }) {
  const { width } = useWindowDimensions();
  const cell = Math.min(60, Math.floor((width - Spacing.lg * 2 - 5 * 4) / 6));
  const usedWeek = new Map(board.used.map((u) => [u.team, u.week]));
  const rank = (t: string) => {
    const b = teams.get(t);
    if (!b) return 3000 + ALL_TEAMS.indexOf(t);
    if (b.used_week !== null) return 2000 + ALL_TEAMS.indexOf(t);
    return 1000 - (b.win_pct ?? 50);
  };
  const order = [...ALL_TEAMS].sort((a, b) => rank(a) - rank(b));
  const rows: string[][] = [];
  let i = 0;
  for (const n of [6, 5, 6, 5, 6, 4]) {
    rows.push(order.slice(i, i + n));
    i += n;
  }
  const picked = picks.map((t) => teams.get(t)).filter(Boolean) as BoardTeam[];
  return (
    <View style={styles.gap}>
      <View style={styles.hive}>
        {rows.map((row, r) => (
          <View key={r} style={[styles.hiveRow, r > 0 && { marginTop: -cell * 0.27 }]}>
            {row.map((team) => {
              const b = teams.get(team);
              const dim = !b || b.used_week !== null || (b.locked && !picks.includes(team));
              const on = picks.includes(team);
              const color = dim ? '#3a414b' : on ? Elite.cream : pctColor(b?.win_pct);
              const tag = !b ? 'BYE' : b.used_week !== null ? `W${b.used_week}` : b.win_pct === null ? '—' : `${b.win_pct}%`;
              return (
                <Pressable
                  key={team}
                  onPress={() => onPick(team)}
                  disabled={dim}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: dim }}
                  accessibilityLabel={`${team}, ${!b ? 'bye' : b.used_week !== null ? `used in week ${b.used_week}` : b.win_pct === null ? 'no line yet' : `${b.win_pct}% to win`}`}>
                  <Hex width={cell} color={color} fill={on ? '#16290f' : dim ? '#12161c' : Elite.card} glow={on} strokeWidth={on ? 3 : 2}>
                    <TeamLogo team={team} size={cell * 0.48} dim={dim} />
                    <Text style={[styles.hexTag, { color: dim ? Elite.grey : color }]}>{tag}</Text>
                  </Hex>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      {picked.length === 0 && usedWeek.size === 0 ? null : (
        <Text style={styles.faint}>Brighter rims are bigger favorites. Used and bye teams are dimmed.</Text>
      )}
    </View>
  );
}

function Planner({ entryId }: { entryId: number }) {
  const q = useQuery({ queryKey: ['survivor-planner', entryId], queryFn: () => api.survivorPlanner(entryId), staleTime: 5 * 60_000 });
  const [plan, setPlan] = useState<Record<string, true>>({});
  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load the planner." actionLabel="Try again" onAction={() => void q.refetch()} />;
  const data: SurvivorPlanner = q.data;
  const keys = Object.keys(plan);
  let odds = 1;
  for (const key of keys) {
    const [team, week] = key.split('-');
    const row = data.rows.find((r) => r.team === team);
    const cellData = row?.weeks[data.weeks.indexOf(Number(week))];
    if (cellData?.win_pct) odds *= cellData.win_pct / 100;
  }
  return (
    <View style={styles.gap}>
      <Text style={styles.muted}>
        Your unused teams, week by week. This week&apos;s numbers come from Vegas; later weeks are projected from our ratings until lines post.
        {data.double_weeks.length ? ` Two picks a week from week ${data.double_weeks[0]}.` : ''} Tap cells to sketch a path.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.grid}>
          <View style={styles.gridRow}>
            <View style={styles.gridTeam} />
            {data.weeks.map((w) => (
              <View key={w} style={styles.gridHead}>
                {data.double_weeks.includes(w) && <Text style={styles.double}>×2</Text>}
                <Text style={styles.faint}>W{w}</Text>
              </View>
            ))}
          </View>
          {data.rows.map((r) => (
            <View key={r.team} style={styles.gridRow}>
              <View style={styles.gridTeam}>
                <TeamLogo team={r.team} size={20} />
                <Text style={styles.gridTeamText}>{r.team}</Text>
              </View>
              {r.weeks.map((c, i) => {
                const key = `${r.team}-${data.weeks[i]}`;
                const on = Boolean(plan[key]);
                const pct = c?.win_pct ?? null;
                const bg = !c ? '#0b0e12' : pct === null ? '#1b222c' : pct >= 70 ? 'rgba(57,255,20,0.55)' : pct >= 62 ? 'rgba(57,255,20,0.32)' : pct >= 55 ? 'rgba(157,255,134,0.16)' : pct >= 50 ? '#1b222c' : 'rgba(255,122,26,0.16)';
                return (
                  <Pressable
                    key={key}
                    disabled={!c}
                    onPress={() => {
                      haptics.select();
                      setPlan((p) => {
                        const next = { ...p };
                        if (next[key]) delete next[key];
                        else next[key] = true;
                        return next;
                      });
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${r.team} week ${data.weeks[i]}: ${!c ? 'bye' : pct === null ? `vs ${c.opponent}, no number yet` : `${c.home ? 'vs' : 'at'} ${c.opponent}, ${pct}%`}`}
                    style={[styles.gridCell, { backgroundColor: bg }, on && styles.gridCellOn]}>
                    <Text style={[styles.gridCellText, !c && styles.faint]}>{!c ? 'BYE' : pct === null ? '·' : pct}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {keys.length > 0 && (
        <EliteCard tone="green" style={styles.gap6}>
          <Text style={styles.planTitle}>YOUR PATH · {keys.length} picks</Text>
          <Text style={styles.muted}>
            {keys
              .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
              .map((k) => `W${k.split('-')[1]} ${k.split('-')[0]}`)
              .join(' · ')}
          </Text>
          <Text style={styles.footText}>
            Chance every one of them wins: <Text style={styles.planOdds}>{Math.round(odds * 100)}%</Text>
          </Text>
        </EliteCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Elite.deep },
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 160 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontFamily: ANTON, fontSize: 30, color: Elite.green, textShadowColor: 'rgba(57,255,20,0.4)', textShadowRadius: 14 },
  sub: { color: Elite.soft, fontSize: 12 },
  lives: { alignItems: 'flex-end', gap: 4 },
  faint: { color: Elite.faint, fontSize: 11 },
  muted: { color: Elite.soft, fontSize: 12, lineHeight: 17 },
  gap: { gap: 10 },
  gap6: { gap: 6 },
  outTitle: { color: Elite.cream, fontSize: 16, fontWeight: '800' },
  solid: { minHeight: 44, borderRadius: 14, backgroundColor: Elite.green, alignItems: 'center', justifyContent: 'center' },
  solidText: { color: Elite.deep, fontSize: 14, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: Elite.card, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.06)', minHeight: 56 },
  rowOn: { backgroundColor: 'rgba(57,255,20,0.10)', borderColor: Elite.green },
  rowLocked: { opacity: 0.5 },
  rank: { width: 18, fontFamily: ANTON, fontSize: 14, color: Elite.grey, textAlign: 'center' },
  rowTeam: { color: Elite.cream, fontSize: 15, fontWeight: '800' },
  rowVs: { color: Elite.soft, fontSize: 12, fontWeight: '500' },
  bar: { height: 5, borderRadius: 3, backgroundColor: '#222a35', overflow: 'hidden', marginTop: 4 },
  barFill: { height: '100%' },
  rowRight: { alignItems: 'flex-end', width: 70, gap: 2 },
  pct: { fontFamily: ANTON, fontSize: 20 },
  usedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.12)', minHeight: 44 },
  usedLogos: { flexDirection: 'row', gap: 3 },
  hive: { alignItems: 'center' },
  hiveRow: { flexDirection: 'row', gap: 4 },
  hexTag: { fontFamily: ANTON, fontSize: 11 },
  grid: { gap: 3 },
  gridRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridTeam: { width: 54, flexDirection: 'row', alignItems: 'center', gap: 4 },
  gridTeamText: { color: Elite.cream, fontSize: 10, fontWeight: '700' },
  gridHead: { width: 38, alignItems: 'center' },
  double: { fontSize: 8, fontWeight: '800', color: Elite.deep, backgroundColor: Elite.orange, paddingHorizontal: 3, borderRadius: 3, overflow: 'hidden' },
  gridCell: { width: 38, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  gridCellOn: { borderColor: Elite.green },
  gridCellText: { color: Elite.cream, fontSize: 11, fontWeight: '700' },
  planTitle: { fontFamily: ANTON, fontSize: 15, color: Elite.cream },
  planOdds: { color: Elite.green, fontWeight: '800' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, paddingBottom: 30, backgroundColor: '#0b0f14', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', gap: 8 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footText: { color: Elite.soft, fontSize: 13 },
  lockIn: { minHeight: 50, borderRadius: 14, backgroundColor: Elite.green, alignItems: 'center', justifyContent: 'center' },
  lockInText: { color: Elite.deep, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.55 },
});
