import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

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
import { queryClient, usePendingTrades, useTradeSettings, useTradeTeams } from '@/lib/queries';
import type { TradeSettings } from '@/lib/types';

// Port of the web's TradeSettingsAndReview: deadline, review
// requirement, and the trades waiting on the commissioner.
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
  const [reviewRequired, setReviewRequired] = useState(settings.review_required);
  const [panel, setPanel] = useState<SaveStatus>({ status: 'idle' });

  async function save() {
    const iso = fromLocalInput(deadline);
    if (iso === 'invalid') {
      setPanel({ status: 'error', message: 'Deadline must look like 2026-11-20 18:00 (or be blank).' });
      return;
    }
    setPanel({ status: 'saving' });
    try {
      await api.updateTradeSettings(settings.season, iso, reviewRequired);
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
        <View style={[s.row, { flexWrap: 'nowrap' }]}>
          <Switch value={reviewRequired} onValueChange={setReviewRequired} accessibilityLabel="Require commissioner review before a trade applies" trackColor={{ true: accent }} />
          <Text style={[s.bodySoft, s.flex]}>Require commissioner review before a trade applies</Text>
        </View>
        <View style={s.row}>
          <PrimaryButton label="Save trade settings" busyLabel="Saving…" busy={panel.status === 'saving'} onPress={save} />
          <StatusText panel={panel} />
        </View>
      </View>
      {reviewRequired && <PendingReview />}
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
              <View style={s.row}>
                <PrimaryButton label="Approve" busyLabel="Working…" busy={busyId === trade.id} onPress={() => respond(trade.id, true)} />
                <OutlineButton label="Veto" disabled={busyId === trade.id} onPress={() => respond(trade.id, false)} />
              </View>
            </View>
          ))}
        </ListPanel>
      )}
    </View>
  );
}
