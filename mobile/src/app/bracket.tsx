import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Carousel } from '@/components/bracket/Carousel';
import { FullBracket } from '@/components/bracket/FullBracket';
import { PathView } from '@/components/bracket/PathView';
import { WhatIfView } from '@/components/bracket/WhatIfView';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { api, WEB_BASE_URL } from '@/lib/api';
import {
  EMPTY_SCENARIO,
  buildWorld,
  changeCount,
  decodeScenario,
  encodeScenario,
  isEmpty,
  recordOf,
  scenarioHeadline,
  type Scenario,
  type WorldTeam,
} from '@/lib/bracketEngine';
import { haptics } from '@/lib/haptics';
import { useMe, usePlayoffWorld, useSeasons } from '@/lib/queries';

// The Bracket (2026-10): one world — reality or the user's what-if —
// shown four ways, switched from the pill in the top left: Cards (the
// 3D carousel), Full bracket, Your Path (the Tower) and What-If. A
// shared what-if opens straight into its world (?w=, the web's format).

type Mode = 'cards' | 'full' | 'path' | 'whatif';
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: 'cards', label: 'Cards', hint: 'Swipe through every game' },
  { key: 'full', label: 'Full bracket', hint: 'The whole bracket at once' },
  { key: 'path', label: 'Your Path', hint: 'Ride the elevator to where a team finishes' },
  { key: 'whatif', label: 'What-If', hint: 'Flip results, pick winners, share it' },
];

export default function BracketScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string; w?: string }>();
  const shared = useMemo(() => decodeScenario(params.w), [params.w]);
  const season = useSeasons().data?.[0] ?? null;
  const me = useMe().data;
  const q = usePlayoffWorld(season);
  const world = q.data;
  const [mode, setMode] = useState<Mode>(params.mode === 'whatif' || params.mode === 'path' || params.mode === 'full' ? params.mode : isEmpty(shared.scenario) ? 'cards' : 'whatif');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario>(shared.scenario);
  const [meChoice, setMeChoice] = useState<number | null>(shared.me);
  const [pathChoice, setPathChoice] = useState<number | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const base = useMemo(() => (world ? buildWorld(world) : null), [world]);
  const alt = useMemo(() => (world ? buildWorld(world, scenario) : null), [world, scenario]);

  const header = <Stack.Screen options={{ title: 'Bracket' }} />;
  if (q.isPending || season === null) {
    return (
      <View style={styles.screen}>
        {header}
        <LoadingState />
      </View>
    );
  }
  if (!world || !base || !alt) {
    return (
      <View style={styles.screen}>
        {header}
        <MessageState message="The bracket appears once the league's playoff settings are in place." />
      </View>
    );
  }

  const teams: Record<number, WorldTeam> = {};
  for (const t of world.teams) teams[t.team_id] = t;
  const myTeam = world.teams.find((t) => t.owner_id === me?.owner_id)?.team_id ?? null;
  const meId = meChoice !== null && teams[meChoice] ? meChoice : (myTeam ?? world.teams[0].team_id);
  const shown = isEmpty(scenario) ? base : alt;
  const records: Record<number, string> = {};
  for (const r of shown.standings) records[r.team_id] = recordOf(r);
  const current = MODES.find((m) => m.key === mode)!;

  const changeScenario = (s: Scenario) => {
    setScenario(s);
    setShareNote(null);
  };
  const share = async (to: 'chat' | 'sheet') => {
    const link = `${WEB_BASE_URL}/bracket?mode=whatif&w=${encodeScenario(scenario, meId)}`;
    const text = `What if… ${scenarioHeadline(world, alt, meId)}. See it: ${link}`;
    if (to === 'sheet') {
      await Share.share({ message: text });
      return;
    }
    try {
      await api.shareToLeagueChat(text);
      haptics.success();
      setShareNote('Posted to the league chat.');
    } catch {
      setShareNote("Couldn't post it — try Share instead.");
    }
  };

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 48, gap: 14 }}>
        <View style={styles.top}>
          <Pressable
            onPress={() => {
              haptics.tap();
              setMenuOpen(true);
            }}
            style={styles.pill}
            accessibilityRole="button"
            accessibilityLabel={`View: ${current.label}. Change view`}>
            <Text style={styles.pillText}>{current.label.toUpperCase()}</Text>
            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#0d1016" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M6 9l6 6 6-6" />
            </Svg>
          </Pressable>
          <Text style={styles.status} numberOfLines={2}>
            {world.status === 'live' ? 'Live — real results, favorites for what’s left' : 'Projected — the rest goes to the favorites'}
          </Text>
        </View>

        {!isEmpty(scenario) && mode !== 'whatif' && (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>WHAT-IF WORLD · {changeCount(scenario)} CHANGE{changeCount(scenario) > 1 ? 'S' : ''}</Text>
            <Text style={styles.bannerText}>{scenarioHeadline(world, alt, meId)}.</Text>
            <View style={styles.bannerRow}>
              <Pressable onPress={() => setMode('whatif')} style={styles.bannerBtn} accessibilityRole="button">
                <Text style={styles.bannerBtnText}>EDIT</Text>
              </Pressable>
              <Pressable onPress={() => changeScenario(EMPTY_SCENARIO)} style={[styles.bannerBtn, styles.bannerBtnGhost]} accessibilityRole="button">
                <Text style={[styles.bannerBtnText, styles.bannerGhostText]}>BACK TO REALITY</Text>
              </Pressable>
            </View>
          </View>
        )}

        {mode === 'cards' && <Carousel world={world} w={shown} teams={teams} records={records} me={meId} />}
        {mode === 'full' && <FullBracket world={world} w={shown} teams={teams} records={records} me={meId} />}
        {mode === 'path' && (
          <PathView world={world} w={shown} teams={teams} records={records} team={pathChoice !== null && teams[pathChoice] ? pathChoice : meId} onTeam={setPathChoice} />
        )}
        {mode === 'whatif' && (
          <WhatIfView
            world={world}
            base={base}
            alt={alt}
            teams={teams}
            scenario={scenario}
            onScenario={changeScenario}
            me={meId}
            onMe={(t) => {
              setMeChoice(t);
              changeScenario(EMPTY_SCENARIO);
            }}
            onShare={(to) => void share(to)}
            shareNote={shareNote}
          />
        )}
      </ScrollView>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)} accessibilityLabel="Close">
          <View style={[styles.menu, { marginTop: insets.top + 100 }]} accessibilityViewIsModal>
            {MODES.map((m) => (
              <Pressable
                key={m.key}
                onPress={() => {
                  haptics.tap();
                  setMode(m.key);
                  setMenuOpen(false);
                }}
                style={({ pressed }) => [styles.menuItem, m.key === mode && styles.menuItemOn, pressed && styles.menuPressed]}
                accessibilityRole="button"
                accessibilityState={{ selected: m.key === mode }}>
                <Text style={[styles.menuLabel, m.key === mode && styles.menuLabelOn]}>{m.label}</Text>
                <Text style={styles.menuHint}>{m.hint}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d1016' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: '#eceef1' },
  pillText: { fontFamily: Fonts.display, fontSize: 14, letterSpacing: 1, color: '#0d1016' },
  status: { flex: 1, fontSize: 12, color: '#9aa3b2' },
  banner: { marginHorizontal: 16, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#39ff14', backgroundColor: 'rgba(57,255,20,0.06)', gap: 6 },
  bannerTitle: { fontFamily: Fonts.display, fontSize: 13, letterSpacing: 1, color: '#39ff14' },
  bannerText: { fontSize: 14, color: '#eceef1' },
  bannerRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  bannerBtn: { height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: '#39ff14', justifyContent: 'center' },
  bannerBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  bannerBtnText: { fontFamily: Fonts.display, fontSize: 13, color: '#0d1016' },
  bannerGhostText: { color: '#eceef1' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 16 },
  menu: { alignSelf: 'flex-start', minWidth: 260, borderRadius: 16, backgroundColor: '#12161c', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingVertical: 6, overflow: 'hidden' },
  menuItem: { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
  menuItemOn: { backgroundColor: 'rgba(57,255,20,0.08)' },
  menuPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  menuLabel: { fontSize: 16, fontWeight: '700', color: '#eceef1' },
  menuLabelOn: { color: '#39ff14' },
  menuHint: { fontSize: 12, color: '#9aa3b2' },
});
