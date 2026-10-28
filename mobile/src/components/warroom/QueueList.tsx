import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { ChanceBar, PosTag, posLabel } from '@/components/warroom/parts';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { openPlayer, queryClient } from '@/lib/queries';
import { positionColor } from '@/lib/positionColors';
import type { WarRoomDraft, WarRoomQueueItem } from '@/lib/types';

// Your draft queue, readable at a glance (2026-10-28 mockup): one card
// per player with his team, bye and ADP, then either the chance he
// lasts to your next pick or who already took him. Shared by the War
// Room's Queue page and the draft room's Queue tab.

function refresh() {
  void queryClient.invalidateQueries({ queryKey: ['war-room'] });
  void queryClient.invalidateQueries({ queryKey: ['draft-queue'] });
}

export function useQueueActions(items: WarRoomQueueItem[]) {
  const ids = items.map((q) => q.sleeper_player_id);

  async function move(index: number, by: number) {
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    haptics.select();
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await api.reorderDraftQueue(next);
    } catch (e) {
      Alert.alert("Couldn't reorder", e instanceof Error ? e.message : 'Try again.');
    }
    refresh();
  }

  async function toTop(index: number) {
    if (index <= 0) return;
    haptics.select();
    const next = [ids[index], ...ids.filter((_, i) => i !== index)];
    try {
      await api.reorderDraftQueue(next);
    } catch (e) {
      Alert.alert("Couldn't reorder", e instanceof Error ? e.message : 'Try again.');
    }
    refresh();
  }

  async function remove(id: string) {
    haptics.tap();
    try {
      await api.removeFromDraftQueue(id);
    } catch (e) {
      Alert.alert("Couldn't remove", e instanceof Error ? e.message : 'Try again.');
    }
    refresh();
  }

  return { move, toTop, remove };
}

function IconButton({ label, glyph, onPress, disabled }: { label: string; glyph: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [styles.icon, disabled && styles.iconOff, pressed && styles.pressed]}>
      <Text style={styles.iconText}>{glyph}</Text>
    </Pressable>
  );
}

export function QueueList({
  items,
  onDraft,
  draftLabel = 'Draft',
}: {
  items: WarRoomQueueItem[];
  // Set while you're on the clock.
  onDraft?: (playerId: string) => void;
  draftLabel?: string;
}) {
  const { move, toTop, remove } = useQueueActions(items);
  // Rank among the players still there; drafted ones show a dash.
  const ranks = items.reduce<number[]>((acc, q) => [...acc, (acc[acc.length - 1] ?? 0) + (q.taken_by === null ? 1 : 0)], []);

  return (
    <View style={styles.list}>
      {items.map((q, index) => {
        const gone = q.taken_by !== null;
        const rank = ranks[index];
        const meta = [q.team, q.bye_week ? `bye ${q.bye_week}` : null, q.adp !== null ? `ADP ${Math.round(q.adp)}` : null].filter(Boolean).join(' · ');
        return (
          <View key={q.sleeper_player_id} style={[styles.card, gone && styles.gone]}>
            <View style={styles.rankCol}>
              <Text style={styles.rank}>{gone ? '–' : rank}</Text>
            </View>
            <Pressable onPress={() => openPlayer(q.sleeper_player_id)} accessibilityRole="button" style={styles.body}>
              <View style={styles.nameRow}>
                <PosTag position={q.position} />
                <Text style={[styles.name, gone && styles.struck]} numberOfLines={1}>
                  {q.name}
                </Text>
              </View>
              {meta ? <Text style={styles.meta}>{meta}</Text> : null}
              {gone ? (
                <Text style={styles.takenText}>
                  Gone: {q.taken_by!.name === 'You' ? 'you took him' : `${q.taken_by!.name} took him`} at {q.taken_by!.pick}
                </Text>
              ) : q.chance !== null ? (
                <ChanceBar chance={q.chance} />
              ) : null}
            </Pressable>
            <View style={styles.actions}>
              {onDraft && !gone && rank === 1 ? (
                <Pressable onPress={() => onDraft(q.sleeper_player_id)} accessibilityRole="button" style={({ pressed }) => [styles.draft, pressed && styles.pressed]}>
                  <Text style={styles.draftText}>{draftLabel}</Text>
                </Pressable>
              ) : null}
              <View style={styles.moveRow}>
                <IconButton label={`Move ${q.name} up`} glyph="▲" onPress={() => void move(index, -1)} disabled={index === 0} />
                <IconButton label={`Move ${q.name} down`} glyph="▼" onPress={() => void move(index, 1)} disabled={index === items.length - 1} />
              </View>
              <View style={styles.moveRow}>
                <IconButton label={`Move ${q.name} to the top`} glyph="⤒" onPress={() => void toTop(index)} disabled={index === 0} />
                <IconButton label={`Remove ${q.name} from your queue`} glyph="✕" onPress={() => void remove(q.sleeper_player_id)} />
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Your next pick and the starting spots you still have to fill. */
export function QueueHeader({ draft }: { draft: WarRoomDraft }) {
  const label = draft.next_pick_label;
  const until = draft.picks_until ?? null;
  const needs = draft.needs ?? [];
  return (
    <View style={styles.header}>
      {label ? (
        <View style={styles.nextCard}>
          <View style={styles.nextBadge}>
            <Text style={styles.nextLabel}>{label}</Text>
            <Text style={styles.nextSub}>YOUR PICK</Text>
          </View>
          <View style={styles.body}>
            <Text style={styles.nextTitle}>
              {draft.status === 'in_progress' || draft.status === 'paused'
                ? until === 0
                  ? "You're on the clock"
                  : `You're up in ${until} pick${until === 1 ? '' : 's'}`
                : `Your first pick is ${label}`}
            </Text>
            <Text style={styles.meta}>Your queue is empty when you&apos;re up? Autopick takes the best player left by ADP.</Text>
          </View>
        </View>
      ) : null}
      {needs.length > 0 && (
        <View style={styles.needs}>
          <Text style={styles.needsLabel}>Still need</Text>
          {needs.map((n) => {
            const color = positionColor(n.position);
            return (
              <View key={n.position} style={[styles.need, { backgroundColor: `${color}1f` }]}>
                <Text style={[styles.needText, { color }]}>
                  {posLabel(n.position)}
                  {n.count > 1 ? ` ×${n.count}` : ''}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.sm },
  nextCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: Radius.lg, backgroundColor: Colors.surface, borderWidth: 1, borderColor: '#4cc3ff', padding: 12 },
  nextBadge: { width: 64, minHeight: 60, borderRadius: 14, backgroundColor: 'rgba(76,195,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  nextLabel: { color: '#4cc3ff', fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  nextSub: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' },
  nextTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  needs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  needsLabel: { color: Colors.textSecondary, fontSize: 12 },
  need: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  needText: { fontSize: 13, fontWeight: '800' },
  list: { gap: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: Radius.lg, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, padding: 12 },
  gone: { opacity: 0.55 },
  rankCol: { width: 26, alignItems: 'center' },
  rank: { color: '#aeb5c1', fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  body: { flex: 1, minWidth: 0, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, color: Colors.text, fontSize: 17, fontWeight: '700' },
  struck: { textDecorationLine: 'line-through' },
  meta: { color: '#aeb5c1', fontSize: 13 },
  takenText: { color: Colors.loss, fontSize: 13, fontWeight: '700' },
  actions: { alignItems: 'flex-end', gap: 6 },
  moveRow: { flexDirection: 'row', gap: 6 },
  icon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  iconOff: { opacity: 0.3 },
  iconText: { color: Colors.textSecondary, fontSize: 13 },
  draft: { minHeight: 36, borderRadius: Radius.pill, backgroundColor: Colors.accent, paddingHorizontal: 14, justifyContent: 'center' },
  draftText: { color: '#0d1016', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
