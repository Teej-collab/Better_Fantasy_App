import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { NeonPanel } from '@/components/NeonPanel';
import { PositionStripe } from '@/components/PositionStripe';
import { posLabel } from '@/components/warroom/parts';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, SectionColors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { queryClient, useMe, useMyKeepers } from '@/lib/queries';
import { positionColor } from '@/lib/positionColors';
import type { KeeperCostMode, KeeperRules, MyKeepers } from '@/lib/types';

// Keepers lock automatically when the draft starts; the warning shows
// in the last hour (same window as the web's KeepersPanel).
const AUTO_LOCK_WINDOW_MS = 60 * 60 * 1000;

function useAutoLockCountdown(scheduledStart: string | null, locked: boolean): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      if (!scheduledStart || locked) return setText(null);
      const diff = new Date(scheduledStart).getTime() - Date.now();
      if (diff <= 0 || diff > AUTO_LOCK_WINDOW_MS) return setText(null);
      const total = Math.floor(diff / 1000);
      setText(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`);
    };
    const kickoff = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [scheduledStart, locked]);
  return text;
}

// Keepers (2026-10-28, the approved War Room mockup): your keeper spots
// up top, then last season's roster sorted by who's worth keeping, each
// with last year's finish, ADP and a keep-or-let-go read (keepers use
// your final-round picks, so keep the ones who won't last to your
// early picks). The commissioner's rules editor sits below.
export default function KeepersScreen() {
  const me = useMe().data;
  const q = useMyKeepers();
  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load keepers." />;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl />} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <Stack.Screen options={{ title: 'Keepers' }} />
      <KeeperPicker key={q.data.selections.map((s) => s.espn_player_id).join(',')} data={q.data} />
      {me?.is_commissioner && <CommissionerRules key={q.data.rules.season} rules={q.data.rules} />}
    </ScrollView>
  );
}

function untilText(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d >= 1 ? `${d}d ${String(h).padStart(2, '0')}h` : h >= 1 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

const COST_NOTE: Record<KeeperCostMode, string> = {
  last_round: 'Keepers use your last picks: the final round, then the one before.',
  round_drafted: 'A keeper costs the round he was drafted in last year. Free-agent pickups cost your last round.',
  escalating: 'A keeper costs the round he was drafted in, and gets more expensive every year you keep him.',
};

const COST_OPTIONS: { value: KeeperCostMode; label: string; hint: string }[] = [
  { value: 'last_round', label: 'Last round', hint: "ESPN's default: keepers use your final picks." },
  { value: 'round_drafted', label: 'Round drafted', hint: 'He costs the round he went in last year. Pickups cost the last round.' },
  { value: 'escalating', label: 'Earlier each year', hint: 'Round drafted, then earlier for every year he is kept.' },
];

const TONE: Record<string, string> = { keep: Colors.accent, let_go: '#facc15', toss_up: '#aeb5c1' };

function KeeperPicker({ data }: { data: MyKeepers }) {
  const { rules, roster_pool: pool } = data;
  const [selected, setSelected] = useState<Set<number>>(() => new Set(data.selections.map((s) => s.espn_player_id)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countdown = useAutoLockCountdown(rules.draft_scheduled_start, Boolean(rules.locked_at));
  const saved = new Set(data.selections.map((s) => s.espn_player_id));
  const dirty = saved.size !== selected.size || [...selected].some((id) => !saved.has(id));
  const until = untilText(rules.keeper_deadline);

  // Worth keeping first: eligible players by ADP, then the rest.
  const sorted = [...pool].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return (a.adp ?? 999) - (b.adp ?? 999);
  });
  const keptPlayers = pool.filter((p) => selected.has(p.espn_player_id));

  function toggle(id: number) {
    void Haptics.selectionAsync();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < rules.max_keepers) next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveKeepers([...selected]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await queryClient.invalidateQueries({ queryKey: ['my-keepers'] });
      void queryClient.invalidateQueries({ queryKey: ['war-room'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your keepers");
    } finally {
      setSaving(false);
    }
  }

  if (rules.max_keepers === 0) {
    return (
      <View style={styles.gap}>
        <Display style={styles.title}>Keepers</Display>
        <Text style={styles.soft}>Keepers aren&apos;t open for {rules.season} yet. Your commissioner sets how many and when.</Text>
      </View>
    );
  }

  return (
    <View style={styles.gap}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>WAR ROOM · {rules.season}</Text>
          <Display style={styles.title}>Keepers</Display>
        </View>
        {rules.is_open && until ? (
          <View style={styles.until}>
            <Text style={styles.untilBig}>{until}</Text>
            <Text style={styles.small}>until they lock</Text>
          </View>
        ) : null}
      </View>

      {!rules.is_open && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            {rules.locked_at ? 'Keepers are locked in for this season.' : 'The keeper deadline has passed.'} Your picks are final.
          </Text>
        </View>
      )}
      {rules.is_open && countdown && (
        <View style={[styles.notice, styles.urgent]}>
          <Text style={styles.urgentText}>The draft starts soon: keepers lock automatically in {countdown}.</Text>
        </View>
      )}

      <View style={styles.slots}>
        {Array.from({ length: rules.max_keepers }, (_, i) => {
          const p = keptPlayers[i];
          return p ? (
            <View key={i} style={[styles.slot, styles.slotOn]}>
              <Text style={[styles.slotLabel, { color: Colors.accent }]}>KEEPER {i + 1}</Text>
              <Text style={styles.slotName} numberOfLines={2}>
                {p.player_name}
              </Text>
              <Text style={styles.small}>
                {posLabel(p.position)}
                {p.pro_team ? ` · ${p.pro_team}` : ''} · {p.consecutive_years_if_kept === 1 ? 'first year kept' : `year ${p.consecutive_years_if_kept} kept`}
              </Text>
              {p.cost_round || p.tag_fee ? (
                <Text style={styles.cost}>
                  {[p.cost_round ? `Round ${p.cost_round} pick` : null, p.tag_fee ? `$${p.tag_fee} tag fee` : null].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
          ) : (
            <View key={i} style={[styles.slot, styles.slotEmpty]}>
              <Text style={styles.slotLabel}>KEEPER {i + 1}</Text>
              <Text style={styles.soft}>{rules.is_open ? 'Pick one below' : 'Not used'}</Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.eyebrow}>LAST SEASON&apos;S ROSTER · WHO&apos;S WORTH IT</Text>
      {pool.length === 0 && <Text style={styles.muted}>No roster found from last season to pick keepers from.</Text>}
      {sorted.map((p) => {
        const on = selected.has(p.espn_player_id);
        const disabled = !rules.is_open || (!on && (!p.eligible || selected.size >= rules.max_keepers));
        const meta = [p.last_season, p.adp != null ? `ADP ${Math.round(p.adp)}` : null].filter(Boolean).join(' · ') || (p.pro_team ?? '');
        const fee = p.eligible && p.tag_fee ? ` · year ${p.consecutive_years_if_kept} tag: $${p.tag_fee}` : '';
        const cost = p.eligible && p.cost_round ? `Costs your round ${p.cost_round} pick${fee}` : fee ? fee.slice(3) : null;
        const verdict = !p.eligible
          ? rules.max_consecutive_years
            ? `Kept ${rules.max_consecutive_years} years in a row, the league max`
            : "Can't be kept this year"
          : on
            ? p.consecutive_years_if_kept > 1
              ? `Keeping him: year ${p.consecutive_years_if_kept}${rules.max_consecutive_years ? ` of ${rules.max_consecutive_years}` : ''}`
              : 'Keeping him'
            : p.verdict;
        const color = !p.eligible ? Colors.textSecondary : on ? Colors.accent : TONE[p.verdict_tone ?? ''] ?? Colors.textSecondary;
        return (
          <Pressable
            key={p.espn_player_id}
            disabled={disabled}
            onPress={() => toggle(p.espn_player_id)}
            accessibilityRole="switch"
            accessibilityLabel={`${p.player_name}, ${posLabel(p.position)}${verdict ? `. ${verdict}` : ''}`}
            accessibilityState={{ checked: on, disabled }}
            style={[styles.card, on && styles.cardOn, disabled && !on && styles.dimmed]}>
            <PositionStripe position={p.position} />
            <View style={styles.flex}>
              <Text style={styles.name}>
                {p.player_name} <Text style={[styles.posInline, { color: positionColor(p.position) }]}>{posLabel(p.position)}</Text>
              </Text>
              {meta ? <Text style={styles.small}>{meta}</Text> : null}
              {cost ? <Text style={styles.cost}>{cost}</Text> : null}
              {verdict ? <Text style={[styles.verdict, { color }]}>{verdict}</Text> : null}
            </View>
            <View style={[styles.toggle, on && styles.toggleOn]}>
              <View style={[styles.knob, on && styles.knobOn]} />
            </View>
          </Pressable>
        );
      })}
      {pool.some((p) => p.verdict) && (
        <Text style={styles.small}>
          {COST_NOTE[rules.cost_mode ?? 'last_round']}
          {rules.tag_fees && rules.tag_fees.some((f) => f > 0)
            ? ` Franchise tag: ${rules.tag_fees.map((f, i) => `year ${i + 1} ${f > 0 ? `$${f}` : 'free'}`).join(', ')}, paid to the league kitty when keepers lock.`
            : ''}{' '}
          The reads compare each player&apos;s ADP to what he costs.
        </Text>
      )}

      {rules.is_open && (
        <Pressable onPress={save} disabled={saving || !dirty} accessibilityRole="button" style={[styles.primary, (saving || !dirty) && styles.disabledBtn]}>
          {saving ? (
            <ActivityIndicator color="#0d1016" />
          ) : (
            <Text style={styles.primaryText}>{dirty ? `Save keepers (${selected.size} of ${rules.max_keepers})` : 'Saved'}</Text>
          )}
        </Pressable>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

// "2026-08-28 18:00" (local) ⇄ ISO. A plain text field rather than a
// date picker, matching the web's datetime-local input.
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(text: string): string | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return 'invalid';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
}

function CommissionerRules({ rules }: { rules: KeeperRules }) {
  const [maxKeepers, setMaxKeepers] = useState(String(rules.max_keepers || 1));
  const [maxYears, setMaxYears] = useState(rules.max_consecutive_years ? String(rules.max_consecutive_years) : '');
  const [deadline, setDeadline] = useState(toLocalInput(rules.keeper_deadline));
  const [costMode, setCostMode] = useState<KeeperCostMode>(rules.cost_mode ?? 'last_round');
  const [costStep, setCostStep] = useState(String(rules.cost_step ?? 1));
  const [feesOn, setFeesOn] = useState(Boolean(rules.tag_fees && rules.tag_fees.some((f) => f > 0)));
  const [fees, setFees] = useState<string[]>(() => {
    const years = Math.max(3, rules.max_consecutive_years ?? 3, rules.tag_fees?.length ?? 0);
    return Array.from({ length: years }, (_, i) => String(rules.tag_fees?.[i] ?? 0));
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await queryClient.invalidateQueries({ queryKey: ['my-keepers'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That failed');
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const iso = fromLocalInput(deadline);
    if (iso === 'invalid') {
      setError('Deadline must look like 2026-08-28 18:00 (or be blank).');
      return;
    }
    void run(() =>
      api.setKeeperRules({
        season: rules.season,
        max_keepers: Number(maxKeepers) || 0,
        max_consecutive_years: maxYears ? Number(maxYears) : null,
        keeper_deadline: iso,
        cost_mode: costMode,
        cost_step: Math.max(1, Math.min(5, Number(costStep) || 1)),
        tag_fees: feesOn ? fees.map((f) => Math.max(0, Number(f) || 0)) : [],
      }),
    );
  }

  return (
    <NeonPanel color={SectionColors.keepers} contentStyle={styles.gap}>
      <Text style={styles.heading}>Keeper rules for {rules.season} (Commissioner)</Text>
      <Field label="Max keepers" value={maxKeepers} onChange={setMaxKeepers} numeric />
      <Field label="Max consecutive years (blank = no cap)" value={maxYears} onChange={setMaxYears} numeric />
      <Field label="Deadline (blank = none)" value={deadline} onChange={setDeadline} placeholder="2026-08-28 18:00" />
      <View style={styles.field}>
        <Text style={styles.small}>What a keeper costs</Text>
        <View style={styles.segments} accessibilityRole="radiogroup">
          {COST_OPTIONS.map((o) => {
            const on = costMode === o.value;
            return (
              <Pressable
                key={o.value}
                onPress={() => setCostMode(o.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={[styles.segment, on && styles.segmentOn]}>
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.small}>{COST_OPTIONS.find((o) => o.value === costMode)?.hint}</Text>
      </View>
      {costMode === 'escalating' && (
        <Field label="Rounds earlier for each year kept (1 to 5)" value={costStep} onChange={setCostStep} numeric />
      )}
      <View style={styles.field}>
        <Pressable onPress={() => setFeesOn((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: feesOn }} style={styles.feeToggle}>
          <View style={[styles.toggle, feesOn && styles.toggleOn]}>
            <View style={[styles.knob, feesOn && styles.knobOn]} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.body}>Franchise tag fees</Text>
            <Text style={styles.small}>A price for each year in a row a player is kept, billed to the league kitty when keepers lock.</Text>
          </View>
        </Pressable>
        {feesOn && (
          <View style={styles.fees}>
            {fees.map((f, i) => (
              <View key={i} style={styles.feeField}>
                <Text style={styles.small}>Year {i + 1} $</Text>
                <TextInput
                  value={f}
                  onChangeText={(v) => setFees((prev) => prev.map((x, j) => (j === i ? v.replace(/[^0-9.]/g, '') : x)))}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Year ${i + 1} tag fee in dollars`}
                  style={styles.input}
                />
              </View>
            ))}
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable onPress={save} disabled={busy || Boolean(rules.locked_at)} style={[styles.secondary, (busy || rules.locked_at) && styles.disabledBtn]}>
          <Text style={styles.body}>Save rules</Text>
        </Pressable>
        <Pressable
          onPress={() => run(() => api.setKeepersLocked(rules.season, !rules.locked_at))}
          disabled={busy}
          style={[styles.secondary, busy && styles.disabledBtn]}>
          <Text style={styles.body}>{rules.locked_at ? 'Unlock keepers' : 'Lock keepers'}</Text>
        </Pressable>
      </View>
      {rules.locked_at && <Text style={styles.small}>Locked {new Date(rules.locked_at).toLocaleString()}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
    </NeonPanel>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean; placeholder?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.small}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        keyboardType={props.numeric ? 'number-pad' : 'default'}
        placeholder={props.placeholder}
        placeholderTextColor="rgba(255,255,255,0.3)"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.xl },
  title: { color: Colors.text, fontSize: 32 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  eyebrow: { color: Colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  until: { alignItems: 'flex-end' },
  untilBig: { color: '#facc15', fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  gap: { gap: Spacing.md },
  flex: { flex: 1, minWidth: 0, gap: 3 },
  heading: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
  body: { color: Colors.text, fontSize: 14 },
  soft: { color: '#aeb5c1', fontSize: 14, lineHeight: 20 },
  muted: { color: Colors.textSecondary, fontSize: 14 },
  small: { color: Colors.textSecondary, fontSize: 12 },
  notice: { borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.06)', padding: Spacing.sm },
  noticeText: { color: 'rgba(255,255,255,0.75)', fontSize: 13 },
  urgent: { borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.06)' },
  urgentText: { color: '#f87171', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  slot: { flexGrow: 1, flexBasis: '45%', minHeight: 92, borderRadius: Radius.lg, padding: 12, gap: 4 },
  slotOn: { backgroundColor: `${Colors.accent}14`, borderWidth: 1, borderColor: Colors.accent },
  slotEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#343b47', alignItems: 'center', justifyContent: 'center' },
  slotLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  slotName: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: Radius.lg, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, padding: 12 },
  cardOn: { borderColor: Colors.accent },
  dimmed: { opacity: 0.5 },
  name: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  posInline: { fontSize: 12, fontWeight: '800' },
  verdict: { fontSize: 12, fontWeight: '700' },
  cost: { color: '#c084fc', fontSize: 12, fontWeight: '700' },
  feeToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  fees: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  feeField: { flexBasis: '30%', flexGrow: 1, gap: 4 },
  segments: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segment: { minHeight: 40, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, justifyContent: 'center' },
  segmentOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  segmentText: { color: '#aeb5c1', fontSize: 13, fontWeight: '600' },
  segmentTextOn: { color: '#0d1016', fontWeight: '800' },
  toggle: { width: 52, height: 32, borderRadius: 16, backgroundColor: '#2a303a', padding: 3, justifyContent: 'center' },
  toggleOn: { backgroundColor: Colors.accent, alignItems: 'flex-end' },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.textSecondary },
  knobOn: { backgroundColor: '#0d1016' },
  primary: { minHeight: 48, borderRadius: Radius.pill, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  primaryText: { color: '#0d1016', fontSize: 15, fontWeight: '800' },
  disabledBtn: { opacity: 0.45 },
  error: { color: Colors.loss, fontSize: 14 },
  field: { gap: 4 },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  secondary: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 6 },
});
