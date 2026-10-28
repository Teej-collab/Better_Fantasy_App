import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient, useMe, useTradeTeams } from '@/lib/queries';
import type { Kitty, KittyEntry } from '@/lib/types';

// The league kitty (2026-10-28): who owes the pot and who's paid.
// Franchise tag fees show up by themselves when keepers lock; the
// commissioner adds anything else and marks each one paid. Everyone in
// the league can see it.

function money(n: number): string {
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

export default function KittyScreen() {
  const me = useMe().data;
  const q = useQuery({ queryKey: ['kitty'], queryFn: api.kitty });
  const commish = Boolean(me?.is_commissioner);
  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load the kitty." actionLabel="Try again" onAction={() => void q.refetch()} />;
  const kitty = q.data;
  const owed = kitty.entries.filter((e) => !e.paid_at);
  const paid = kitty.entries.filter((e) => e.paid_at);

  function update(next: Kitty) {
    queryClient.setQueryData(['kitty'], next);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'League Kitty' }} />
      <Display style={styles.title}>League Kitty</Display>
      <View style={styles.totals}>
        <View style={[styles.total, { borderColor: Colors.accent }]}>
          <Text style={[styles.totalBig, { color: Colors.accent }]}>{money(kitty.collected)}</Text>
          <Text style={styles.small}>in the kitty</Text>
        </View>
        <View style={[styles.total, { borderColor: '#facc15' }]}>
          <Text style={[styles.totalBig, { color: '#facc15' }]}>{money(kitty.outstanding)}</Text>
          <Text style={styles.small}>still owed</Text>
        </View>
      </View>

      {commish && <AddEntry onAdded={update} />}

      <Text style={styles.eyebrow}>STILL OWED</Text>
      {owed.length === 0 ? <Text style={styles.muted}>Nobody owes anything right now.</Text> : owed.map((e) => <Entry key={e.id} entry={e} commish={commish} onChange={update} />)}

      {paid.length > 0 && (
        <>
          <Text style={styles.eyebrow}>PAID</Text>
          {paid.map((e) => (
            <Entry key={e.id} entry={e} commish={commish} onChange={update} />
          ))}
        </>
      )}
      <Text style={styles.small}>Franchise tag fees are added automatically when keepers lock.</Text>
    </ScrollView>
  );
}

function Entry({ entry, commish, onChange }: { entry: KittyEntry; commish: boolean; onChange: (k: Kitty) => void }) {
  const [busy, setBusy] = useState(false);
  const isPaid = Boolean(entry.paid_at);

  async function run(action: () => Promise<Kitty>) {
    setBusy(true);
    try {
      onChange(await action());
      haptics.success();
    } catch (e) {
      Alert.alert("Couldn't update the kitty", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    Alert.alert('Remove this entry?', `${entry.reason}, ${money(entry.amount)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void run(() => api.deleteKittyEntry(entry.id)) },
    ]);
  }

  return (
    <View style={[styles.entry, isPaid && styles.entryPaid]}>
      <View style={styles.flex}>
        <Text style={styles.name}>{entry.owner_name ?? 'The league'}</Text>
        <Text style={styles.small}>
          {entry.reason} · {entry.season}
        </Text>
      </View>
      <Text style={[styles.amount, { color: isPaid ? Colors.accent : '#facc15' }]}>{money(entry.amount)}</Text>
      {commish ? (
        <View style={styles.actions}>
          <Pressable
            disabled={busy}
            onPress={() => void run(() => api.setKittyPaid(entry.id, !isPaid))}
            accessibilityRole="button"
            accessibilityLabel={isPaid ? `Mark ${entry.reason} unpaid` : `Mark ${entry.reason} paid`}
            style={({ pressed }) => [styles.paidBtn, isPaid && styles.paidBtnOn, pressed && styles.pressed]}>
            <Text style={[styles.paidText, isPaid && styles.paidTextOn]}>{isPaid ? 'Paid ✓' : 'Mark paid'}</Text>
          </Pressable>
          {!isPaid && (
            <Pressable disabled={busy} onPress={remove} accessibilityRole="button" accessibilityLabel={`Remove ${entry.reason}`} hitSlop={6}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Text style={[styles.small, isPaid && { color: Colors.accent }]}>{isPaid ? 'Paid' : 'Owed'}</Text>
      )}
    </View>
  );
}

function AddEntry({ onAdded }: { onAdded: (k: Kitty) => void }) {
  const teams = useTradeTeams().data ?? [];
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = Number(amount);
    if (!reason.trim() || !(n > 0)) {
      Alert.alert('Add a reason and an amount');
      return;
    }
    setBusy(true);
    try {
      onAdded(await api.addKittyEntry({ owner_id: owner, amount: n, reason: reason.trim() }));
      haptics.success();
      setOpen(false);
      setAmount('');
      setReason('');
      setOwner(null);
    } catch (e) {
      Alert.alert("Couldn't add it", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}>
        <Text style={styles.addText}>+ Add to the kitty</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.form}>
      <Text style={styles.eyebrow}>WHO OWES IT</Text>
      <View style={styles.chips}>
        {teams.map((t) => (
          <Pressable key={t.team_id} onPress={() => setOwner(t.owner_id)} accessibilityRole="radio" accessibilityState={{ checked: owner === t.owner_id }} style={[styles.chip, owner === t.owner_id && styles.chipOn]}>
            <Text style={[styles.chipText, owner === t.owner_id && styles.chipTextOn]} numberOfLines={1}>
              {t.owner_name ?? t.team_name}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={reason} onChangeText={setReason} placeholder="What it's for (buy-in, side bet…)" placeholderTextColor={Colors.textSecondary} maxLength={120} accessibilityLabel="What it's for" style={styles.input} />
      <TextInput value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} placeholder="Amount in dollars" placeholderTextColor={Colors.textSecondary} keyboardType="decimal-pad" accessibilityLabel="Amount in dollars" style={styles.input} />
      <View style={styles.formActions}>
        <Pressable onPress={() => setOpen(false)} accessibilityRole="button" style={styles.ghost}>
          <Text style={styles.ghostText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={() => void save()} disabled={busy} accessibilityRole="button" style={[styles.primary, busy && styles.dim]}>
          <Text style={styles.primaryText}>{busy ? 'Adding…' : 'Add'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  title: { color: Colors.text, fontSize: 30 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  eyebrow: { color: Colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.4, marginTop: Spacing.sm },
  small: { color: Colors.textSecondary, fontSize: 12 },
  muted: { color: Colors.textSecondary, fontSize: 14 },
  name: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  totals: { flexDirection: 'row', gap: Spacing.sm },
  total: { flex: 1, borderRadius: Radius.lg, borderWidth: 1, backgroundColor: Colors.surface, padding: Spacing.md, gap: 2 },
  totalBig: { fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, padding: 12 },
  entryPaid: { opacity: 0.75 },
  amount: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  actions: { alignItems: 'flex-end', gap: 6 },
  paidBtn: { minHeight: 36, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.accent, paddingHorizontal: 12, justifyContent: 'center' },
  paidBtnOn: { backgroundColor: Colors.accent },
  paidText: { color: Colors.accent, fontSize: 13, fontWeight: '700' },
  paidTextOn: { color: '#0d1016' },
  remove: { color: Colors.loss, fontSize: 12, fontWeight: '600' },
  addBtn: { minHeight: 48, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  addText: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
  form: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, padding: Spacing.md, gap: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 36, maxWidth: 160, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, justifyContent: 'center' },
  chipOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText: { color: '#aeb5c1', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#0d1016', fontWeight: '800' },
  input: { minHeight: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bg, color: Colors.text, fontSize: 16, paddingHorizontal: 12 },
  formActions: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end' },
  ghost: { minHeight: 44, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 18, justifyContent: 'center' },
  ghostText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  primary: { minHeight: 44, borderRadius: Radius.pill, backgroundColor: Colors.accent, paddingHorizontal: 22, justifyContent: 'center' },
  primaryText: { color: '#0d1016', fontSize: 14, fontWeight: '800' },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
