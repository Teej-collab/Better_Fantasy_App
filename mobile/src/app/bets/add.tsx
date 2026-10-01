import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { BET_STATS, describeDraftLeg, pickSlipScreenshot } from '@/lib/bets';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';
import type { BetDirection, BetMarket, DraftBet, DraftLeg } from '@/lib/types';

// Add a bet (port of the web's AddBetFlow): a bet-slip screenshot read by
// Claude on the server — then thrown away — or typed in by hand; every
// leg is checked here before anything is saved.

const EMPTY_LEG: DraftLeg = {
  description: '',
  market: 'player_prop',
  player_name: '',
  team_abbr: '',
  stat_key: 'rush_yd',
  line: null,
  direction: 'over',
  odds_american: null,
};

const MARKETS: { key: BetMarket; label: string }[] = [
  { key: 'player_prop', label: 'Player prop' },
  { key: 'spread', label: 'Spread' },
  { key: 'moneyline', label: 'Moneyline' },
  { key: 'total', label: 'Total' },
  { key: 'other', label: 'Other' },
];

export default function AddBetScreen() {
  const accent = useAppearance().accent;
  const [draft, setDraft] = useState<DraftBet | null>(null);
  const [source, setSource] = useState<'screenshot' | 'manual'>('manual');
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function readScreenshot() {
    setError(null);
    let image: Awaited<ReturnType<typeof pickSlipScreenshot>>;
    try {
      image = await pickSlipScreenshot();
    } catch {
      setError("Couldn't open that screenshot.");
      return;
    }
    if (!image) return;
    setBusy('reading');
    try {
      const parsed = await api.parseBetSlip(image.base64, image.mediaType);
      haptics.success();
      setSource('screenshot');
      setDraft({ ...parsed, legs: parsed.legs.map((l) => ({ ...EMPTY_LEG, ...l })) });
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Couldn't read that slip.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!draft) return;
    setError(null);
    setBusy('saving');
    try {
      await api.createBet({
        ...draft,
        source,
        legs: draft.legs.map((l) => ({
          ...l,
          description: describeDraftLeg(l),
          player_name: l.player_name?.trim() || null,
          team_abbr: l.team_abbr?.trim().toUpperCase() || null,
        })),
      });
      haptics.success();
      await queryClient.invalidateQueries({ queryKey: ['bets'] });
      router.back();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Couldn't save that bet.");
    } finally {
      setBusy(null);
    }
  }

  function updateLeg(i: number, patch: Partial<DraftLeg>) {
    setDraft((d) => (d ? { ...d, legs: d.legs.map((l, j) => (j === i ? { ...l, ...patch, matched: undefined } : l)) } : d));
  }

  if (!draft) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Stack.Screen options={{ title: 'Add a bet' }} />
        <Pressable
          onPress={() => void readScreenshot()}
          disabled={busy !== null}
          accessibilityRole="button"
          style={({ pressed }) => [styles.drop, pressed && styles.pressed]}>
          {busy === 'reading' ? <ActivityIndicator color={accent} /> : <Text style={styles.dropIcon}>🧾</Text>}
          <Text style={styles.dropTitle}>{busy === 'reading' ? 'Reading your slip…' : 'Choose a bet-slip screenshot'}</Text>
          <Text style={styles.soft}>
            Any sportsbook. The screenshot is read and then thrown away — only the legs you confirm are saved.
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setSource('manual');
            setDraft({ sportsbook: null, stake: null, odds_american: null, payout: null, legs: [{ ...EMPTY_LEG }] });
          }}
          disabled={busy !== null}
          accessibilityRole="button"
          style={styles.linkButton}>
          <Text style={[styles.linkText, { color: accent }]}>Or enter it by hand</Text>
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive">
      <Stack.Screen options={{ title: source === 'screenshot' ? 'Check your slip' : 'Enter your bet' }} />
      {source === 'screenshot' && <Text style={styles.soft}>Make sure every leg matches your slip before saving.</Text>}

      <View style={styles.grid}>
        <Field label="Sportsbook">
          <Input
            value={draft.sportsbook ?? ''}
            onChangeText={(v) => setDraft({ ...draft, sportsbook: v })}
            placeholder="DraftKings"
          />
        </Field>
        <Field label="Wager ($)">
          <Input
            value={str(draft.stake)}
            onChangeText={(v) => setDraft({ ...draft, stake: num(v) })}
            keyboardType="decimal-pad"
          />
        </Field>
        <Field label="Odds">
          <Input
            value={str(draft.odds_american)}
            onChangeText={(v) => setDraft({ ...draft, odds_american: num(v) })}
            keyboardType="numbers-and-punctuation"
            placeholder="+450"
          />
        </Field>
        <Field label="Payout ($)">
          <Input
            value={str(draft.payout)}
            onChangeText={(v) => setDraft({ ...draft, payout: num(v) })}
            keyboardType="decimal-pad"
            placeholder="Auto"
          />
        </Field>
      </View>

      {draft.legs.map((leg, i) => (
        <View key={i} style={styles.leg}>
          <View style={styles.legTop}>
            <Text style={styles.legTitle}>
              Leg {i + 1}
              {leg.matched === false ? <Text style={styles.warn}> · game not found this week</Text> : null}
            </Text>
            {draft.legs.length > 1 && (
              <Pressable
                onPress={() => setDraft({ ...draft, legs: draft.legs.filter((_, j) => j !== i) })}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove leg ${i + 1}`}>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            )}
          </View>
          <Chips
            options={MARKETS}
            value={leg.market}
            onChange={(m) => updateLeg(i, { market: m, direction: m === 'player_prop' || m === 'total' ? 'over' : null })}
          />
          {leg.market === 'player_prop' && (
            <>
              <View style={styles.row}>
                <Field label="Player" flex={3}>
                  <Input
                    value={leg.player_name ?? ''}
                    onChangeText={(v) => updateLeg(i, { player_name: v })}
                    placeholder="Jahmyr Gibbs"
                  />
                </Field>
                <Field label="Team" flex={1}>
                  <Input
                    value={leg.team_abbr ?? ''}
                    onChangeText={(v) => updateLeg(i, { team_abbr: v })}
                    placeholder="DET"
                    autoCapitalize="characters"
                    maxLength={4}
                  />
                </Field>
              </View>
              <Field label="Stat">
                <Chips
                  options={BET_STATS}
                  value={leg.stat_key ?? ''}
                  scroll
                  onChange={(k) =>
                    updateLeg(i, {
                      stat_key: k,
                      direction: k === 'anytime_td' ? 'yes' : leg.direction === 'yes' ? 'over' : leg.direction,
                    })
                  }
                />
              </Field>
            </>
          )}
          {leg.market !== 'player_prop' && leg.market !== 'other' && (
            <Field label={leg.market === 'total' ? 'Either team' : 'Team'}>
              <Input
                value={leg.team_abbr ?? ''}
                onChangeText={(v) => updateLeg(i, { team_abbr: v })}
                placeholder="KC"
                autoCapitalize="characters"
                maxLength={4}
              />
            </Field>
          )}
          {(leg.market === 'player_prop' || leg.market === 'total') && (
            <View style={styles.row}>
              <Field label="Pick" flex={1}>
                <Chips
                  options={
                    leg.market === 'player_prop' && leg.stat_key === 'anytime_td'
                      ? [
                          { key: 'yes' as BetDirection, label: 'Yes' },
                          { key: 'no' as BetDirection, label: 'No' },
                        ]
                      : [
                          { key: 'over' as BetDirection, label: 'Over' },
                          { key: 'under' as BetDirection, label: 'Under' },
                        ]
                  }
                  value={leg.direction ?? 'over'}
                  onChange={(d) => updateLeg(i, { direction: d })}
                />
              </Field>
              <Field label={leg.stat_key === 'anytime_td' && leg.market === 'player_prop' ? 'TDs needed' : 'Line'} flex={1}>
                <Input
                  value={str(leg.line)}
                  onChangeText={(v) => updateLeg(i, { line: num(v) })}
                  keyboardType="decimal-pad"
                  placeholder={leg.stat_key === 'anytime_td' ? '1' : '79.5'}
                />
              </Field>
            </View>
          )}
          {leg.market === 'spread' && (
            <Field label="Line">
              <Input
                value={str(leg.line)}
                onChangeText={(v) => updateLeg(i, { line: num(v) })}
                keyboardType="numbers-and-punctuation"
                placeholder="-3.5"
              />
            </Field>
          )}
          {leg.market === 'other' && (
            <Field label="What's the bet?">
              <Input
                value={leg.description}
                onChangeText={(v) => updateLeg(i, { description: v })}
                placeholder="First TD scorer: Amon-Ra St. Brown"
              />
            </Field>
          )}
        </View>
      ))}

      <Pressable
        onPress={() => setDraft({ ...draft, legs: [...draft.legs, { ...EMPTY_LEG }] })}
        accessibilityRole="button"
        style={styles.linkButton}>
        <Text style={[styles.linkText, { color: accent }]}>+ Add a leg</Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        onPress={() => void save()}
        disabled={busy !== null}
        accessibilityRole="button"
        style={[styles.primary, { backgroundColor: accent }, busy !== null && styles.dim]}>
        {busy === 'saving' ? <ActivityIndicator color="#06110a" /> : <Text style={styles.primaryText}>Save bet</Text>}
      </Pressable>
      <Pressable onPress={() => setDraft(null)} accessibilityRole="button" style={styles.linkButton}>
        <Text style={styles.soft}>Start over</Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({ label, flex, children }: { label: string; flex?: number; children: React.ReactNode }) {
  return (
    <View style={[styles.field, flex !== undefined && { flex }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={Colors.textSecondary} autoCorrect={false} {...props} style={styles.input} />;
}

function Chips<T extends string>({
  options,
  value,
  onChange,
  scroll,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  scroll?: boolean;
}) {
  const accent = useAppearance().accent;
  const chips = options.map((o) => {
    const on = o.key === value;
    return (
      <Pressable
        key={o.key}
        onPress={() => {
          haptics.select();
          onChange(o.key);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={[styles.chip, on && { backgroundColor: accent, borderColor: accent }]}>
        <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled">
        {chips}
      </ScrollView>
    );
  }
  return <View style={[styles.chips, styles.wrap]}>{chips}</View>;
}

function str(n: number | null): string {
  return n === null || n === undefined ? '' : String(n);
}

function num(value: string): number | null {
  if (value.trim() === '' || value.trim() === '-' || value.trim() === '+') return null;
  const n = Number(value.replace('+', ''));
  return Number.isFinite(n) ? n : null;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 3, gap: Spacing.md },
  soft: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  error: { color: Colors.loss, fontSize: 13 },
  pressed: { opacity: 0.7 },
  dim: { opacity: 0.6 },
  drop: {
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.xl * 1.5,
    paddingHorizontal: Spacing.lg,
  },
  dropIcon: { fontSize: 34 },
  dropTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  linkButton: { alignItems: 'center', paddingVertical: Spacing.sm },
  linkText: { fontSize: 14, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.sm },
  field: { gap: 4, minWidth: '45%', flexGrow: 1 },
  fieldLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  input: {
    backgroundColor: Colors.tile,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
  },
  leg: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  legTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  legTitle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  warn: { color: '#f59e0b', textTransform: 'none' },
  remove: { color: Colors.loss, fontSize: 12, fontWeight: '600' },
  chips: { flexDirection: 'row', gap: 6 },
  wrap: { flexWrap: 'wrap' },
  chip: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: Colors.text, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#06110a' },
  primary: { borderRadius: Radius.pill, paddingVertical: 13, alignItems: 'center' },
  primaryText: { color: '#06110a', fontSize: 15, fontWeight: '700' },
});
