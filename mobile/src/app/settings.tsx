import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

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
  const initial = SECTIONS.find((s) => s.key === params.section)?.key ?? 'profile';
  const [section, setSection] = useState<SectionKey>(initial);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Settings' }} />
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
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  nav: { gap: Spacing.sm },
  pill: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 7 },
  pillText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
});
