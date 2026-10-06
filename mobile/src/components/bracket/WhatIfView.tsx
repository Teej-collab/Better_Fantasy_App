import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { GameCard } from '@/components/bracket/GameCard';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { changeCount, isEmpty, ordinal, recordOf, type PlayoffWorld, type Scenario, type World, type WorldGame, type WorldTeam } from '@/lib/bracketEngine';
import type { PlayoffOdds } from '@/lib/types';

// The What-If Lab on a phone (the web's components/bracket/
// WhatIfView.tsx): flip any result, pick any game still to play, pick
// playoff winners on the bracket, then share the world.

export function WhatIfView({
  world,
  base,
  alt,
  teams,
  scenario,
  onScenario,
  me,
  onMe,
  onShare,
  shareNote,
  realOdds,
  altOdds,
}: {
  world: PlayoffWorld;
  base: World;
  alt: World;
  teams: Record<number, WorldTeam>;
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
  me: number;
  onMe: (teamId: number) => void;
  onShare: (to: 'chat' | 'sheet') => void;
  shareNote: string | null;
  realOdds: PlayoffOdds | null;
  altOdds: PlayoffOdds | null;
}) {
  const [view, setView] = useState<'mine' | number>('mine');
  const weeks = [...new Set(world.schedule.map((g) => g.week))].sort((a, b) => a - b);
  const baseRow = base.standings.find((r) => r.team_id === me)!;
  const altRow = alt.standings.find((r) => r.team_id === me)!;
  const baseSeed: Record<number, number> = {};
  for (const r of base.standings) baseSeed[r.team_id] = r.seed;
  const altRecords: Record<number, string> = {};
  for (const r of alt.standings) altRecords[r.team_id] = recordOf(r);
  const inPlayoffs = altRow.seed <= world.playoff_team_count;
  const bowlLine = world.playoff_team_count + 4;
  const bowlZone = world.games.some((g) => g.toilet_bowl) && altRow.seed > bowlLine;
  const place = alt.places[me];
  const n = changeCount(scenario);

  const choose = (g: WorldGame, team: number) => {
    haptics.tap();
    if (g.played) {
      const real = g.home_score > g.away_score ? g.home_team_id : g.away_score > g.home_score ? g.away_team_id : null;
      const flipped = scenario.flips.includes(g.id);
      if ((real === team) === flipped) {
        onScenario({ ...scenario, flips: flipped ? scenario.flips.filter((id) => id !== g.id) : [...scenario.flips, g.id] });
      }
    } else {
      const picks = { ...scenario.picks };
      if (picks[g.id] === team) delete picks[g.id];
      else picks[g.id] = team;
      onScenario({ ...scenario, picks });
    }
  };
  const allMine = (win: boolean) => {
    haptics.tap();
    const picks = { ...scenario.picks };
    for (const g of world.schedule) {
      if (g.played || (g.home_team_id !== me && g.away_team_id !== me)) continue;
      picks[g.id] = win ? me : g.home_team_id === me ? g.away_team_id : g.home_team_id;
    }
    onScenario({ ...scenario, picks });
  };
  const pickPlayoff = (code: string, team: number) => {
    haptics.tap();
    const playoff = { ...scenario.playoff };
    if (playoff[code] === team) delete playoff[code];
    else playoff[code] = team;
    onScenario({ ...scenario, playoff });
  };
  const shownOdds = isEmpty(scenario) ? realOdds : (altOdds ?? null);
  const focus = shownOdds?.focus ?? null;
  const pctFor = (o: PlayoffOdds | null, key: 'playoff_pct' | 'title_pct' | 'toilet_bowl_pct') => o?.teams.find((t) => t.team_id === me)?.[key] ?? null;
  // Root-for games come from reality so the list stays put as games are
  // added; the best path is the server's realistic one, not "win out".
  const rootList = (realOdds?.focus ?? focus)?.root_for ?? [];
  const rootFor = new Map(rootList.map((r) => [r.matchup_id, r]));
  const path = focus?.best_path ?? null;
  const bestPath = () => {
    if (!path) return;
    haptics.tap();
    const picks = { ...scenario.picks };
    for (const g of path.win_games) picks[g.matchup_id] = me;
    for (const r of path.root_for) picks[r.matchup_id] = r.root_for_team_id;
    onScenario({ ...scenario, picks });
  };
  const toggleRoot = (matchupId: number, teamId: number) => {
    haptics.tap();
    const picks = { ...scenario.picks };
    if (picks[matchupId] === teamId) delete picks[matchupId];
    else picks[matchupId] = teamId;
    onScenario({ ...scenario, picks });
  };

  const games = view === 'mine' ? world.schedule.filter((g) => g.home_team_id === me || g.away_team_id === me) : world.schedule.filter((g) => g.week === view);
  const tone = inPlayoffs ? '#39ff14' : bowlZone ? '#d9a066' : '#eceef1';

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Text style={styles.as}>PLAYING AS</Text>
        {base.standings.map((r) => (
          <Pressable key={r.team_id} onPress={() => onMe(r.team_id)} style={[styles.chip, r.team_id === me && styles.chipOn]} accessibilityRole="button">
            <Text style={[styles.chipText, r.team_id === me && styles.chipTextOn]}>{teams[r.team_id].name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.verdict, { borderColor: inPlayoffs ? '#39ff14' : bowlZone ? '#a8743c' : '#1c2027' }]}>
        <View style={styles.verdictRow}>
          <View>
            <Text style={styles.stat}>REALITY</Text>
            <Text style={styles.statValue}>
              #{baseRow.seed} · {recordOf(baseRow)}
            </Text>
          </View>
          <Text style={styles.arrow}>→</Text>
          <View>
            <Text style={[styles.stat, { color: tone }]}>WHAT IF</Text>
            <Text style={[styles.statValue, { color: tone }]}>
              #{altRow.seed} · {recordOf(altRow)}
            </Text>
          </View>
        </View>
        <Text style={styles.verdictText}>
          {inPlayoffs ? 'In the playoffs' : bowlZone ? 'In Toilet Bowl territory' : 'Out of the playoffs'}
          {place ? ` — finishes ${place === 1 ? 'as champion' : ordinal(place)}.` : '.'}
        </Text>
        <View style={styles.shareRow}>
          <Text style={styles.changes}>{n ? `${n} change${n > 1 ? 's' : ''}` : 'No changes yet'}</Text>
          <Pressable disabled={isEmpty(scenario)} onPress={() => onShare('sheet')} style={[styles.ghostBtn, isEmpty(scenario) && styles.disabled]} accessibilityRole="button">
            <Text style={styles.ghostText}>SHARE</Text>
          </Pressable>
          <Pressable disabled={isEmpty(scenario)} onPress={() => onShare('chat')} style={[styles.solidBtn, isEmpty(scenario) && styles.disabled]} accessibilityRole="button">
            <Text style={styles.solidText}>POST TO CHAT</Text>
          </Pressable>
        </View>
        {shareNote && <Text style={styles.note}>{shareNote}</Text>}
      </View>

      <View style={styles.odds}>
        <View style={styles.oddsTop}>
          <View>
            <Text style={styles.stat}>PLAYOFF CHANCE{altOdds && !isEmpty(scenario) ? ' · WHAT IF' : ''}</Text>
            <Text style={[styles.oddsBig, { color: oddsColor(pctFor(shownOdds, 'playoff_pct')) }]}>
              {!isEmpty(scenario) && realOdds ? `${pctText(pctFor(realOdds, 'playoff_pct'))} → ` : ''}
              {shownOdds ? pctText(pctFor(shownOdds, 'playoff_pct')) : '…'}
            </Text>
          </View>
          <View>
            <Text style={[styles.stat, styles.gold]}>TITLE</Text>
            <Text style={[styles.oddsSmall, styles.gold]}>{pctText(pctFor(shownOdds, 'title_pct'))}</Text>
          </View>
          <View>
            <Text style={[styles.stat, styles.bowl]}>BOWL</Text>
            <Text style={[styles.oddsSmall, styles.bowl]}>{pctText(pctFor(shownOdds, 'toilet_bowl_pct'))}</Text>
          </View>
        </View>
        {path && (
          <View style={styles.path}>
            <Text style={styles.pathTitle}>YOUR BEST PATH</Text>
            <Text style={styles.oddsLine}>
              {path.target_wins >= path.games_left ? `Win out (${path.games_left})` : `Win ${path.target_wins} of your ${path.games_left} — not all of them`}
              {path.root_for.length > 0 ? ', with a little help' : ''} → <Text style={styles.gold}>{pctText(path.path_pct)}</Text>
            </Text>
            <Text style={styles.help}>The fewest wins that got you in 75%+ of simulated seasons, from the games you’re most likely to win, plus the results that help most — then simulated again with it all locked in.</Text>
            {path.win_games.map((g) => (
              <Text key={g.matchup_id} style={styles.pathItem}>
                Wk {g.week}: beat {teams[g.opponent_team_id].name} <Text style={styles.muted}>({pctText(g.win_pct)} likely)</Text>
              </Text>
            ))}
            {path.root_for.map((r) => (
              <Text key={r.matchup_id} style={[styles.pathItem, styles.gold]}>
                Wk {r.week}: {teams[r.root_for_team_id].name} over {teams[r.against_team_id].name}
              </Text>
            ))}
            <Pressable onPress={bestPath} style={styles.bestBtn} accessibilityRole="button">
              <Text style={styles.bestText}>LIGHT IT UP</Text>
            </Pressable>
          </View>
        )}
        {focus && (
          <>
            <Text style={styles.stat}>BY WINS LEFT ({focus.games_left} GAMES)</Text>
            {focus.by_wins.slice(0, 6).map((r) => (
              <View key={r.wins} style={styles.barRow}>
                <Text style={styles.barLabel}>{r.wins === r.games_left ? 'Win out' : `Win ${r.wins}`}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${r.pct}%`, backgroundColor: r.pct >= 75 ? '#39ff14' : r.pct >= 25 ? '#f5c542' : '#d9a066' }]} />
                </View>
                <Text style={styles.barPct}>{pctText(r.pct)}</Text>
              </View>
            ))}
            {focus.next_game && (
              <Text style={styles.oddsLine}>
                Week {focus.next_game.week} vs {teams[focus.next_game.opponent_team_id].name}: <Text style={styles.win}>win → {pctText(focus.next_game.if_win_pct)}</Text>,{' '}
                <Text style={styles.loss}>lose → {pctText(focus.next_game.if_loss_pct)}</Text>
              </Text>
            )}
            <Text style={styles.stat}>ROOT FOR — THE GAMES THAT MOVE YOUR ODDS MOST</Text>
            {rootList.slice(0, 6).map((r) => {
              const added = scenario.picks[r.matchup_id] === r.root_for_team_id;
              return (
                <View key={r.matchup_id} style={[styles.root, added && styles.rootAdded]}>
                  <Text style={styles.rootText}>
                    Wk {r.week}: <Text style={styles.gold}>{teams[r.root_for_team_id].name}</Text> over {teams[r.against_team_id].name}
                    {'\n'}
                    <Text style={styles.muted}>
                      {pctText(r.pct_if_root)} if they win, {pctText(r.pct_if_other)} if not
                    </Text>
                  </Text>
                  <Pressable
                    onPress={() => toggleRoot(r.matchup_id, r.root_for_team_id)}
                    style={[styles.rootBtn, added && styles.rootBtnOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: added }}>
                    <Text style={[styles.rootBtnText, added && styles.rootBtnTextOn]}>{added ? 'Added ✓' : 'Add'}</Text>
                  </Pressable>
                </View>
              );
            })}
            <Text style={styles.help}>
              {focus.tiebreak.tied_at_cut_pct >= 1
                ? `Points for decides your spot in ${pctText(focus.tiebreak.tied_at_cut_pct)} of seasons, and you win ${pctText(focus.tiebreak.won_on_points_pct)} of those. Every point counts.`
                : 'Points for almost never decides your spot — it comes down to wins.'}
            </Text>
          </>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.h2}>{view === 'mine' ? `${teams[me].name.toUpperCase()}'S SEASON` : `WEEK ${view}`}</Text>
          <Pressable onPress={() => onScenario({ flips: [], picks: {}, playoff: {} })} style={styles.smallBtn} accessibilityRole="button">
            <Text style={styles.smallText}>RESET</Text>
          </Pressable>
        </View>
        {view === 'mine' && (
          <View style={styles.btnRow}>
            <Pressable onPress={() => allMine(true)} style={[styles.smallBtn, { borderColor: '#39ff14' }]} accessibilityRole="button">
              <Text style={[styles.smallText, { color: '#39ff14' }]}>WIN OUT</Text>
            </Pressable>
            <Pressable onPress={() => allMine(false)} style={[styles.smallBtn, { borderColor: '#a8743c' }]} accessibilityRole="button">
              <Text style={[styles.smallText, { color: '#d9a066' }]}>LOSE OUT</Text>
            </Pressable>
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekChips}>
          {(['mine', ...weeks] as const).map((wk) => (
            <Pressable key={String(wk)} onPress={() => setView(wk)} style={[styles.weekChip, view === wk && styles.weekChipOn]} accessibilityRole="button">
              <Text style={[styles.weekChipText, view === wk && styles.weekChipTextOn]}>{wk === 'mine' ? 'Mine' : `Wk ${wk}`}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={styles.help}>Tap a team to make them the winner. Played games flip; games ahead get picked. Tap again to undo.</Text>
        {games.map((g) => {
          const winner = alt.results[g.id];
          const changed = g.played ? scenario.flips.includes(g.id) : scenario.picks[g.id] !== undefined;
          const root = changed ? undefined : rootFor.get(g.id);
          return (
            <View key={g.id} style={[styles.game, changed && styles.gameChanged, root && styles.gameRoot]}>
              <Text style={[styles.gameWeek, root && styles.gameWeekRoot]} numberOfLines={2}>{root ? `ROOT ${teams[root.root_for_team_id].name.toUpperCase()}` : `WK ${g.week}`}</Text>
              {[g.home_team_id, g.away_team_id].map((t, i) => (
                <Pressable
                  key={t}
                  onPress={() => choose(g, t)}
                  style={[styles.side, winner === t && (changed ? styles.sideChanged : styles.sideWon)]}
                  accessibilityRole="button"
                  accessibilityLabel={`${teams[t].name} wins week ${g.week}`}>
                  <Text style={[styles.sideName, winner === t && styles.sideNameWon, winner === t && changed && styles.sideNameChanged]} numberOfLines={1}>
                    {teams[t].name}
                  </Text>
                  {g.played && <Text style={[styles.sideScore, winner === t && changed && styles.sideNameChanged]}>{(i === 0 ? g.home_score : g.away_score).toFixed(1)}</Text>}
                </Pressable>
              ))}
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.h2}>FINAL STANDINGS</Text>
        <View style={styles.table}>
          {alt.standings.map((r, i) => {
            const d = baseSeed[r.team_id] - r.seed;
            return (
              <View key={r.team_id}>
                <View style={[styles.tr, i % 2 === 1 && styles.trAlt, r.team_id === me && styles.trMe]}>
                  <Text style={styles.trSeed}>{r.seed}</Text>
                  <Text style={[styles.trName, r.seed > bowlLine && styles.trBowl, r.team_id === me && styles.trNameMe]}>{teams[r.team_id].name}</Text>
                  <Text style={styles.trRec}>{recordOf(r)}</Text>
                  <Text style={[styles.trDelta, { color: d > 0 ? '#39ff14' : '#f87171' }]}>{d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : ''}</Text>
                </View>
                {r.seed === world.playoff_team_count && <View style={styles.cut} />}
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.h2}>THE BRACKET, IN THIS WORLD</Text>
        <Text style={styles.help}>Tap a team to pick them; tap again to go back to the favorite.</Text>
        {alt.games.map((g) => (
          <GameCard key={g.code} game={g} all={alt.games} teams={teams} records={altRecords} punishment={world.toilet_bowl_punishment} me={me} compact onPick={(t) => pickPlayoff(g.code, t)} />
        ))}
      </View>
    </View>
  );
}

function pctText(p: number | null | undefined): string {
  if (p === null || p === undefined) return '—';
  if (p > 0 && p < 1) return '<1%';
  if (p < 100 && p > 99) return '>99%';
  return `${Math.round(p)}%`;
}

function oddsColor(p: number | null): string {
  if (p === null) return '#eceef1';
  return p >= 75 ? '#39ff14' : p <= 10 ? '#d9a066' : '#eceef1';
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  odds: { marginHorizontal: 16, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: '#1c2027', backgroundColor: '#12161c', gap: 10 },
  oddsTop: { flexDirection: 'row', alignItems: 'flex-end', gap: 20 },
  oddsBig: { fontFamily: Fonts.displayBold, fontSize: 30 },
  oddsSmall: { fontFamily: Fonts.display, fontSize: 22 },
  gold: { color: '#f5c542' },
  bowl: { color: '#d9a066' },
  bestBtn: { height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#f5c542', alignItems: 'center', justifyContent: 'center' },
  bestText: { fontFamily: Fonts.display, fontSize: 13, letterSpacing: 1, color: '#f5c542' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 64, fontSize: 13, color: '#c9cfd8' },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  barPct: { width: 44, textAlign: 'right', fontFamily: Fonts.mono, fontSize: 12, color: '#eceef1' },
  oddsLine: { fontSize: 14, color: '#dfe3ea' },
  win: { color: '#39ff14' },
  loss: { color: '#f87171' },
  root: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(245,197,66,0.4)', backgroundColor: 'rgba(245,197,66,0.06)' },
  rootText: { flex: 1, fontSize: 13, color: '#dfe3ea' },
  rootBtn: { height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(245,197,66,0.6)', justifyContent: 'center' },
  rootBtnText: { fontSize: 12, color: '#f5c542', fontWeight: '700' },
  path: { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(245,197,66,0.5)', backgroundColor: 'rgba(245,197,66,0.05)', gap: 6 },
  pathTitle: { fontFamily: Fonts.display, fontSize: 15, letterSpacing: 1, color: '#f5c542' },
  pathItem: { fontSize: 13, color: '#dfe3ea' },
  muted: { color: '#9aa3b2' },
  rootAdded: { borderColor: '#f5c542', backgroundColor: 'rgba(245,197,66,0.14)' },
  rootBtnOn: { backgroundColor: '#f5c542' },
  rootBtnTextOn: { color: '#0d1016' },
  gameRoot: { borderColor: '#f5c542', backgroundColor: 'rgba(245,197,66,0.07)' },
  gameWeekRoot: { width: 58, fontSize: 9, color: '#f5c542' },
  chips: { paddingHorizontal: 16, gap: 6, alignItems: 'center' },
  as: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 2, color: '#9aa3b2', marginRight: 4 },
  chip: { height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: '#2b3340', justifyContent: 'center' },
  chipOn: { backgroundColor: '#eceef1', borderColor: '#ffffff' },
  chipText: { fontFamily: Fonts.display, fontSize: 14, color: '#eceef1' },
  chipTextOn: { color: '#0d1016' },
  verdict: { marginHorizontal: 16, padding: 16, borderRadius: 18, borderWidth: 1, backgroundColor: '#12161c', gap: 10 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stat: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, color: '#9aa3b2' },
  statValue: { fontFamily: Fonts.display, fontSize: 24, color: '#eceef1' },
  arrow: { fontSize: 22, color: '#9aa3b2' },
  verdictText: { fontSize: 15, color: '#dfe3ea' },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  changes: { flex: 1, fontFamily: Fonts.mono, fontSize: 11, color: '#9aa3b2' },
  ghostBtn: { height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#2b3340', justifyContent: 'center' },
  ghostText: { fontFamily: Fonts.display, fontSize: 13, color: '#eceef1' },
  solidBtn: { height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#39ff14', justifyContent: 'center' },
  solidText: { fontFamily: Fonts.display, fontSize: 13, color: '#0d1016' },
  disabled: { opacity: 0.4 },
  note: { fontSize: 13, color: '#39ff14' },
  section: { marginHorizontal: 16, gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h2: { fontFamily: Fonts.displayBold, fontSize: 20, letterSpacing: 1, color: '#eceef1' },
  btnRow: { flexDirection: 'row', gap: 8 },
  smallBtn: { height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: '#2b3340', justifyContent: 'center' },
  smallText: { fontFamily: Fonts.display, fontSize: 13, color: '#eceef1' },
  weekChips: { gap: 6 },
  weekChip: { height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#2b3340', justifyContent: 'center' },
  weekChipOn: { borderColor: '#39ff14', backgroundColor: 'rgba(57,255,20,0.08)' },
  weekChipText: { fontFamily: Fonts.mono, fontSize: 12, color: '#9aa3b2' },
  weekChipTextOn: { color: '#39ff14' },
  help: { fontSize: 12, color: '#9aa3b2' },
  game: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderRadius: 12, borderWidth: 1, borderColor: '#1c2027', backgroundColor: '#12161c' },
  gameChanged: { borderColor: '#39ff14', backgroundColor: 'rgba(57,255,20,0.07)' },
  gameWeek: { width: 40, fontFamily: Fonts.mono, fontSize: 11, color: '#9aa3b2' },
  side: { flex: 1, minHeight: 44, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  sideWon: { backgroundColor: 'rgba(255,255,255,0.10)' },
  sideChanged: { backgroundColor: '#39ff14' },
  sideName: { flexShrink: 1, fontFamily: Fonts.display, fontSize: 15, color: '#7f8a99' },
  sideNameWon: { color: '#ffffff' },
  sideNameChanged: { color: '#0d1016' },
  sideScore: { fontFamily: Fonts.mono, fontSize: 11, color: '#9aa3b2' },
  table: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#1c2027' },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 38, paddingHorizontal: 12, backgroundColor: '#12161c' },
  trAlt: { backgroundColor: '#10141a' },
  trMe: { backgroundColor: 'rgba(255,255,255,0.10)' },
  trSeed: { width: 22, fontFamily: Fonts.mono, fontSize: 12, color: '#9aa3b2' },
  trName: { flex: 1, fontFamily: Fonts.display, fontSize: 16, color: '#eceef1' },
  trNameMe: { color: '#ffffff' },
  trBowl: { color: '#d9a066' },
  trRec: { width: 52, textAlign: 'right', fontFamily: Fonts.mono, fontSize: 13, color: '#eceef1' },
  trDelta: { width: 34, textAlign: 'right', fontFamily: Fonts.mono, fontSize: 12 },
  cut: { height: 2, backgroundColor: '#39ff14' },
});
