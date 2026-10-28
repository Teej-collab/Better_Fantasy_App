import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import {
  AccountSettings,
  AppearanceSettings,
  BetSettings,
  ChatSettings,
  HelpSettings,
  NotificationSettings,
  presetFor,
  ProfileSettings,
  SoundSettings,
  SUNDAY_MODES,
} from '@/components/settings/SettingsSections';
import { AppRefreshControl } from '@/components/AppRefreshControl';
import { Display, Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { useAppearance } from '@/lib/appearance';
import { COLOR_PRESETS, isMulti } from '@/lib/colorChoice';
import { getIntroSoundMode } from '@/lib/introSound';
import { useMySettings, usePreferences } from '@/lib/queries';

// Settings (2026-10-28 cleanup, the approved mockup): one grouped list,
// like the iPhone's, each row showing what it's set to, and a search
// across all of it. A row opens its own page (?section=). The old
// section names (appearance, bets, feedback) still open the right page,
// so links from the tour, reminders and elsewhere keep working.

type SectionKey = 'profile' | 'notifications' | 'look' | 'sound' | 'chat' | 'features' | 'account' | 'help';

const ALIASES: Record<string, SectionKey> = { appearance: 'look', bets: 'features', feedback: 'help' };

type Row = { key: SectionKey; label: string; glyph: string; color: string; keywords: string };

const GROUPS: { title: string; rows: Row[] }[] = [
  { title: 'YOU', rows: [{ key: 'profile', label: 'Profile', glyph: 'P', color: Colors.accent, keywords: 'name display team name logo' }] },
  {
    title: 'HOW IT WORKS FOR YOU',
    rows: [
      { key: 'notifications', label: 'Notifications', glyph: 'N', color: '#facc15', keywords: 'sunday mode push alerts touchdowns red zone injuries quiet hours lock screen live activity reminders messages mentions' },
      { key: 'look', label: 'Look & feel', glyph: 'L', color: '#4cc3ff', keywords: 'theme appearance accent color glow neon background honeycomb your week card border animation motion calm cosmic' },
      { key: 'sound', label: 'Sound & app icon', glyph: 'S', color: '#c084fc', keywords: 'intro sound audio app icon seasonal' },
      { key: 'chat', label: 'Chat', glyph: 'C', color: '#fb923c', keywords: 'bubble color read receipts typing previews mentions blocked block' },
      { key: 'features', label: 'Features', glyph: 'F', color: '#4ade80', keywords: 'bets bet tracking my bets' },
    ],
  },
  { title: 'ACCOUNT', rows: [{ key: 'account', label: 'Account & security', glyph: 'A', color: '#aeb5c1', keywords: 'sign in log out password google discord delete account' }] },
  { title: 'HELP', rows: [{ key: 'help', label: 'Help & feedback', glyph: '?', color: '#4cc3ff', keywords: 'glossary tour new here whats new feedback bug email support' }] },
];

const INTRO_LABEL = { daily: 'Intro sound: once a day', always: 'Intro sound: every time', off: 'Intro sound off' } as const;

function colorName(value: string | null | undefined): string {
  if (!value) return 'Default';
  if (isMulti(value)) return 'Multi';
  return COLOR_PRESETS.find((p) => p.hex.toLowerCase() === value.toLowerCase())?.name ?? 'Custom';
}

export default function SettingsScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const raw = params.section ?? '';
  const section = (ALIASES[raw] ?? (GROUPS.some((g) => g.rows.some((r) => r.key === raw)) ? raw : null)) as SectionKey | null;
  const title = GROUPS.flatMap((g) => g.rows).find((r) => r.key === section)?.label ?? 'Settings';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl />} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <Stack.Screen options={{ title, headerBackTitle: section ? 'Settings' : 'Back' }} />
      {section === null && <SettingsHome />}
      {section === 'profile' && <ProfileSettings />}
      {section === 'notifications' && <NotificationSettings />}
      {section === 'look' && <AppearanceSettings />}
      {section === 'sound' && <SoundSettings />}
      {section === 'chat' && <ChatSettings />}
      {section === 'features' && <BetSettings />}
      {section === 'account' && <AccountSettings />}
      {section === 'help' && <HelpSettings />}
    </ScrollView>
  );
}

function SettingsHome() {
  const accent = useAppearance().accent;
  const prefs = usePreferences().data;
  const me = useMySettings().data;
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const values: Record<SectionKey, string> = {
    profile: [me?.display_name, me?.team_name].filter(Boolean).join(' · '),
    notifications: prefs ? (prefs.sunday_mode ? `Sunday Mode: ${SUNDAY_MODES.find((m) => m.key === prefs.sunday_mode)?.label ?? ''}` : 'Customized') : '',
    look: prefs ? `${prefs.theme === 'cosmic' ? 'Cosmic' : 'Calm'} · ${presetFor(prefs)?.name ?? colorName(prefs.accent_color)}` : '',
    sound: INTRO_LABEL[getIntroSoundMode()],
    chat: me ? `Bubble: ${colorName(me.chat_color)}` : '',
    features: prefs ? `Bet tracking ${(prefs.bet_tracking_enabled ?? true) ? 'on' : 'off'}` : '',
    account: me ? [me.has_google && 'Google', me.has_discord && 'Discord', me.has_password && 'Email'].filter(Boolean).join(' · ') : '',
    help: '',
  };

  const groups = GROUPS.map((g) => ({
    ...g,
    rows: g.rows.filter((r) => !q || `${r.label} ${r.keywords} ${values[r.key]}`.toLowerCase().includes(q)),
  })).filter((g) => g.rows.length > 0);

  return (
    <View style={styles.home}>
      <Display style={styles.title}>Settings</Display>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search: glow, quiet hours, team name…"
        placeholderTextColor={Colors.textSecondary}
        clearButtonMode="while-editing"
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Search settings"
        style={styles.search}
      />
      {groups.length === 0 && <Text style={styles.empty}>Nothing matches “{query.trim()}”.</Text>}
      {groups.map((g) => (
        <View key={g.title} style={styles.group}>
          <Text style={styles.groupTitle}>{g.title}</Text>
          <View style={styles.card}>
            {g.rows.map((r, i) => (
              <Pressable
                key={r.key}
                onPress={() => {
                  haptics.select();
                  router.push({ pathname: '/settings', params: { section: r.key } });
                }}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}${values[r.key] ? `, ${values[r.key]}` : ''}`}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && styles.pressed]}>
                <View style={[styles.icon, { backgroundColor: `${r.color}1f` }]}>
                  <Text style={[styles.glyph, { color: r.color }]}>{r.glyph}</Text>
                </View>
                <Text style={styles.label}>{r.label}</Text>
                {values[r.key] ? (
                  <Text style={styles.value} numberOfLines={1}>
                    {values[r.key]}
                  </Text>
                ) : null}
                <Text style={[styles.chevron, { color: accent }]}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <Text style={styles.version}>{appVersionLabel()}</Text>
    </View>
  );
}

// Which copy of the app's code is running: the one built into the app,
// or an over-the-air update (EAS Update) and when it was published.
function appVersionLabel(): string {
  if (Updates.isEmbeddedLaunch || !Updates.createdAt) return 'App version: built-in';
  const when = Updates.createdAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `App version: update from ${when} (${(Updates.updateId ?? '').slice(0, 8)})`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  home: { gap: Spacing.md },
  title: { color: Colors.text, fontSize: 32 },
  search: { minHeight: 44, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, color: Colors.text, fontSize: 15, paddingHorizontal: 12 },
  empty: { color: Colors.textSecondary, fontSize: 14 },
  group: { gap: 6 },
  groupTitle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.4, paddingLeft: 4 },
  card: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 8 },
  rowLine: { borderTopWidth: 1, borderTopColor: Colors.border },
  pressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  icon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 13, fontWeight: '800' },
  label: { flex: 1, color: Colors.text, fontSize: 15, fontWeight: '600' },
  value: { maxWidth: 150, color: Colors.textSecondary, fontSize: 13, textAlign: 'right' },
  chevron: { fontSize: 22, fontWeight: '300' },
  version: { color: Colors.textSecondary, fontSize: 11, textAlign: 'center', marginTop: Spacing.lg },
});
