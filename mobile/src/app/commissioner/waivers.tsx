import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { CommishScreen, ErrorText, errorMessage } from '@/components/commissioner/CommishUI';
import { BigButton, Chips, formatWhen, PageTitle, Panel, partStyles as p, Segmented, SmallButton, SwitchRow } from '@/components/commissioner/CommishParts';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { queryClient, refreshCommish, useCommishWaivers } from '@/lib/queries';
import type { CommishWaivers, WaiverRules, WaiverType } from '@/lib/types';

// Waivers & free agents (2026-10-23 overhaul, mockup 3): the league's own
// waiver rules, which used to be fixed for everyone (backend app/domain/
// waiver_settings.py). How claims are decided, when they run, how long
// a dropped player waits, whether a player is held once his game starts,
// and whether results get posted. "Run now" runs every claim right away.

const TYPES: { value: WaiverType; label: string; help: string }[] = [
  { value: 'reverse', label: 'Worst first', help: 'The worst record gets first claim, and the order resets every week. Whoever wins a claim drops to the back for the rest of that week.' },
  { value: 'rolling', label: 'Rolling', help: 'Whoever wins a claim goes to the back of the line and stays there week to week. The line starts in reverse standings.' },
  { value: 'faab', label: 'FAAB bids', help: 'Everyone bids from a season budget, without seeing the other bids. The highest bid wins; ties go to whoever is higher in the line.' },
];
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const HOURS = [0, 3, 6, 9, 12, 18, 21];

function hourLabel(h: number): string {
  return `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
}

export default function WaiversScreen() {
  const q = useCommishWaivers();
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Waivers' }} />
      <PageTitle title="Waivers & free agents" />
      {!q.data ? (
        q.isPending ? <LoadingState /> : <ErrorText>{errorMessage(q.error, "Couldn't load your waiver rules.")}</ErrorText>
      ) : (
        <WaiverForm data={q.data} />
      )}
      <OffseasonPanel />
    </CommishScreen>
  );
}

// The offseason roster lock (2026-10-28, backend app/domain/offseason.py):
// no pickups between the end of the season and the draft until the
// commissioner clears the offseason. Trades still go.
function OffseasonPanel() {
  const q = useQuery({ queryKey: ['offseason'], queryFn: api.offseason });
  const [busy, setBusy] = useState(false);
  if (!q.data) return null;
  const state = q.data;

  async function change(body: { lock?: boolean; cleared?: boolean }) {
    setBusy(true);
    try {
      queryClient.setQueryData(['offseason'], await api.setOffseason(body));
      haptics.success();
    } catch (e) {
      Alert.alert("Couldn't save that", errorMessage(e, 'Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <SwitchRow
        first
        title="No pickups in the offseason"
        sub="From the end of the season until the draft, nobody adds a free agent or rookie. Rostered players can still be traded."
        value={state.lock}
        onChange={(v) => void change({ lock: v })}
      />
      {state.lock && (
        <View style={styles.offseason}>
          <Text style={styles.offseasonText}>
            {state.cleared
              ? 'You cleared the offseason: free agency is open.'
              : state.blocked_now
                ? 'Pickups are closed right now.'
                : 'Pickups close when the season ends.'}
          </Text>
          <SmallButton
            label={state.cleared ? 'Close pickups again' : 'Clear the offseason'}
            disabled={busy}
            onPress={() => void change({ cleared: !state.cleared })}
          />
        </View>
      )}
    </Panel>
  );
}

function WaiverForm({ data }: { data: CommishWaivers }) {
  const accent = useAppearance().accent;
  const [rules, setRules] = useState<WaiverRules>(data.settings);
  const [budget, setBudget] = useState(String(data.settings.faab_budget));
  const [minBid, setMinBid] = useState(String(data.settings.min_bid));
  const [busy, setBusy] = useState<'save' | 'run' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof WaiverRules>(key: K, value: WaiverRules[K]) => setRules((r) => ({ ...r, [key]: value }));

  async function save() {
    const b = parseInt(budget, 10), m = parseInt(minBid, 10);
    if (rules.waiver_type === 'faab' && (!Number.isFinite(b) || b < 1 || !Number.isFinite(m) || m < 0 || m > b)) {
      setError('The budget has to be at least $1, and the lowest bid between $0 and the budget.');
      return;
    }
    setBusy('save');
    setError(null);
    setMessage(null);
    try {
      await api.saveWaiverRules({ ...rules, faab_budget: Number.isFinite(b) ? b : rules.faab_budget, min_bid: Number.isFinite(m) ? m : rules.min_bid });
      haptics.success();
      setMessage('Saved. New claims follow these rules.');
      await Promise.all([refreshCommish(), queryClient.invalidateQueries({ queryKey: ['waiver-claims'] })]);
    } catch (e) {
      haptics.error();
      setError(errorMessage(e, "Couldn't save your waiver rules."));
    } finally {
      setBusy(null);
    }
  }

  function runNow() {
    Alert.alert('Run waivers now?', 'Every player on waivers clears right away, and every claim is decided now instead of at the next run.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Run now',
        onPress: async () => {
          setBusy('run');
          setError(null);
          try {
            const result = await api.runWaiversNow();
            haptics.success();
            setMessage(`Done. ${result.players} player${result.players === 1 ? '' : 's'} cleared and ${result.claims_won} claim${result.claims_won === 1 ? '' : 's'} won.`);
            await refreshCommish();
          } catch (e) {
            haptics.error();
            setError(errorMessage(e, "Couldn't run waivers."));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  const type = TYPES.find((t) => t.value === rules.waiver_type)!;
  return (
    <>
      <Panel color={accent}>
        <View style={styles.status}>
          <View style={p.flex}>
            <Text style={styles.statusTitle}>
              {data.pending_claims} claim{data.pending_claims === 1 ? '' : 's'} waiting
            </Text>
            <Text style={p.sub}>
              {data.players_on_waivers} player{data.players_on_waivers === 1 ? '' : 's'} on waivers
              {data.next_run_at ? ` · next clears ${formatWhen(data.next_run_at)}` : ''}
            </Text>
          </View>
          <SmallButton label={busy === 'run' ? 'Running…' : 'Run now'} disabled={!!busy || data.players_on_waivers === 0} onPress={runNow} />
        </View>
      </Panel>

      <View style={styles.section}>
        <Text style={p.label}>How claims are decided</Text>
        <Segmented options={TYPES.map((t) => ({ value: t.value, label: t.label }))} value={rules.waiver_type} onChange={(v) => set('waiver_type', v)} />
        <Text style={p.sub}>{type.help}</Text>
        {rules.waiver_type === 'faab' ? (
          <View style={styles.pair}>
            <View style={styles.field}>
              <Text style={p.sub}>Season budget ($)</Text>
              <TextInput value={budget} onChangeText={setBudget} keyboardType="number-pad" style={p.input} accessibilityLabel="Season budget in dollars" />
            </View>
            <View style={styles.field}>
              <Text style={p.sub}>Lowest bid ($)</Text>
              <TextInput value={minBid} onChangeText={setMinBid} keyboardType="number-pad" style={p.input} accessibilityLabel="Lowest bid in dollars" />
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={p.label}>When claims run (ET)</Text>
        <Chips options={DAYS.map((d, i) => ({ value: i, label: d }))} value={rules.clear_weekday} onChange={(v) => set('clear_weekday', v)} />
        <Chips options={HOURS.map((h) => ({ value: h, label: hourLabel(h) }))} value={rules.clear_hour} onChange={(v) => set('clear_hour', v)} />
      </View>

      <View style={styles.section}>
        <Text style={p.label}>A dropped player waits</Text>
        <Chips
          options={[0, 1, 2, 3].map((d) => ({ value: d, label: d === 0 ? 'No wait' : `${d} day${d === 1 ? '' : 's'}` }))}
          value={rules.drop_days}
          onChange={(v) => set('drop_days', v)}
        />
      </View>

      <Panel>
        <SwitchRow
          first
          title="Hold players once their game starts"
          sub="They stay on waivers until the next run, so nobody grabs a player mid-game."
          value={rules.hold_played}
          onChange={(v) => set('hold_played', v)}
        />
        <SwitchRow
          title="Post results in Commish Corner"
          sub="After each run, who claimed whom (and for how much)."
          value={rules.post_results}
          onChange={(v) => set('post_results', v)}
        />
      </Panel>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <Text style={styles.saved}>{message}</Text> : null}
      <BigButton label="Save waiver rules" busyLabel="Saving…" busy={busy === 'save'} onPress={() => void save()} />
    </>
  );
}

const styles = StyleSheet.create({
  offseason: { gap: Spacing.sm, paddingTop: Spacing.sm, alignItems: 'flex-start' },
  offseasonText: { color: Colors.textSecondary, fontSize: 13 },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: 14 },
  statusTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  section: { gap: Spacing.sm },
  pair: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, gap: 4 },
  saved: { color: '#34d399', fontSize: 14 },
});
