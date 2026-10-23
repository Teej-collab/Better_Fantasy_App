import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BigButton, GroupTitle, PageTitle, SmallButton, TONES } from '@/components/commissioner/CommishParts';
import { Text } from '@/components/Text';
import { LoadingState, TeamAvatar } from '@/components/ui';
import { DropPicker, LineupChange, THEM, ValueMeter, YOU, pos } from '@/components/trades/TradeParts';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { trackTap } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import { refreshTrades, useMe, useMyTrades, useTradePartners, useTradeRoster, useTradeTeams } from '@/lib/queries';
import type { TradeRosterPlayer } from '@/lib/types';

// The trade builder (2026-10-23 overhaul, mockup 5): pick a team, tap
// players on both sides, and the fairness meter, your lineup before →
// after and a "to even it out" suggestion update as you go (backend
// POST /trades/evaluate). A 2-for-1 coming your way asks who you'd drop.
// ?team=&player= opens on a team with a player picked (a player card or
// the trade block); ?counter=<id> answers an offer made to you.

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export default function TradeBuilderScreen() {
  const params = useLocalSearchParams<{ team?: string; player?: string; counter?: string }>();
  const counterId = params.counter ? Number(params.counter) || null : null;
  const me = useMe().data;
  const teams = useTradeTeams();
  const myTrades = useMyTrades();
  const counterOf = counterId ? ((myTrades.data ?? []).find((t) => t.id === counterId) ?? null) : null;

  if (teams.isPending || (counterId && myTrades.isPending)) return <LoadingState />;
  const myTeam = (teams.data ?? []).find((t) => t.owner_id === me?.owner_id) ?? null;
  if (!myTeam) return <Text style={styles.empty}>You need a team in this league to trade.</Text>;

  // A counter starts from the offer: the same players, from your side.
  const start = counterOf
    ? {
        partner: counterOf.proposing_team_id,
        give: counterOf.assets.filter((a) => a.from_team_id === myTeam.team_id).map((a) => a.sleeper_player_id),
        receive: counterOf.assets.filter((a) => a.from_team_id === counterOf.proposing_team_id).map((a) => a.sleeper_player_id),
      }
    : { partner: params.team ? Number(params.team) || null : null, give: [], receive: params.player ? [params.player] : [] };

  return (
    <Builder
      key={counterOf?.id ?? 'new'}
      myTeamId={myTeam.team_id}
      teams={(teams.data ?? []).filter((t) => t.team_id !== myTeam.team_id)}
      initial={start}
      counterOf={counterOf?.id ?? null}
    />
  );
}

function Builder({
  myTeamId,
  teams,
  initial,
  counterOf,
}: {
  myTeamId: number;
  teams: { team_id: number; team_name: string }[];
  initial: { partner: number | null; give: string[]; receive: string[] };
  counterOf: number | null;
}) {
  const [partner, setPartner] = useState<number | null>(initial.partner);
  const [give, setGive] = useState<string[]>(initial.give);
  const [receive, setReceive] = useState<string[]>(initial.receive);
  const [drops, setDrops] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = useTradeRoster(myTeamId).data ?? [];
  const theirs = useTradeRoster(partner).data ?? [];
  const partnerName = teams.find((t) => t.team_id === partner)?.team_name ?? '';
  const partnerInfo = useTradePartners().data?.find((t) => t.team_id === partner) ?? null;

  const ready = partner !== null && give.length > 0 && receive.length > 0;
  const evaluation = useQuery({
    queryKey: ['trade-eval-live', partner, give, receive, drops],
    queryFn: () => api.evaluateTrade(partner!, give, receive, drops),
    enabled: partner !== null && (give.length > 0 || receive.length > 0),
    placeholderData: keepPreviousData,
  });
  const ev = evaluation.data;
  const dropsNeeded = ev?.my_drops_needed ?? 0;
  const dropsOk = drops.filter((d) => !give.includes(d)).length >= dropsNeeded;

  function choosePartner(id: number) {
    haptics.select();
    setPartner(id);
    setReceive([]);
    setDrops([]);
  }

  function pick(side: 'give' | 'receive', id: string) {
    haptics.select();
    if (side === 'give') {
      setGive((g) => toggleIn(g, id));
      setDrops((d) => d.filter((x) => x !== id));
    } else setReceive((r) => toggleIn(r, id));
  }

  function takeSuggestion() {
    const s = ev?.suggestion;
    if (!s) return;
    trackTap('trades.suggestion');
    if (s.side === 'give') setGive((g) => (g.includes(s.player.id) ? g : [...g, s.player.id]));
    else setReceive((r) => (r.includes(s.player.id) ? r : [...r, s.player.id]));
  }

  async function send() {
    if (!ready || partner === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.proposeTrade(partner, give, receive, note.trim(), { drops, counterOf });
      haptics.success();
      refreshTrades();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t send that offer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      <PageTitle title={counterOf ? 'Counter offer' : 'Build a trade'} subtitle={partner === null ? 'Who do you want to trade with?' : undefined} />

      {partner === null ? (
        <PartnerList onPick={choosePartner} />
      ) : (
        <>
          <View style={styles.partnerBar}>
            <TeamAvatar name={partnerName} logoUrl={partnerInfo?.logo_url ?? null} size={36} />
            <View style={styles.flex}>
              <Text style={styles.kicker}>Trading with</Text>
              <Text style={styles.partnerName} numberOfLines={1}>
                {partnerName}
              </Text>
            </View>
            {counterOf === null && <SmallButton label="Change" onPress={() => setPartner(null)} />}
          </View>
          <ValueMeter change={ev?.value_change ?? 0} empty={!ready || !ev} />

          <View style={styles.columns}>
            <PlayerColumn title="You give" color={YOU} players={mine} selected={give} onPick={(id) => pick('give', id)} />
            <PlayerColumn title="You get" color={THEM} players={theirs} selected={receive} onPick={(id) => pick('receive', id)} />
          </View>

          {ready && ev && <LineupChange lineup={ev.my_lineup} title="Your starting lineup after" />}

          {ready && ev?.suggestion && (
            <View style={styles.hint}>
              <Text style={styles.hintText}>
                {ev.value_change > 0
                  ? `${partnerName} is unlikely to take this. Adding ${ev.suggestion.player.name} from your side makes it close to even.`
                  : `You’re giving up more. Asking for ${ev.suggestion.player.name} too evens it out.`}
              </Text>
              <SmallButton label={`Add ${ev.suggestion.player.name}`} color={TONES.yellow} onPress={takeSuggestion} />
            </View>
          )}

          {ev && (
            <DropPicker
              needed={dropsNeeded}
              candidates={ev.drop_candidates}
              selected={drops}
              onToggle={(id) => setDrops((d) => toggleIn(d, id))}
            />
          )}

          <View style={styles.noteBox}>
            <Text style={styles.label}>Add a note (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              maxLength={280}
              placeholder="Why this works for both of you"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={styles.note}
              accessibilityLabel="Note to the other owner"
            />
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          <BigButton
            label={counterOf ? 'Send counter' : 'Send offer'}
            busyLabel="Sending…"
            busy={busy}
            disabled={!ready || !dropsOk}
            onPress={send}
          />
          {ready && !dropsOk && <Text style={styles.meta}>Pick who you’d drop first.</Text>}
        </>
      )}
    </ScrollView>
  );
}

// Every other team as a row, best trade partners for you first: their
// record, what they're thin at and deep at, and why they fit (backend
// GET /trades/partners, app/domain/trade_values.py's partners).
function PartnerList({ onPick }: { onPick: (teamId: number) => void }) {
  const partners = useTradePartners();
  if (partners.isPending) return <LoadingState />;
  const teams = partners.data ?? [];
  if (teams.length === 0) return <Text style={styles.soft}>No other teams in this league yet.</Text>;
  return (
    <View style={styles.partnerList}>
      {teams.map((t, i) => {
        const record = `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ''}`;
        const shape = [t.needs.length ? `Needs ${t.needs.join(', ')}` : null, t.deep_at.length ? `Deep at ${t.deep_at.join(', ')}` : null]
          .filter(Boolean)
          .join(' · ');
        return (
          <Pressable
            key={t.team_id}
            onPress={() => onPick(t.team_id)}
            accessibilityRole="button"
            accessibilityLabel={`${t.team_name}, ${record}${t.fit_reason ? `. ${t.fit_reason}` : ''}`}
            style={({ pressed }) => [styles.partnerRow, i > 0 && styles.partnerDivider, pressed && styles.pressedRow]}>
            <TeamAvatar name={t.team_name} logoUrl={t.logo_url} size={40} />
            <View style={styles.flex}>
              <View style={styles.partnerHead}>
                <Text style={styles.partnerName} numberOfLines={1}>
                  {t.team_name}
                </Text>
                <Text style={styles.record}>{record}</Text>
              </View>
              {shape ? <Text style={styles.partnerSub}>{shape}</Text> : <Text style={styles.partnerSub}>{t.owner_name ?? ''}</Text>}
              {t.fit_reason && <Text style={styles.fit}>{t.fit_reason}</Text>}
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PlayerColumn({
  title,
  color,
  players,
  selected,
  onPick,
}: {
  title: string;
  color: string;
  players: TradeRosterPlayer[];
  selected: string[];
  onPick: (id: string) => void;
}) {
  return (
    <View style={styles.column}>
      <GroupTitle title={title} color={color} />
      {players.map((p) => {
        const on = selected.includes(p.sleeper_player_id);
        return (
          <Pressable
            key={p.sleeper_player_id}
            onPress={() => onPick(p.sleeper_player_id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.player, on && { borderColor: color, backgroundColor: `${color}22` }]}>
            <Text style={styles.playerName} numberOfLines={1}>
              {p.player_name}
            </Text>
            <Text style={styles.playerSub} numberOfLines={1}>
              {pos(p.position)} · {(p.per_week ?? 0).toFixed(1)}/wk{p.injury_status ? ` · ${p.injury_status}` : ''}
              {p.on_block ? ' · on the block' : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  empty: { color: Colors.textSecondary, padding: Spacing.lg },
  soft: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  meta: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },
  error: { color: Colors.loss, fontSize: 14 },
  flex: { flex: 1, gap: 2 },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  partnerBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: `${THEM}55`, padding: Spacing.md },
  partnerList: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, minHeight: 64 },
  partnerDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  pressedRow: { backgroundColor: 'rgba(255,255,255,0.04)' },
  partnerHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  partnerName: { flexShrink: 1, color: Colors.text, fontSize: 15, fontWeight: '700' },
  record: { marginLeft: 'auto', color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  partnerSub: { color: Colors.textSecondary, fontSize: 12 },
  fit: { color: '#4ade80', fontSize: 12, fontWeight: '700' },
  chevron: { color: Colors.textSecondary, fontSize: 22 },
  columns: { flexDirection: 'row', gap: 10 },
  column: { flex: 1, gap: 6 },
  player: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: Colors.surface },
  playerName: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  playerSub: { color: Colors.textSecondary, fontSize: 11 },
  hint: { backgroundColor: `${TONES.yellow}14`, borderWidth: 1, borderColor: `${TONES.yellow}55`, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, alignItems: 'flex-start' },
  hintText: { color: Colors.text, fontSize: 13, lineHeight: 19 },
  noteBox: { gap: 6 },
  label: { color: Colors.textSecondary, fontSize: 13 },
  note: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', color: Colors.text, fontSize: 14, paddingHorizontal: Spacing.md, minHeight: 44 },
});
