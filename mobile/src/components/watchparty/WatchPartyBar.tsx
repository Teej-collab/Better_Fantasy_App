import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { useMe, useWatchPartyRooms } from '@/lib/queries';
import type { WatchPartyRoom } from '@/lib/types';

// Real occupancy (someone's in the room now), not the member count.
export function LiveDot() {
  return <View style={styles.liveDot} accessibilityLabel="Live now" />;
}

function openRoom(room: WatchPartyRoom) {
  router.push({ pathname: '/watch-party/[id]', params: { id: String(room.id) } });
}

// Port of the web's WatchPartyBar (above the conversation list in
// Chat): the always-open League Lounge, your private parties, and
// entry points to start a party or a standalone Lounge.
export function WatchPartyBar() {
  const accent = useAppearance().accent;
  const myOwnerId = useMe().data?.owner_id;
  const rooms = useWatchPartyRooms().data;
  if (!rooms) return null;
  const open = rooms.open_room;

  return (
    <View style={styles.bar}>
      <Pressable onPress={() => openRoom(open)} style={styles.openRoom}>
        <View style={styles.icon}>
          <Text style={styles.iconText}>🎥</Text>
        </View>
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <Text style={styles.openName}>League Lounge</Text>
            {open.is_live && <LiveDot />}
          </View>
          <Text style={styles.secondary}>
            {open.is_live ? "Someone's in the room now" : `${open.member_count} in your league · always open`}
          </Text>
        </View>
        <View style={[styles.join, { backgroundColor: accent }]}>
          <Text style={styles.joinText}>Join</Text>
        </View>
      </Pressable>

      {rooms.private_rooms.map((r) => (
        <View key={r.id} style={styles.privateRow}>
          <Pressable onPress={() => openRoom(r)} style={styles.privateRoom}>
            <Text style={styles.lock}>🔒</Text>
            <Text style={styles.privateName} numberOfLines={1}>
              {r.name}
            </Text>
            {r.is_live && <LiveDot />}
            <Text style={[styles.secondary, styles.count]}>{r.member_count}</Text>
          </Pressable>
          {r.created_by_owner_id === myOwnerId && (
            <Pressable
              onPress={() => router.push({ pathname: '/watch-party/manage/[id]', params: { id: String(r.id), name: r.name } })}
              accessibilityLabel={`Manage ${r.name}`}
              hitSlop={8}
              style={styles.gear}>
              <Text style={styles.gearText}>⚙</Text>
            </Pressable>
          )}
        </View>
      ))}

      <Pressable onPress={() => router.push('/watch-party/new')} style={styles.link}>
        <Text style={[styles.linkText, { color: accent }]}>+ Start a Party</Text>
      </Pressable>
      <Pressable onPress={() => router.push('/lounge')} style={styles.link}>
        <Text style={[styles.linkText, styles.secondaryLink]}>+ Start a Lounge (no league needed)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: 4, marginBottom: Spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  openRoom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(239,68,68,0.18)' },
  iconText: { fontSize: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  openName: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  secondary: { color: Colors.textSecondary, fontSize: 12 },
  join: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  joinText: { color: '#06110a', fontSize: 12, fontWeight: '600' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.live },
  privateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  privateRoom: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  lock: { fontSize: 14 },
  privateName: { flexShrink: 1, color: Colors.text, fontSize: 14, fontWeight: '500' },
  count: { marginLeft: 'auto' },
  gear: { padding: 6 },
  gearText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },
  link: { paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  linkText: { fontSize: 12, fontWeight: '600' },
  secondaryLink: { color: Colors.textSecondary },
});
