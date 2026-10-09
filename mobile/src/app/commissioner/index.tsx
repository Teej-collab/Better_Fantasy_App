import { router, Stack, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { CommishScreen } from '@/components/commissioner/CommishUI';
import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';

// Same tiles, titles and descriptions as the web's /commissioner hub.
// Draft links to the draft room, where its commissioner setup lives.
const TILES: { href: Href; title: string; description: string }[] = [
  { href: '/commissioner/league', title: 'League Settings', description: 'Rename your league, copy the invite code, and set your playoff format' },
  { href: '/commissioner/scoring', title: 'Scoring Rules', description: 'Points per stat, grouped by category — changes apply immediately' },
  { href: '/commissioner/members', title: 'Members', description: 'Promote, demote, or remove a member from your league' },
  { href: '/commissioner/teams', title: 'Teams', description: 'Reassign a team to a different member, or add a new team' },
  { href: '/commissioner/roster', title: 'Roster & Keepers', description: "Roster slot shape, keeper rules, and force-editing a member's roster" },
  { href: '/draft', title: 'Draft', description: 'Setup, order, schedule, and live draft-room controls' },
  { href: '/commissioner/trades', title: 'Trades', description: 'Trade deadline, review requirement, and pending trades to approve' },
  { href: '/commissioner/polls', title: 'Polls', description: 'Ask your league a question and collect votes' },
  { href: '/commissioner/chat-filter' as Href, title: 'Chat Filter', description: 'Slurs are always masked in chat — add any other words your league wants hidden' },
  { href: '/punishment-wheel' as Href, title: 'Punishment Wheel', description: "Fill the wheel, then spin it once for this season's league-loser punishment" },
  { href: '/commissioner/espn', title: 'ESPN Connection', description: 'Import teams, matchups, and standings from a real ESPN league' },
];

export default function CommissionerHub() {
  const accent = useAppearance().accent;
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Commissioner Tools' }} />
      <View style={styles.head}>
        <Text style={styles.title}>Commissioner Tools</Text>
        <Text style={styles.subtitle}>Everything you can manage for your league.</Text>
      </View>
      <View style={styles.tiles}>
        {TILES.map((tile) => (
          <Pressable key={tile.title} onPress={() => router.push(tile.href)}>
            {({ pressed }) => (
              <NeonPanel color={accent} radius={12} contentStyle={[styles.tile, pressed && styles.pressed]}>
                <View style={styles.tileHead}>
                  <View style={[styles.dot, { backgroundColor: accent, shadowColor: accent }]} />
                  <Text style={styles.tileTitle}>{tile.title}</Text>
                </View>
                <Text style={styles.tileText}>{tile.description}</Text>
              </NeonPanel>
            )}
          </Pressable>
        ))}
      </View>
    </CommishScreen>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4 },
  title: { color: Colors.text, fontSize: 24, fontWeight: '600' },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  tiles: { gap: Spacing.md },
  tile: { gap: 4, padding: Spacing.lg },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  tileTitle: { color: Colors.text, fontSize: 15, fontWeight: '500' },
  tileText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 20 },
});
