import { useQuery } from '@tanstack/react-query';
import { router, Stack, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ANTON, Elite } from '@/components/elite/Elite';
import { Text } from '@/components/Text';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';

// Making a survivor pool (2026-11-07): for your league (its commissioner
// only) or for anyone with the code, and the rules — lives, ties,
// buyback, two picks a week late in the season, what a missed pick does
// and how many entries each person gets.
type Option<T> = { label: string; value: T };

function Seg<T>({ options, value, onChange }: { options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.label}
            onPress={() => {
              haptics.select();
              onChange(o.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.segItem, on && styles.segOn]}>
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Rule({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <View style={styles.rule}>
      <View style={styles.flex}>
        <Text style={styles.ruleTitle}>{title}</Text>
        <Text style={styles.ruleSub}>{sub}</Text>
      </View>
      {children}
    </View>
  );
}

export default function NewSurvivorPoolScreen() {
  const hub = useQuery({ queryKey: ['survivor-pools'], queryFn: api.survivorPools }).data;
  const league = hub?.league ?? null;
  const week = hub?.week ?? 1;
  const [name, setName] = useState('');
  const [forLeague, setForLeague] = useState<boolean | null>(null);
  const [lives, setLives] = useState(1);
  const [tie, setTie] = useState<'win' | 'loss'>('loss');
  const [buyback, setBuyback] = useState<number | null>(null);
  const [double, setDouble] = useState<number | null>(null);
  const [missed, setMissed] = useState<'auto' | 'loss'>('auto');
  const [entries, setEntries] = useState(1);
  const [prize, setPrize] = useState('');
  const [saving, setSaving] = useState(false);
  const canLeague = Boolean(league?.is_commissioner);
  const leagueChosen = forLeague ?? canLeague;
  // Start this week; a late start leaves fewer weeks for two-pick weeks.
  const start = week;
  const doubleOptions = [16, 14].filter((w) => w > start);
  const buybackOptions = [start + 2, start + 4].filter((w) => w <= 18);

  async function create() {
    setSaving(true);
    try {
      const res = await api.createSurvivorPool({
        name: name.trim() || (leagueChosen && league ? `${league.name} Survivor` : 'Survivor Pool'),
        for_league: leagueChosen,
        lives,
        tie_counts_as: tie,
        buyback_until_week: buyback,
        double_from_week: double,
        missed_pick: missed,
        max_entries: entries,
        prize_note: prize.trim() || null,
      });
      haptics.success();
      await queryClient.invalidateQueries({ queryKey: ['survivor-pools'] });
      router.replace(`/survivor/${res.id}` as Href);
    } catch (e) {
      haptics.error();
      Alert.alert("Couldn't create the pool", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'New pool' }} />
      <Text style={styles.title} accessibilityRole="header">
        NEW POOL
      </Text>

      <Text style={styles.label}>POOL NAME</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={leagueChosen && league ? `${league.name} Survivor` : 'Office Eliminator'}
        placeholderTextColor={Elite.grey}
        maxLength={60}
        style={styles.input}
        accessibilityLabel="Pool name"
      />

      <Text style={styles.label}>WHO PLAYS</Text>
      <View style={styles.who}>
        <Pressable
          disabled={!canLeague}
          onPress={() => setForLeague(true)}
          style={[styles.whoItem, leagueChosen && styles.whoOn, !canLeague && styles.disabled]}
          accessibilityRole="button"
          accessibilityState={{ selected: leagueChosen, disabled: !canLeague }}>
          <Text style={styles.whoTitle}>My league</Text>
          <Text style={styles.ruleSub}>{canLeague ? `${league?.name} members` : league ? 'Only the commissioner can' : 'No league yet'}</Text>
        </Pressable>
        <Pressable onPress={() => setForLeague(false)} style={[styles.whoItem, !leagueChosen && styles.whoOn]} accessibilityRole="button" accessibilityState={{ selected: !leagueChosen }}>
          <Text style={styles.whoTitle}>Anyone with code</Text>
          <Text style={styles.ruleSub}>Invite friends outside it</Text>
        </Pressable>
      </View>

      <View style={styles.rules}>
        <Rule title="Lives" sub="Losses you can take before you're out">
          <Seg options={[1, 2, 3].map((n) => ({ label: String(n), value: n }))} value={lives} onChange={setLives} />
        </Rule>
        <Rule title="A tie counts as" sub="For the team you picked">
          <Seg<'win' | 'loss'> options={[{ label: 'Win', value: 'win' }, { label: 'Loss', value: 'loss' }]} value={tie} onChange={setTie} />
        </Rule>
        <Rule title="Buyback" sub="One re-entry with one life after you're out">
          <Seg<number | null> options={[{ label: 'Off', value: null }, ...buybackOptions.map((w) => ({ label: `Thru W${w}`, value: w }))]} value={buyback} onChange={setBuyback} />
        </Rule>
        {doubleOptions.length > 0 && (
          <Rule title="Two picks a week" sub="Speeds up the endgame. Uses teams fast">
            <Seg<number | null> options={[{ label: 'Off', value: null }, ...doubleOptions.map((w) => ({ label: `W${w}+`, value: w }))]} value={double} onChange={setDouble} />
          </Rule>
        )}
        <Rule title="Missed pick" sub={missed === 'auto' ? 'We pick the biggest favorite you have left' : 'No pick counts as a loss'}>
          <Seg<'auto' | 'loss'> options={[{ label: 'Auto', value: 'auto' }, { label: 'Loss', value: 'loss' }]} value={missed} onChange={setMissed} />
        </Rule>
        <Rule title="Entries per person" sub="Each entry picks on its own">
          <Seg options={[1, 2, 3].map((n) => ({ label: String(n), value: n }))} value={entries} onChange={setEntries} />
        </Rule>
      </View>

      <Text style={styles.label}>PRIZE NOTE (OPTIONAL)</Text>
      <TextInput
        value={prize}
        onChangeText={setPrize}
        placeholder="e.g. Last one standing picks the draft order"
        placeholderTextColor={Elite.grey}
        maxLength={140}
        style={styles.input}
        accessibilityLabel="Prize note"
      />

      <Pressable onPress={() => void create()} disabled={saving} style={[styles.create, saving && styles.disabled]} accessibilityRole="button">
        <Text style={styles.createText}>{saving ? 'Creating…' : `Create pool · starts week ${start}`}</Text>
      </Pressable>
      <Text style={styles.ruleSub}>If week {start}&apos;s first game has already kicked off, the pool starts the week after.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Elite.deep },
  content: { padding: Spacing.lg, gap: 10, paddingBottom: 80 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontFamily: ANTON, fontSize: 32, color: Elite.green, textShadowColor: 'rgba(57,255,20,0.4)', textShadowRadius: 14, marginBottom: 4 },
  label: { color: Elite.faint, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 6 },
  input: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: Elite.card, color: Elite.cream, paddingHorizontal: 12, fontSize: 14 },
  who: { flexDirection: 'row', gap: 8 },
  whoItem: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: Elite.card, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)', gap: 2, minHeight: 56 },
  whoOn: { backgroundColor: 'rgba(57,255,20,0.10)', borderColor: Elite.green },
  whoTitle: { color: Elite.cream, fontSize: 13, fontWeight: '800' },
  rules: { backgroundColor: Elite.cell, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 12, marginTop: 6 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  ruleTitle: { color: Elite.cream, fontSize: 13, fontWeight: '700' },
  ruleSub: { color: Elite.faint, fontSize: 11, marginTop: 1 },
  seg: { flexDirection: 'row', gap: 3, padding: 2, backgroundColor: Elite.deep, borderRadius: 8 },
  segItem: { minWidth: 36, minHeight: 32, paddingHorizontal: 8, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: Elite.green },
  segText: { color: Elite.soft, fontSize: 11, fontWeight: '700' },
  segTextOn: { color: Elite.deep },
  create: { minHeight: 50, borderRadius: 14, backgroundColor: Elite.green, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  createText: { color: Elite.deep, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});
