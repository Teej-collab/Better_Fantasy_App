import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { BetLinkReader } from '@/components/bets/BetLinkReader';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { BET_STATS, describeDraftLeg, pickSlipScreenshot, prepareSlipImage } from '@/lib/bets';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';
import { takeSharedSlip } from '@/lib/shareIntent';
import type { BetDirection, BetMarket, DraftBet, DraftLeg, ParsedSlip } from '@/lib/types';

// Add a bet (port of the web's AddBetFlow): a bet-slip screenshot read by
// Claude on the server — then thrown away — or typed in by hand. Every
// bet on the screenshot gets a "Does this look right?" card: a clean
// read saves with one tap, and anything the reader wasn't sure of opens
// in the editor with those legs marked.

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

// One bet read off a screenshot, on the "Does this look right?" list.
type Slip = { draft: DraftBet; ready: boolean; saved: boolean };

function cleanLegs(draft: DraftBet): DraftBet {
  return {
    ...draft,
    legs: draft.legs.map((l) => ({
      ...l,
      description: describeDraftLeg(l),
      player_name: l.player_name?.trim() || null,
      team_abbr: l.team_abbr?.trim().toUpperCase() || null,
    })),
  };
}

export default function AddBetScreen() {
  const accent = useAppearance().accent;
  // A slip shared in from a sportsbook app (lib/shareIntent.ts) is read
  // straight away — a screenshot, or a shared-bet link opened out of
  // sight first (components/bets/BetLinkReader.tsx).
  const { shared } = useLocalSearchParams<{ shared?: string }>();
  const [draft, setDraft] = useState<DraftBet | null>(null);
  const [source, setSource] = useState<'screenshot' | 'manual'>('manual');
  // Every bet on the screenshot, and which one is open in the editor.
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A shared-bet link being opened out of sight to read the bet off it.
  const [link, setLink] = useState<string | null>(null);
  // New bets go to league chat unless you switch it off; the wager and
  // payout never do.
  const [share, setShare] = useState(true);

  async function readImage(image: { base64: string; mediaType: string } | null) {
    if (!image) return;
    await readSlip(() => api.parseBetSlip(image.base64, image.mediaType));
  }

  async function readSlip(parse: () => Promise<ParsedSlip>, failure?: string) {
    setBusy('reading');
    try {
      const parsed = await parse();
      haptics.success();
      setSource('screenshot');
      const bets = parsed.bets ?? [parsed];
      const read = bets.map((b) => ({
        draft: { ...b, legs: b.legs.map((l) => ({ ...EMPTY_LEG, ...l })) },
        ready: b.ready ?? false,
        saved: false,
      }));
      setSlips(read);
      // One bet that needs fixing goes straight to the editor.
      if (read.length === 1 && !read[0].ready) {
        setEditing(0);
        setDraft(read[0].draft);
      }
    } catch (e) {
      haptics.error();
      setError(failure ?? (e instanceof Error ? e.message : "Couldn't read that slip."));
    } finally {
      setBusy(null);
    }
  }

  const LINK_FAILED = 'Couldn’t read the bet from that link. Take a screenshot of the slip and share that instead, or choose one below.';

  async function readScreenshot() {
    setError(null);
    let image: Awaited<ReturnType<typeof pickSlipScreenshot>>;
    try {
      image = await pickSlipScreenshot();
    } catch {
      setError("Couldn't open that screenshot.");
      return;
    }
    await readImage(image);
  }

  const sharedRead = useRef<string | null>(null);
  useEffect(() => {
    if (!shared || sharedRead.current === shared) return;
    sharedRead.current = shared;
    setError(null);
    setDraft(null);
    setEditing(null);
    setSlips(null);
    setBusy('reading');
    setLink(null);
    takeSharedSlip()
      .then(async (share) => {
        if (share?.kind === 'link') {
          setLink(share.url);
          return;
        }
        const image = share ? await prepareSlipImage(share.uri, 0, 0) : null;
        if (image) return readImage(image);
        setBusy(null);
        setError("That share didn't include a bet slip — share the slip's link or a screenshot, or choose one below.");
      })
      .catch(() => {
        setBusy(null);
        setError("Couldn't open that share.");
      });
    // Once per share; readImage is a fresh function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  function finishIfDone(next: Slip[]) {
    if (next.every((x) => x.saved)) {
      void queryClient.invalidateQueries({ queryKey: ['bets'] });
      router.back();
    }
  }

  // Saves the given slips (by index) as they are; the rest stay on the list.
  async function saveSlips(indexes: number[]) {
    if (!slips) return;
    setError(null);
    setBusy('saving');
    const next = [...slips];
    try {
      for (const i of indexes) {
        await api.createBet({ ...cleanLegs(next[i].draft), source: 'screenshot', share });
        next[i] = { ...next[i], saved: true };
      }
      haptics.success();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Couldn't save that bet.");
    } finally {
      setSlips(next);
      setBusy(null);
    }
    void queryClient.invalidateQueries({ queryKey: ['bets'] });
    finishIfDone(next);
  }

  async function save() {
    if (!draft) return;
    setError(null);
    setBusy('saving');
    try {
      await api.createBet({ ...cleanLegs(draft), source, share });
      haptics.success();
      await queryClient.invalidateQueries({ queryKey: ['bets'] });
      if (slips && editing !== null) {
        const next = slips.map((x, i) => (i === editing ? { ...x, draft, saved: true } : x));
        setSlips(next);
        setEditing(null);
        setDraft(null);
        finishIfDone(next);
        return;
      }
      router.back();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Couldn't save that bet.");
    } finally {
      setBusy(null);
    }
  }

  function startOver() {
    setDraft(null);
    setEditing(null);
    setSlips(null);
    setError(null);
  }

  function updateLeg(i: number, patch: Partial<DraftLeg>) {
    setDraft((d) =>
      d ? { ...d, legs: d.legs.map((l, j) => (j === i ? { ...l, ...patch, matched: undefined, needs_check: undefined } : l)) } : d,
    );
  }

  if (!draft && slips) {
    const readyToSave = slips.map((x, i) => (x.ready && !x.saved ? i : -1)).filter((i) => i >= 0);
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Stack.Screen options={{ title: 'Does this look right?' }} />
        <Text style={styles.soft}>
          {slips.length === 1 ? 'Here’s what your slip says.' : `Found ${slips.length} bets on your slip.`}
        </Text>
        {slips.map((slip, i) => (
          <SlipCard
            key={i}
            slip={slip}
            busy={busy !== null}
            onConfirm={() => void saveSlips([i])}
            onFix={() => {
              setEditing(i);
              setDraft(slip.draft);
            }}
          />
        ))}
        <ShareToggle value={share} onChange={setShare} />
        {error && <Text style={styles.error}>{error}</Text>}
        {readyToSave.length > 1 && (
          <Pressable
            onPress={() => void saveSlips(readyToSave)}
            disabled={busy !== null}
            accessibilityRole="button"
            style={[styles.primary, { backgroundColor: accent }, busy !== null && styles.dim]}>
            {busy === 'saving' ? <ActivityIndicator color="#06110a" /> : <Text style={styles.primaryText}>✓ Save All {readyToSave.length}</Text>}
          </Pressable>
        )}
        <Pressable onPress={startOver} accessibilityRole="button" style={styles.linkButton}>
          <Text style={styles.soft}>Start over</Text>
        </Pressable>
      </ScrollView>
    );
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
          <Text style={styles.dropTitle}>
            {busy !== 'reading' ? 'Choose a bet-slip screenshot' : link ? 'Opening your bet link…' : 'Reading your slip…'}
          </Text>
          <Text style={styles.soft}>
            Any sportsbook, one bet or several. The screenshot is read and then thrown away — only the bets you confirm are saved.
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
        {link && (
          <BetLinkReader
            url={link}
            onText={(text) => {
              const url = link;
              setLink(null);
              void readSlip(() => api.parseBetPage(url, text), LINK_FAILED);
            }}
            onFail={() => {
              setLink(null);
              setBusy(null);
              haptics.error();
              setError(LINK_FAILED);
            }}
          />
        )}
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
              {leg.matched === false ? (
                <Text style={styles.warn}> · game not found this week</Text>
              ) : leg.needs_check ? (
                <Text style={styles.warn}> · check this leg</Text>
              ) : null}
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
      <ShareToggle value={share} onChange={setShare} />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        onPress={() => void save()}
        disabled={busy !== null}
        accessibilityRole="button"
        style={[styles.primary, { backgroundColor: accent }, busy !== null && styles.dim]}>
        {busy === 'saving' ? <ActivityIndicator color="#06110a" /> : <Text style={styles.primaryText}>Save bet</Text>}
      </Pressable>
      <Pressable
        onPress={() => {
          if (slips && slips.length > 1) {
            setDraft(null);
            setEditing(null);
          } else startOver();
        }}
        accessibilityRole="button"
        style={styles.linkButton}>
        <Text style={styles.soft}>{slips && slips.length > 1 ? 'Back to your slip' : 'Start over'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function SlipCard({ slip, busy, onConfirm, onFix }: { slip: Slip; busy: boolean; onConfirm: () => void; onFix: () => void }) {
  const accent = useAppearance().accent;
  const d = slip.draft;
  const odds = d.odds_american === null ? null : d.odds_american > 0 ? `+${d.odds_american}` : String(d.odds_american);
  const head = [d.sportsbook, d.stake !== null ? `$${d.stake}` : 'Wager?', odds ?? (d.payout !== null ? `pays $${d.payout}` : 'Odds?')]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[styles.leg, slip.saved && styles.dim]}>
      <View style={styles.legTop}>
        <Text style={styles.legTitle}>{d.legs.length > 1 ? `${d.legs.length}-leg parlay` : 'Straight bet'}</Text>
        {slip.saved ? <Text style={[styles.savedText, { color: accent }]}>Saved ✓</Text> : null}
      </View>
      <Text style={styles.slipHead}>{head}</Text>
      {d.legs.map((l, j) => (
        <Text key={j} style={styles.slipLeg}>
          {l.needs_check || l.matched === false ? '⚠️ ' : '• '}
          {describeDraftLeg(l)}
        </Text>
      ))}
      {!slip.saved &&
        (slip.ready ? (
          <View style={styles.row}>
            <Pressable
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.confirm, { backgroundColor: accent }, busy && styles.dim]}>
              <Text style={styles.primaryText}>✓ Looks Right</Text>
            </Pressable>
            <Pressable onPress={onFix} disabled={busy} accessibilityRole="button" style={styles.fix}>
              <Text style={styles.fixText}>✗ Fix It</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.warn}>Some of this needs a quick look before it&apos;s saved.</Text>
            <Pressable onPress={onFix} disabled={busy} accessibilityRole="button" style={[styles.confirm, styles.fix]}>
              <Text style={styles.fixText}>Check It</Text>
            </Pressable>
          </>
        ))}
    </View>
  );
}

function ShareToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const accent = useAppearance().accent;
  const label = 'Share with my league';
  const hint = value ? 'Posts the picks to league chat. Your wager and payout stay private.' : 'Only you will see this bet.';
  return (
    <View style={styles.shareRow}>
      <View style={styles.shareText}>
        <Text style={styles.shareLabel}>{label}</Text>
        <Text style={styles.shareHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        accessibilityHint={hint}
        trackColor={{ true: accent, false: 'rgba(255,255,255,0.25)' }}
      />
    </View>
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
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  shareText: { flex: 1, gap: 2 },
  shareLabel: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  shareHint: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
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
  slipHead: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  slipLeg: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  savedText: { fontSize: 13, fontWeight: '700' },
  confirm: { flex: 1, borderRadius: Radius.pill, paddingVertical: 11, alignItems: 'center' },
  fix: { flex: 1, borderRadius: Radius.pill, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  fixText: { color: Colors.text, fontSize: 15, fontWeight: '700' },
});
