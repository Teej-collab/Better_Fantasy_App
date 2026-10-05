import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  CommishScreen,
  commishStyles as s,
  ErrorText,
  errorMessage,
  fromLocalInput,
  Input,
  OutlineButton,
  PrimaryButton,
  SectionHead,
  StatusText,
  toLocalInput,
  type SaveStatus,
} from '@/components/commissioner/CommishUI';
import { ListPanel } from '@/components/league/LeagueUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { Colors, Radius, withAlpha } from '@/constants/theme';
import { queryClient, usePendingTrades, useTradeSettings, useTradeTeams } from '@/lib/queries';
import type { TradeReviewMode, TradeSettings } from '@/lib/types';

const REVIEW_MODES: { value: TradeReviewMode; label: string; help: string }[] = [
  { value: 'commissioner', label: 'Commissioner review', help: 'Accepted trades wait out the review period, then process. You can veto or push one through early.' },
  { value: 'league_vote', label: 'League vote', help: 'Accepted trades wait out the review period while the other teams can vote to veto. You can still veto or approve.' },
  { value: 'approval', label: 'Commissioner approval', help: 'Accepted trades wait until you approve them.' },
  { value: 'none', label: 'No review', help: "Trades process the moment they're accepted." },
];
const REVIEW_HOURS = [0, 12, 24, 48, 72];

function hoursLabel(h: number): string {
  return h === 0 ? 'None' : h < 24 ? `${h}h` : `${h / 24} day${h === 24 ? '' : 's'}`;
}

// Port of the web's TradeSettingsAndReview: deadline, how accepted
// trades are reviewed, and the trades waiting on the commissioner.
export default function TradeSettingsScreen() {
  const q = useTradeSettings();
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Trades' }} />
      {q.isPending ? (
        <LoadingState />
      ) : !q.data ? (
        <ErrorText>{errorMessage(q.error, "Couldn't load trade settings.")}</ErrorText>
      ) : (
        <TradeSettingsForm settings={q.data} />
      )}
    </CommishScreen>
  );
}

function TradeSettingsForm({ settings }: { settings: TradeSettings }) {
  const accent = useAppearance().accent;
  const [deadline, setDeadline] = useState(toLocalInput(settings.trade_deadline));
  const [mode, setMode] = useState<TradeReviewMode>(settings.review_mode ?? (settings.review_required ? 'approval' : 'none'));
  const [hours, setHours] = useState(settings.review_hours ?? 24);
  const [votes, setVotes] = useState(settings.veto_votes_needed ? String(settings.veto_votes_needed) : '');
  const [panel, setPanel] = useState<SaveStatus>({ status: 'idle' });

  async function save() {
    const iso = fromLocalInput(deadline);
    if (iso === 'invalid') {
      setPanel({ status: 'error', message: 'Deadline must look like 2026-11-20 18:00 (or be blank).' });
      return;
    }
    setPanel({ status: 'saving' });
    try {
      const n = parseInt(votes, 10);
      await api.updateTradeSettings(settings.season, iso, { mode, hours, vetoVotesNeeded: Number.isFinite(n) && n >= 1 ? n : null });
      setPanel({ status: 'saved' });
      void queryClient.invalidateQueries({ queryKey: ['trade-settings'] });
    } catch (e) {
      setPanel({ status: 'error', message: errorMessage(e, "Couldn't save trade settings.") });
    }
  }

  return (
    <>
      <SectionHead title="Trade Settings" subtitle="Controls for how trades work in this league." />
      <View style={s.gap}>
        <View style={s.gapSm}>
          <Text style={s.bodySoft}>Trade deadline</Text>
          <View style={s.row}>
            <Input value={deadline} onChangeText={setDeadline} placeholder="2026-11-20 18:00" style={{ minWidth: 170 }} />
            {!!deadline && (
              <Pressable onPress={() => setDeadline('')}>
                <Text style={s.small}>Clear</Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={s.gapSm}>
          <Text style={s.bodySoft}>When a trade is accepted</Text>
          {REVIEW_MODES.map((m) => {
            const on = mode === m.value;
            return (
              <Pressable
                key={m.value}
                onPress={() => setMode(m.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[s.item, styles.option, { borderColor: on ? accent : 'rgba(255,255,255,0.1)' }]}>
                <Text style={[s.medium, on && { color: accent }]}>{m.label}</Text>
                <Text style={s.small}>{m.help}</Text>
              </Pressable>
            );
          })}
        </View>
        {(mode === 'commissioner' || mode === 'league_vote') && (
          <View style={s.gapSm}>
            <Text style={s.bodySoft}>Review period</Text>
            <View style={s.row}>
              {REVIEW_HOURS.map((h) => {
                const on = hours === h;
                return (
                  <Pressable
                    key={h}
                    onPress={() => setHours(h)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.chip, on && { backgroundColor: accent, borderColor: accent }]}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{hoursLabel(h)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {mode === 'league_vote' && (
          <View style={s.gapSm}>
            <Text style={s.bodySoft}>Veto votes needed</Text>
            <Input
              value={votes}
              onChangeText={setVotes}
              numeric
              placeholder={`${settings.effective_veto_votes_needed} (a third of the league)`}
              style={{ minWidth: 170 }}
            />
          </View>
        )}
        <View style={s.row}>
          <PrimaryButton label="Save trade settings" busyLabel="Saving…" busy={panel.status === 'saving'} onPress={save} />
          <StatusText panel={panel} />
        </View>
      </View>
      {mode !== 'none' && <PendingReview />}
    </>
  );
}

function PendingReview() {
  const accent = useAppearance().accent;
  const pending = usePendingTrades();
  const teamNames = new Map((useTradeTeams().data ?? []).map((t) => [t.team_id, t.team_name]));
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (id: number) => teamNames.get(id) ?? `Team ${id}`;

  async function respond(tradeId: number, approve: boolean) {
    setBusyId(tradeId);
    setError(null);
    try {
      await api.reviewTrade(tradeId, approve);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pending-trades'] }),
        queryClient.invalidateQueries({ queryKey: ['my-trades'] }),
      ]);
    } catch (e) {
      setError(errorMessage(e, 'That action failed.'));
    } finally {
      setBusyId(null);
    }
  }

  const trades = pending.data ?? [];
  return (
    <View style={[s.gapSm, s.separator]}>
      <Text style={[s.medium, { fontWeight: '600' }]}>Pending review</Text>
      {error && <ErrorText>{error}</ErrorText>}
      {trades.length === 0 ? (
        <Text style={s.muted}>No trades awaiting review.</Text>
      ) : (
        <ListPanel color={accent}>
          {trades.map((trade, i) => (
            <View key={trade.id} style={[s.item, i > 0 && s.divided]}>
              <Text style={s.bodySoft}>
                <Text style={s.bold}>{name(trade.proposing_team_id)}</Text> gives{' '}
                {trade.assets.filter((a) => a.from_team_id === trade.proposing_team_id).map((a) => a.player_name).join(', ')} to{' '}
                <Text style={s.bold}>{name(trade.receiving_team_id)}</Text> for{' '}
                {trade.assets.filter((a) => a.from_team_id === trade.receiving_team_id).map((a) => a.player_name).join(', ')}
              </Text>
              {trade.status === 'in_review' && trade.review_ends_at && (
                <Text style={s.small}>
                  Processes{' '}
                  {new Date(trade.review_ends_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}{' '}
                  unless vetoed
                  {(trade.veto_votes ?? 0) > 0 ? ` · ${trade.veto_votes} veto vote${trade.veto_votes === 1 ? '' : 's'}` : ''}
                </Text>
              )}
              <View style={s.row}>
                <PrimaryButton
                  label={trade.status === 'in_review' ? 'Process now' : 'Approve'}
                  busyLabel="Working…"
                  busy={busyId === trade.id}
                  onPress={() => respond(trade.id, true)}
                />
                <OutlineButton label="Veto" disabled={busyId === trade.id} onPress={() => respond(trade.id, false)} />
              </View>
            </View>
          ))}
        </ListPanel>
      )}
    </View>
  );
}

// Filled backgrounds so the text reads over the honeycomb behind the screen.
const styles = StyleSheet.create({
  option: { backgroundColor: withAlpha(Colors.surface, 0.94), borderRadius: 10, borderWidth: 1 },
  chip: {
    backgroundColor: withAlpha(Colors.surface, 0.94),
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  chipText: { color: Colors.text, fontSize: 13, fontWeight: '500' },
  chipTextOn: { color: '#000', fontWeight: '700' },
});
