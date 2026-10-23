import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  CommishScreen,
  commishStyles as s,
  ErrorText,
  errorMessage,
  fromLocalInput,
  Input,
  PrimaryButton,
  StatusText,
  toLocalInput,
  type SaveStatus,
} from '@/components/commissioner/CommishUI';
import { BigButton, GroupTitle, partStyles as p, TONES } from '@/components/commissioner/CommishParts';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { Colors, Radius, Spacing, withAlpha } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { queryClient, refreshCommish, useCommishTrades, useTradeSettings } from '@/lib/queries';
import type { ReviewTrade, TradeReviewMode, TradeSettings } from '@/lib/types';

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

// Trades (2026-10-23 overhaul, mockup 5): the rules in one line (Edit
// opens them), then every trade waiting on the commissioner as a card:
// what each side gets, how lopsided it looks by rest-of-season
// projections, the league's veto votes and when it goes through.
// Approve, or veto with a reason both teams are told.
export default function TradeSettingsScreen() {
  const q = useTradeSettings();
  const [editing, setEditing] = useState(false);
  return (
    <CommishScreen>
      <Stack.Screen options={{ title: 'Trades' }} />
      {q.isPending ? (
        <LoadingState />
      ) : !q.data ? (
        <ErrorText>{errorMessage(q.error, "Couldn't load trade settings.")}</ErrorText>
      ) : (
        <>
          <Pressable
            onPress={() => {
              haptics.select();
              setEditing((v) => !v);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: editing }}
            style={styles.rules}>
            <View style={p.flex}>
              <Text style={p.label}>Your rules</Text>
              <Text style={styles.rulesText}>{rulesLine(q.data)}</Text>
            </View>
            <Text style={styles.edit}>{editing ? 'Done' : 'Edit'}</Text>
          </Pressable>
          {editing ? <TradeSettingsForm settings={q.data} /> : null}
          <ReviewBoard />
        </>
      )}
    </CommishScreen>
  );
}

function rulesLine(t: TradeSettings): string {
  const deadline = t.trade_deadline
    ? `Deadline ${new Date(t.trade_deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : 'No deadline';
  const mode = t.review_mode ?? (t.review_required ? 'approval' : 'none');
  const review =
    mode === 'none' ? 'Trades go through right away'
    : mode === 'approval' ? 'You approve every trade'
    : mode === 'league_vote' ? `League can veto with ${t.effective_veto_votes_needed} votes`
    : `You can veto for ${hoursLabel(t.review_hours)}`;
  return `${deadline} · ${review}`;
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
    </>
  );
}

function ReviewBoard() {
  const q = useCommishTrades();
  const trades = q.data?.trades ?? [];
  return (
    <View style={styles.board}>
      <GroupTitle title={`Waiting on you${trades.length ? ` · ${trades.length}` : ''}`} color={TONES.orange} />
      {q.isPending ? (
        <LoadingState />
      ) : trades.length === 0 ? (
        <Text style={p.sub}>No trades are waiting for review.</Text>
      ) : (
        trades.map((t) => <ReviewCard key={t.id} trade={t} votesNeeded={q.data!.settings.effective_veto_votes_needed} voting={q.data!.settings.review_mode === 'league_vote'} />)
      )}
    </View>
  );
}

function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Going through now';
  const h = Math.floor(ms / 3_600_000);
  return `Goes through in ${h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`}`;
}

function ReviewCard({ trade, votesNeeded, voting }: { trade: ReviewTrade; votesNeeded: number; voting: boolean }) {
  const [busy, setBusy] = useState<'approve' | 'veto' | null>(null);
  const [vetoing, setVetoing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [a, b] = trade.sides;
  const total = Math.max(1, (a?.ros_points ?? 0) + (b?.ros_points ?? 0));
  const share = (a?.ros_points ?? 0) / total;
  const gap = Math.abs((a?.ros_points ?? 0) - (b?.ros_points ?? 0));
  const leader = (a?.ros_points ?? 0) >= (b?.ros_points ?? 0) ? a : b;
  const verdict = gap < total * 0.1 ? 'Looks even' : gap < total * 0.3 ? `Leans ${leader?.team_name ?? 'one side'}` : 'Very lopsided';
  const verdictColor = gap < total * 0.1 ? '#4ade80' : gap < total * 0.3 ? TONES.yellow : TONES.red;

  async function respond(approve: boolean) {
    setBusy(approve ? 'approve' : 'veto');
    setError(null);
    try {
      await api.reviewTrade(trade.id, approve, approve ? undefined : reason.trim());
      haptics.success();
      await Promise.all([
        refreshCommish(),
        queryClient.invalidateQueries({ queryKey: ['pending-trades'] }),
        queryClient.invalidateQueries({ queryKey: ['my-trades'] }),
      ]);
    } catch (e) {
      haptics.error();
      setError(errorMessage(e, 'That didn’t go through.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={p.sub}>{trade.accepted_at ? `Accepted ${new Date(trade.accepted_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Waiting for your approval'}</Text>
        {trade.status === 'in_review' ? <Text style={styles.timer}>{countdown(trade.review_ends_at)}</Text> : null}
      </View>
      <View style={styles.sides}>
        {trade.sides.map((side) => (
          <View key={side.team_id} style={styles.side}>
            <Text style={styles.team} numberOfLines={1}>
              {side.team_name ?? 'Team'}
            </Text>
            <Text style={p.label}>Gets</Text>
            {side.gets.map((g) => (
              <Text key={g.sleeper_player_id} style={styles.player}>
                {g.name}{' '}
                <Text style={styles.pos}>
                  {g.position === 'DEF' ? 'D/ST' : g.position}
                  {g.pro_team ? ` · ${g.pro_team}` : ''}
                  {g.injury_status ? ` · ${g.injury_status}` : ''}
                </Text>
              </Text>
            ))}
          </View>
        ))}
      </View>
      <View style={styles.value}>
        <View style={styles.valueTop}>
          <Text style={p.sub}>Rest-of-season projection</Text>
          <Text style={[styles.verdict, { color: verdictColor }]}>{verdict}</Text>
        </View>
        <View style={styles.bar}>
          <View style={[styles.barLeft, { flex: Math.max(share, 0.02) }]} />
          <View style={[styles.barRight, { flex: Math.max(1 - share, 0.02) }]} />
        </View>
        <View style={styles.valueTop}>
          <Text style={[styles.pts, { color: TONES.blue }]}>{a ? `${a.ros_points.toFixed(1)} pts` : ''}</Text>
          <Text style={[styles.pts, { color: TONES.orange }]}>{b ? `${b.ros_points.toFixed(1)} pts` : ''}</Text>
        </View>
      </View>
      {voting ? (
        <Text style={p.sub}>
          {trade.veto_votes} veto vote{trade.veto_votes === 1 ? '' : 's'} so far · {votesNeeded} needed
        </Text>
      ) : null}
      {trade.note ? <Text style={p.sub}>“{trade.note}”</Text> : null}
      {vetoing ? (
        <View style={styles.veto}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Why? Both teams see this (optional)"
            placeholderTextColor="rgba(255,255,255,0.4)"
            multiline
            maxLength={300}
            style={[p.input, styles.reason]}
          />
          <View style={styles.buttons}>
            <View style={p.flex}>
              <BigButton label="Cancel" tone="outline" onPress={() => setVetoing(false)} />
            </View>
            <View style={p.flex}>
              <BigButton label="Veto trade" busyLabel="Vetoing…" busy={busy === 'veto'} tone="danger" onPress={() => void respond(false)} />
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.buttons}>
          <View style={p.flex}>
            <BigButton label={trade.status === 'in_review' ? 'Approve now' : 'Approve'} busyLabel="Approving…" busy={busy === 'approve'} disabled={!!busy} onPress={() => void respond(true)} />
          </View>
          <View style={p.flex}>
            <BigButton label="Veto…" tone="danger" disabled={!!busy} onPress={() => setVetoing(true)} />
          </View>
        </View>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

// Filled backgrounds so the text reads over the honeycomb behind the screen.
const styles = StyleSheet.create({
  rules: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: 14, padding: 14 },
  rulesText: { color: Colors.text, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  edit: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  board: { gap: Spacing.md },
  card: { backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 14, gap: Spacing.md },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  timer: { color: TONES.yellow, fontSize: 12, fontWeight: '700' },
  sides: { flexDirection: 'row', gap: 10 },
  side: { flex: 1, minWidth: 0, backgroundColor: Colors.tile, borderRadius: 12, padding: 10, gap: 6 },
  team: { color: Colors.text, fontSize: 13, fontWeight: '800' },
  player: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  pos: { color: Colors.textSecondary, fontSize: 11, fontWeight: '500' },
  value: { gap: 6 },
  valueTop: { flexDirection: 'row', justifyContent: 'space-between' },
  verdict: { fontSize: 12, fontWeight: '700' },
  bar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)' },
  barLeft: { backgroundColor: TONES.blue },
  barRight: { backgroundColor: TONES.orange },
  pts: { fontSize: 12, fontWeight: '700' },
  veto: { gap: Spacing.sm },
  reason: { minHeight: 64, paddingTop: 10, textAlignVertical: 'top' },
  buttons: { flexDirection: 'row', gap: Spacing.sm },
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
