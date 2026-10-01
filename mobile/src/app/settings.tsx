import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  AccountSettings,
  AppearanceSettings,
  ChatSettings,
  FeedbackSettings,
  NotificationSettings,
  ProfileSettings,
  WebOnlySettings,
} from '@/components/settings/SettingsSections';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { useMe } from '@/lib/queries';

// The web's SettingsShell sections, in order.
const SECTIONS = [
  { key: 'profile', label: 'Profile' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'chat', label: 'Chat' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'navigation', label: 'Navigation' },
  { key: 'labs', label: 'Labs' },
  { key: 'account', label: 'Account & Security' },
  { key: 'feedback', label: 'Feedback' },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

export default function SettingsScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const accent = useAppearance().accent;
  const me = useMe().data;
  const isCommissioner = me?.is_commissioner ?? false;
  const initial = SECTIONS.find((s) => s.key === params.section)?.key ?? 'profile';
  const [section, setSection] = useState<SectionKey>(initial);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Settings' }} />
      {/* Where the web's account menu puts it, for commissioners only. */}
      {isCommissioner && (
        <Pressable onPress={() => router.push('/commissioner')} style={[styles.commish, { borderColor: `${accent}55` }]}>
          <View style={styles.commishText}>
            <Text style={styles.commishTitle}>Commissioner Tools</Text>
            <Text style={styles.commishSub}>Everything you can manage for your league.</Text>
          </View>
          <Text style={[styles.chevron, { color: accent }]}>›</Text>
        </Pressable>
      )}
      {me?.is_site_owner && (
        <Pressable onPress={() => router.push('/admin')} style={[styles.commish, { borderColor: '#38bdf855' }]}>
          <View style={styles.commishText}>
            <Text style={styles.commishTitle}>Admin</Text>
            <Text style={styles.commishSub}>The control room — usage, people, and app health.</Text>
          </View>
          <Text style={[styles.chevron, { color: '#38bdf8' }]}>›</Text>
        </Pressable>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nav}>
        {SECTIONS.map((s) => {
          const active = s.key === section;
          return (
            <Pressable key={s.key} onPress={() => setSection(s.key)} style={[styles.pill, active && { borderColor: accent, backgroundColor: `${accent}22` }]}>
              <Text style={[styles.pillText, active && { color: accent }]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {section === 'profile' && <ProfileSettings />}
      {section === 'notifications' && <NotificationSettings />}
      {section === 'chat' && <ChatSettings />}
      {section === 'appearance' && <AppearanceSettings />}
      {section === 'navigation' && <WebOnlySettings title="Navigation" />}
      {section === 'labs' && <WebOnlySettings title="Labs" />}
      {section === 'account' && <AccountSettings />}
      {section === 'feedback' && <FeedbackSettings />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  commish: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Radius.md, borderWidth: 1, backgroundColor: Colors.surface, padding: Spacing.md },
  commishText: { flex: 1, gap: 2 },
  commishTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  commishSub: { color: Colors.textSecondary, fontSize: 12 },
  chevron: { fontSize: 24, fontWeight: '300' },
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  nav: { gap: Spacing.sm },
  pill: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 7 },
  pillText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
});
