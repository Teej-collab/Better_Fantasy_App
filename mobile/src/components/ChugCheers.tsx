import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Elite } from '@/components/elite/Elite';
import { Text } from '@/components/Text';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';
import type { ChugFeedEntry } from '@/lib/types';

type Cheer = { owner_id: number; name: string };

// "A, B and 3 others"
function cheeredBy(cheers: Cheer[]): string {
  const names = cheers.map((c) => c.name.split(' ')[0]);
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} other${names.length === 3 ? '' : 's'}`;
}

// Cheers on a chug (2026-11-09): we watched it, we liked it. Your own
// chug shows who cheered it, with no button. The web's twin is
// frontend/src/components/ChugCheers.tsx.
export function ChugCheers({ chug, compact }: { chug: ChugFeedEntry; compact?: boolean }) {
  const [cheers, setCheers] = useState<Cheer[]>(chug.cheers ?? []);
  const [cheered, setCheered] = useState(chug.cheered ?? false);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !cheered;
    haptics[next ? 'success' : 'tap']();
    setCheered(next);
    setBusy(true);
    try {
      const res = await api.toggleChugCheers(chug.id);
      setCheered(res.cheered);
      setCheers(res.cheers);
      void queryClient.invalidateQueries({ queryKey: ['chug-feed'] });
    } catch {
      setCheered(!next);
    } finally {
      setBusy(false);
    }
  }

  if (chug.mine && cheers.length === 0) return null;
  return (
    <View style={[styles.row, compact && styles.compact]}>
      {!chug.mine && (
        <Pressable
          onPress={toggle}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ selected: cheered }}
          accessibilityLabel={cheered ? `Take back your cheers for ${chug.owner_name}` : `Cheers ${chug.owner_name}'s chug`}
          style={({ pressed }) => [styles.button, cheered && styles.on, pressed && styles.pressed]}>
          <Text style={styles.emoji}>🍻</Text>
          <Text style={[styles.label, cheered && styles.labelOn]}>{cheered ? 'Cheers!' : 'Cheers'}</Text>
          {cheers.length > 0 && <Text style={[styles.count, cheered && styles.labelOn]}>{cheers.length}</Text>}
        </Pressable>
      )}
      {cheers.length > 0 && (
        <Text style={styles.by} numberOfLines={1}>
          {chug.mine ? `🍻 ${cheeredBy(cheers)} cheered this` : cheeredBy(cheers)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compact: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: Elite.cell,
  },
  on: { borderColor: 'rgba(255,178,122,0.6)', backgroundColor: 'rgba(255,122,26,0.14)' },
  pressed: { opacity: 0.7 },
  emoji: { fontSize: 15 },
  label: { color: Elite.cream, fontSize: 13, fontWeight: '700' },
  labelOn: { color: Elite.peach },
  count: { color: Elite.soft, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  by: { color: Elite.faint, fontSize: 12, flexShrink: 1 },
});
