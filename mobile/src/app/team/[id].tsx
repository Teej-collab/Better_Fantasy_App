import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { openOwner } from '@/components/league/LeagueUI';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { PositionStripe } from '@/components/PositionStripe';
import { Text } from '@/components/Text';
import { Card, LoadingState, MessageState, SectionTitle, TeamAvatar } from '@/components/ui';
import { WeekStepper } from '@/components/WeekStepper';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatGameTime, formatPoints } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { openPlayer, useMe, useSeasonWeek, useTeamDetail, useTeamRoster } from '@/lib/queries';
import { slotDisplayLabel } from '@/lib/rosterSlots';
import type { RosterPlayer, TeamDetail } from '@/lib/types';

const RESERVE_SLOTS = ['BE', 'IR', 'TAXI'];

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${tail}`;
}

function recordLine(t: TeamDetail): string | null {
  if (t.wins === undefined || t.losses === undefined) return null;
  const record = `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`;
  return t.rank ? `${record} · ${ordinal(t.rank)}${t.team_count ? ` of ${t.team_count}` : ''}` : record;
}

// Any team's roster for any week, like ESPN's team sheet (2026-10): the
// team's logo, owner and record up top, a week stepper, a trade button,
// then starters and bench with headshots, opponents and projections.
// Opened by tapping a team on the matchup screen, standings or teams list.
export default function TeamScreen() {
  const params = useLocalSearchParams<{ id: string; week?: string }>();
  const teamId = Number(params.id);
  const team = useTeamDetail(teamId);
  const me = useMe().data;
  const currentWeek = useSeasonWeek().data?.week ?? null;
  const [week, setWeek] = useState<number | null>(params.week ? Number(params.week) : null);
  const shown = week ?? currentWeek;
  const roster = useTeamRoster(teamId, shown);

  if (team.isPending) return <LoadingState />;
  if (!team.data) return <MessageState message="Team not found." />;
  const t = team.data;
  const isMine = me?.owner_id != null && me.owner_id === t.owner_id;
  const players = roster.data ?? [];
  const starters = players.filter((p) => !RESERVE_SLOTS.includes(p.lineup_slot ?? ''));
  const bench = players.filter((p) => RESERVE_SLOTS.includes(p.lineup_slot ?? ''));
  const scored = starters.reduce((sum, p) => sum + (p.points_scored ?? 0), 0);
  const projected = starters.reduce((sum, p) => sum + (p.points_projected !== null ? Number(p.points_projected) : 0), 0);
  const record = recordLine(t);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: t.team_name }} />

      <View style={styles.header}>
        <TeamAvatar name={t.owner_name ?? t.team_name} logoUrl={t.logo_url ?? null} size={56} />
        <View style={styles.headerText}>
          <Text style={styles.teamName} numberOfLines={2}>
            {t.team_name}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            <Text style={styles.ownerLink} onPress={() => openOwner(t.owner_id, t.season)}>
              {t.owner_name}
            </Text>
            {record ? ` · ${record}` : ''}
          </Text>
        </View>
      </View>

      {shown !== null && (
        <WeekStepper week={shown} currentWeek={currentWeek} onChange={setWeek} loading={roster.isFetching && roster.data !== undefined} />
      )}

      <View style={styles.actions}>
        {isMine ? (
          <ActionButton label="Edit lineup in My Team" onPress={() => router.navigate('/team')} />
        ) : (
          <ActionButton label="Propose Trade" onPress={() => router.push(`/trade-builder?team=${t.team_id}` as Href)} />
        )}
        <ActionButton label="Owner profile" secondary onPress={() => openOwner(t.owner_id, t.season)} />
      </View>

      {roster.isPending ? (
        <LoadingState />
      ) : players.length === 0 ? (
        <Text style={styles.muted}>No roster for week {shown}.</Text>
      ) : (
        <>
          <Text style={styles.totals}>
            {formatPoints(scored)} pts · Proj {formatPoints(projected)}
          </Text>
          <RosterList title="Starters" players={starters} />
          <RosterList title="Bench" players={bench} />
        </>
      )}
    </ScrollView>
  );
}

function ActionButton({ label, onPress, secondary }: { label: string; onPress: () => void; secondary?: boolean }) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, secondary ? styles.actionSecondary : styles.actionPrimary, pressed && styles.pressed]}>
      <Text style={[styles.actionText, !secondary && styles.actionTextPrimary]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function RosterList({ title, players }: { title: string; players: RosterPlayer[] }) {
  if (players.length === 0) return null;
  return (
    <View>
      <View style={styles.listHead}>
        <SectionTitle>{title}</SectionTitle>
        <View style={styles.cols}>
          <Text style={styles.colHead}>Proj</Text>
          <Text style={styles.colHead}>Score</Text>
        </View>
      </View>
      <Card style={styles.listCard}>
        {players.map((p, i) => (
          <PlayerRow key={`${p.player_id ?? p.player_name}-${i}`} player={p} divided={i > 0} />
        ))}
      </Card>
    </View>
  );
}

function PlayerRow({ player: p, divided }: { player: RosterPlayer; divided: boolean }) {
  const position = p.position ?? '';
  const detail = [
    `${position === 'DEF' ? 'D/ST' : position}${p.pro_team ? ` · ${p.pro_team}` : ''}`,
    p.on_bye ? 'Bye week' : p.next_opponent && (p.game_time ? `${p.next_opponent} ${formatGameTime(p.game_time)}` : p.next_opponent),
  ]
    .filter(Boolean)
    .join('  ·  ');
  return (
    <Pressable
      onPress={() => p.player_id !== null && openPlayer(p.player_id)}
      style={({ pressed }) => [styles.row, divided && styles.divided, pressed && styles.pressed]}>
      <PositionStripe position={position} />
      <Text style={styles.slot}>{slotDisplayLabel(p.lineup_slot ?? '')}</Text>
      <PlayerHeadshot url={p.headshot_url} position={position} size={36} />
      <View style={styles.player}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {p.player_name}
            {p.is_boom ? ' 🔥' : ''}
            {p.is_bust ? ' 🥶' : ''}
          </Text>
          {p.injury_status && <Text style={styles.injury}>{p.injury_status}</Text>}
        </View>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Text style={styles.proj} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.15}>
        {p.on_bye && p.points_scored === null ? 'Bye' : p.points_projected !== null ? Number(p.points_projected).toFixed(1) : '—'}
      </Text>
      <Text style={styles.score} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.15}>{p.points_scored !== null ? Number(p.points_scored).toFixed(1) : '—'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerText: { flex: 1, gap: 2 },
  teamName: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  muted: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  ownerLink: { color: Colors.text, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, minHeight: 38, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md },
  actionPrimary: { backgroundColor: Colors.accent },
  actionSecondary: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  actionText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  actionTextPrimary: { color: Colors.bg },
  pressed: { opacity: 0.7 },
  totals: { color: Colors.textSecondary, fontSize: 14 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cols: { flexDirection: 'row', paddingRight: Spacing.md },
  colHead: { width: 48, textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },
  listCard: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  slot: { width: 36, color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },
  player: { flex: 1, minWidth: 0, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: Colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  injury: { color: Colors.loss, fontSize: 11, fontWeight: '700' },
  detail: { color: Colors.textSecondary, fontSize: 12 },
  proj: { width: 48, textAlign: 'right', color: 'rgba(255,255,255,0.55)', fontSize: 14, fontVariant: ['tabular-nums'] },
  score: { width: 48, textAlign: 'right', color: Colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
