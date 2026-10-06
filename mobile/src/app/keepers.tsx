import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { NeonPanel } from '@/components/NeonPanel';
import { PositionStripe } from '@/components/PositionStripe';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, SectionColors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useMe, useMyKeepers } from '@/lib/queries';
import type { KeeperRules, MyKeepers } from '@/lib/types';

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

// Port of the web's /keepers (KeepersPanel.tsx): pick up to the
// season's max keepers from last season's roster, plus the
// commissioner's rules editor and lock.
export default function KeepersScreen() {
  const me = useMe().data;
  const q = useMyKeepers();
  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load keepers." />;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl />} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <Stack.Screen options={{ title: 'Keepers' }} />
      <Display style={styles.title}>Keepers</Display>
      {me?.is_commissioner && <CommissionerRules key={q.data.rules.season} rules={q.data.rules} />}
      <KeeperPicker key={q.data.selections.map((s) => s.espn_player_id).join(',')} data={q.data} />
    </ScrollView>
  );
}

function KeeperPicker({ data }: { data: MyKeepers }) {
  const accent = useAppearance().accent;
  const { rules, roster_pool: pool } = data;
  const [selected, setSelected] = useState<Set<number>>(() => new Set(data.selections.map((s) => s.espn_player_id)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countdown = useAutoLockCountdown(rules.draft_scheduled_start, Boolean(rules.locked_at));

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your keepers");
    } finally {
      setSaving(false);
    }
  }

  return (
    <NeonPanel color={SectionColors.keepers} contentStyle={styles.gap}>
      {rules.max_keepers === 0 ? (
        <Text style={styles.soft}>Keeper selection hasn&apos;t been opened for this season yet.</Text>
      ) : (
        <>
          <View style={styles.headRow}>
            <Text style={[styles.soft, styles.flex]}>
              Pick up to <Text style={styles.bold}>{rules.max_keepers}</Text> keeper{rules.max_keepers === 1 ? '' : 's'} from last
              season&apos;s roster.
              {rules.keeper_deadline ? ` Deadline: ${new Date(rules.keeper_deadline).toLocaleString()}.` : ''}
            </Text>
            <Text style={styles.count}>
              {selected.size} / {rules.max_keepers} selected
            </Text>
          </View>
          {!rules.is_open && (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                {rules.locked_at
                  ? 'Keepers are locked in for this season — selections are read-only.'
                  : 'The keeper deadline has passed — selections are read-only.'}
              </Text>
            </View>
          )}
          {rules.is_open && countdown && (
            <View style={[styles.notice, styles.urgent]}>
              <Text style={styles.urgentText}>Draft starts soon — keepers lock automatically in {countdown}.</Text>
            </View>
          )}
          <View>
            {pool.length === 0 && <Text style={styles.muted}>No roster found from last season to pick keepers from.</Text>}
            {pool.map((p, i) => {
              const on = selected.has(p.espn_player_id);
              const disabled = !rules.is_open || (!on && (!p.eligible || selected.size >= rules.max_keepers));
              return (
                <Pressable
                  key={p.espn_player_id}
                  disabled={disabled}
                  onPress={() => toggle(p.espn_player_id)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${p.player_name}, ${p.position ?? 'no position'}${p.pro_team ? `, ${p.pro_team}` : ''}${!p.eligible ? ', max years kept reached' : ''}`}
                  accessibilityState={{ checked: on, disabled }}
                  style={[styles.row, i > 0 && styles.divided, disabled && !on && styles.dimmed]}>
                  <PositionStripe position={p.position} />
                  <View style={styles.flex}>
                    <Text style={styles.name}>{p.player_name}</Text>
                    <Text style={styles.small}>
                      {p.position ?? '—'} {p.pro_team ? `· ${p.pro_team}` : ''}
                      {!p.eligible ? ' · max years kept reached' : ''}
                    </Text>
                  </View>
                  <View style={[styles.checkbox, on && { backgroundColor: accent, borderColor: accent }]}>
                    {on && <Text style={styles.check}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {rules.is_open && (
            <Pressable onPress={save} disabled={saving} style={[styles.primary, { backgroundColor: accent }, saving && styles.disabledBtn]}>
              {saving ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryText}>Save keepers</Text>}
            </Pressable>
          )}
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </NeonPanel>
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
      }),
    );
  }

  return (
    <NeonPanel color={SectionColors.keepers} contentStyle={styles.gap}>
      <Text style={styles.heading}>Keeper rules for {rules.season} (Commissioner)</Text>
      <Field label="Max keepers" value={maxKeepers} onChange={setMaxKeepers} numeric />
      <Field label="Max consecutive years (blank = no cap)" value={maxYears} onChange={setMaxYears} numeric />
      <Field label="Deadline (blank = none)" value={deadline} onChange={setDeadline} placeholder="2026-08-28 18:00" />
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
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  title: { fontSize: 24, textTransform: 'none', letterSpacing: 0 },
  gap: { gap: Spacing.md },
  flex: { flex: 1 },
  heading: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
  body: { color: Colors.text, fontSize: 14 },
  bold: { fontWeight: '700', color: Colors.text },
  soft: { color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20 },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  count: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '500' },
  headRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, alignItems: 'center' },
  notice: { borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.06)', padding: Spacing.sm },
  noticeText: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  urgent: { borderColor: 'rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.06)' },
  urgentText: { color: '#f87171', fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.05)' },
  dimmed: { opacity: 0.4 },
  name: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
  check: { color: '#06110a', fontSize: 14, fontWeight: '800' },
  primary: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, minWidth: 130, alignItems: 'center' },
  primaryText: { color: '#000', fontSize: 14, fontWeight: '500' },
  disabledBtn: { opacity: 0.4 },
  error: { color: Colors.loss, fontSize: 14 },
  field: { gap: 4 },
  input: { backgroundColor: Colors.surface,
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
