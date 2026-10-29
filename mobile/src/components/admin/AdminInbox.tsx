import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { relativeTime } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { Colors, Radius } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import type { AdminInbox, AdminInboxItem, AdminInboxKind } from '@/lib/adminTypes';

// The admin inbox (2026-10-28, mockup B): everything that needs a
// person, one feed shared by the admins. Claim an item so two people
// don't both chase it; mark it done when it's handled.

export const ADMIN_PURPLE = '#bf5af2';

export const KIND_META: Record<AdminInboxKind, { label: string; color: string }> = {
  error: { label: 'ERROR', color: '#ff6961' },
  crash: { label: 'CRASH', color: '#ff375f' },
  feedback: { label: 'FEEDBACK', color: '#64d2ff' },
  waitlist: { label: 'WAITLIST', color: '#ffd60a' },
  join: { label: 'JOIN', color: '#0a84ff' },
  league: { label: 'LEAGUE', color: '#30d158' },
};

const KEY = ['admin', 'inbox'];

export function useInbox() {
  return useQuery({ queryKey: KEY, queryFn: api.admin.inbox, refetchInterval: 60_000 });
}

// What's still open and not someone else's: the "Needs you" count.
export function needsMe(inbox: AdminInbox | undefined): AdminInboxItem[] {
  if (!inbox) return [];
  return inbox.items.filter((i) => !i.done && (!i.claimed_by || i.claimed_by.user_id === inbox.me));
}

type Change = { item: AdminInboxItem; claim?: boolean; done?: boolean };

function useInboxChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, claim, done }: Change) => {
      if (claim !== undefined) await api.admin.claim(item.kind, item.ref, claim);
      if (done !== undefined) await api.admin.setDone(item.kind, item.ref, done);
    },
    // Shows the change right away; the refetch after fills in names.
    onMutate: async ({ item, claim, done }: Change) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const before = queryClient.getQueryData<AdminInbox>(KEY);
      if (before) {
        queryClient.setQueryData<AdminInbox>(KEY, {
          ...before,
          items: before.items.map((i) =>
            i.kind === item.kind && i.ref === item.ref
              ? {
                  ...i,
                  claimed_by: claim === undefined ? i.claimed_by : claim ? { user_id: before.me, name: 'You' } : null,
                  done: done ?? i.done,
                  done_by: done ? 'You' : done === false ? null : i.done_by,
                }
              : i,
          ),
        });
      }
      return { before };
    },
    onError: (_e, _v, context) => {
      if (context?.before) queryClient.setQueryData(KEY, context.before);
      haptics.error();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

function openItem(item: AdminInboxItem) {
  const { screen, id } = item.link;
  if (screen === 'error' && id) router.push(`/admin/errors/${encodeURIComponent(id)}` as Href);
  else if (screen === 'league' && id) router.push(`/admin/leagues/${id}` as Href);
  else if (screen === 'crashes') router.push('/admin/crashes');
  else if (screen === 'waitlist') router.push('/admin/waitlist' as Href);
}

export function InboxCard({ item, me, compact = false }: { item: AdminInboxItem; me: number; compact?: boolean }) {
  const change = useInboxChange();
  const meta = KIND_META[item.kind];
  const mine = item.claimed_by?.user_id === me;
  const owner = item.done ? `Done${item.done_by ? ` · ${item.done_by}` : ''}` : item.claimed_by ? (mine ? 'You' : item.claimed_by.name) : 'Unclaimed';
  const canOpen = item.link.screen !== 'feedback';
  const screenshot = item.link.image_url;

  const run = (c: Omit<Change, 'item'>) => {
    haptics.select();
    change.mutate({ item, ...c });
  };

  if (compact) {
    return (
      <Pressable
        onPress={() => router.push('/admin/inbox' as Href)}
        accessibilityRole="button"
        accessibilityLabel={`${meta.label}: ${item.title}`}
        style={({ pressed }) => [styles.compact, pressed && styles.pressed]}>
        <View style={[styles.compactIcon, { backgroundColor: meta.color }]} />
        <View style={styles.flex}>
          <Text style={styles.compactTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.detail} numberOfLines={1}>
            {meta.label.toLowerCase()} · {relativeTime(item.at)}
            {mine ? ' · yours' : ''}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, item.done && styles.cardDone]}>
      <View style={styles.headRow}>
        <View style={[styles.tag, { backgroundColor: `${meta.color}26` }]}>
          <Text style={[styles.tagText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        <Text style={styles.detail}>{relativeTime(item.at)}</Text>
        <View style={styles.flex} />
        <Text style={[styles.owner, { color: item.done ? '#30d158' : item.claimed_by ? (mine ? '#7d7aff' : '#ff9f0a') : Colors.textSecondary }]}>{owner}</Text>
      </View>
      <Text style={styles.title} numberOfLines={item.kind === 'feedback' ? undefined : 3}>
        {item.title}
      </Text>
      {item.detail ? <Text style={styles.body}>{item.detail}</Text> : null}
      <View style={styles.actions}>
        {item.done ? (
          <ActionButton label="Reopen" onPress={() => run({ done: false })} />
        ) : (
          <>
            {!item.claimed_by && <ActionButton primary label="I'll take it" onPress={() => run({ claim: true })} />}
            <ActionButton primary={mine} label="Mark done" onPress={() => run({ done: true })} />
            {mine && <ActionButton label="Let go" onPress={() => run({ claim: false })} />}
          </>
        )}
        {canOpen && <ActionButton label="Open" onPress={() => openItem(item)} />}
        {screenshot && <ActionButton label="Screenshot" onPress={() => void Linking.openURL(screenshot)} />}
      </View>
    </View>
  );
}

function ActionButton({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={4}
      style={({ pressed }) => [styles.button, primary ? styles.buttonPrimary : styles.buttonGhost, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

// A white line glyph on a colored rounded square, like Settings' rows.
export function AdminRowIcon({ d, color }: { d: string; color: string }) {
  return (
    <View style={[styles.rowIcon, { backgroundColor: color }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path d={d} stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  card: { gap: 8, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, padding: 14 },
  cardDone: { opacity: 0.6 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  owner: { fontSize: 12, fontWeight: '700' },
  title: { color: Colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  body: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  detail: { color: Colors.textSecondary, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  button: { minHeight: 36, borderRadius: Radius.pill, paddingHorizontal: 14, justifyContent: 'center' },
  buttonPrimary: { backgroundColor: ADMIN_PURPLE },
  buttonGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  buttonText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  buttonTextPrimary: { color: '#ffffff', fontWeight: '700' },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 4 },
  compactIcon: { width: 10, height: 10, borderRadius: 5 },
  compactTitle: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  chevron: { color: Colors.textSecondary, fontSize: 20 },
  rowIcon: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
});
