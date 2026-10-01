import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';

import { TabFrame } from '@/components/TabFrame';
import { PlayerViewTable, PlayerViewsPill, usePlayerView } from '@/components/players/PlayerViews';
import { Text } from '@/components/Text';
import { Card, LoadingState, MessageState, SectionTitle } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { api, WEB_BASE_URL } from '@/lib/api';
import { openPlayer, useLineupChange, useMyTeam, type LineupChange } from '@/lib/queries';
import {
  BENCH_SLOT_LABEL,
  IR_SLOT_LABEL,
  lineupOptions,
  slotDisplayLabel,
  starterSortIndex,
  type LineupOption,
} from '@/lib/rosterSlots';
import { formatGameTime, formatPoints } from '@/lib/format';
import type { MyTeam, RosterEntry } from '@/lib/types';

function TeamScreenContent() {
  const team = useMyTeam();
  const [editing, setEditing] = useState<RosterEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = usePlayerView('wl:player-view:roster');

  async function onRefresh() {
    setRefreshing(true);
    await team.refetch();
    setRefreshing(false);
  }

  if (team.isPending) return <LoadingState />;
  if (team.isError && !team.data) return <MessageState message="Couldn't load your team." />;
  const data = team.data;
  if (!data || data.roster.length === 0) return <MessageState message="Your roster fills in after the draft." />;

  const starters = data.roster
    .filter((e) => e.lineup_slot !== BENCH_SLOT_LABEL && e.lineup_slot !== IR_SLOT_LABEL)
    .sort((a, b) => starterSortIndex(a.lineup_slot) - starterSortIndex(b.lineup_slot));
  const bench = data.roster.filter((e) => e.lineup_slot === BENCH_SLOT_LABEL);
  const ir = data.roster.filter((e) => e.lineup_slot === IR_SLOT_LABEL);
  // Only the live week's lineup can change, and only once there are
  // slot capacities to plan against.
  const editable = data.is_editable && data.roster_slots !== null;
  const starterPoints = starters.reduce((sum, e) => sum + (e.points ?? 0), 0);
  const starterProjected = starters.reduce((sum, e) => sum + (e.live_projected ?? e.points_projected ?? 0), 0);

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, styles.titleText]} numberOfLines={1}>
            {data.team_name}
          </Text>
          <InviteCoOwner />
        </View>
        <Text style={styles.subtitle}>
          {data.week !== null ? `Week ${data.week} · ` : ''}
          {formatPoints(starterPoints)} pts · Proj {formatPoints(starterProjected)}
        </Text>

        <TeamSubNav />

        <View style={styles.viewsRow}>
          <PlayerViewsPill view={view} onChange={setView} />
        </View>

        {view !== 'matchup' ? (
          <PlayerViewTable
            view={view}
            rows={[...starters, ...bench, ...ir].map((e) => ({
              id: e.player_id,
              position: e.position,
              cell: (
                <View style={styles.viewCell}>
                  <View style={styles.viewSlot}>
                    <Text style={styles.viewSlotText}>{slotDisplayLabel(e.lineup_slot)}</Text>
                  </View>
                  <Pressable onPress={() => openPlayer(e.player_id)} style={styles.player}>
                    <Text style={styles.playerName} numberOfLines={1}>
                      {e.player_name}
                    </Text>
                    <Text style={styles.detail} numberOfLines={1}>
                      {e.position === 'DEF' ? 'D/ST' : e.position} · {e.pro_team ?? '—'}
                    </Text>
                  </Pressable>
                </View>
              ),
            }))}
          />
        ) : (
          <>
            <RosterSection title="Starters" entries={starters} editable={editable} onEdit={setEditing} />
            {bench.length > 0 && <RosterSection title="Bench" entries={bench} editable={editable} onEdit={setEditing} />}
            {ir.length > 0 && <RosterSection title="Injured reserve" entries={ir} editable={editable} onEdit={setEditing} />}
          </>
        )}
      </ScrollView>

      {editing && <LineupSheet entry={editing} team={data} onClose={() => setEditing(null)} />}
    </>
  );
}

// The web's Invite Co-Owner: a link a friend opens (after signing up)
// to manage this team with you — sent from the share sheet here.
function InviteCoOwner() {
  const [busy, setBusy] = useState(false);
  async function invite() {
    setBusy(true);
    try {
      const code = await api.createCoOwnerInvite();
      const link = `${WEB_BASE_URL}/join-co-owner?code=${code}`;
      await Share.share({
        message: `Help me run my Weekend League team — open this after you sign up and you'll be able to manage it with me: ${link}`,
      });
    } catch (e) {
      Alert.alert("Couldn't generate an invite link", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Pressable onPress={invite} disabled={busy} hitSlop={6} style={({ pressed }) => [styles.invite, (pressed || busy) && styles.pressed]}>
      <Text style={styles.inviteText}>{busy ? 'Generating…' : 'Invite Co-Owner'}</Text>
    </Pressable>
  );
}

// The web's MyTeamSubNav (MY_TEAM_SUBNAV_ORDER): My Team, then Draft,
// Keepers, Free Agents and Trades.
function TeamSubNav() {
  const links = [
    { label: 'Draft', go: () => router.push('/draft') },
    { label: 'Keepers', go: () => router.push('/keepers') },
    { label: 'Free Agents', go: () => router.navigate('/players') },
    { label: 'Trades', go: () => router.push('/trades') },
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subnav}>
      <View style={[styles.subnavPill, styles.subnavActive]}>
        <Text style={styles.subnavTextActive}>My Team</Text>
      </View>
      {links.map((l) => (
        <Pressable key={l.label} onPress={() => {
            haptics.select();
            l.go();
          }} style={({ pressed }) => [styles.subnavPill, pressed && styles.pressed]}>
          <Text style={styles.subnavText}>{l.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function RosterSection(props: {
  title: string;
  entries: RosterEntry[];
  editable: boolean;
  onEdit: (entry: RosterEntry) => void;
}) {
  return (
    <>
      <SectionTitle>{props.title}</SectionTitle>
      <Card style={styles.listCard}>
        {props.entries.map((entry, i) => (
          <RosterRow key={entry.player_id} entry={entry} divided={i > 0} editable={props.editable} onEdit={props.onEdit} />
        ))}
      </Card>
    </>
  );
}

function RosterRow(props: { entry: RosterEntry; divided: boolean; editable: boolean; onEdit: (e: RosterEntry) => void }) {
  const { entry } = props;
  const canEdit = props.editable && !entry.is_locked;
  const detail = [
    `${entry.position}${entry.pro_team ? ` · ${entry.pro_team}` : ''}`,
    entry.next_opponent && (entry.game_time ? `${entry.next_opponent} ${formatGameTime(entry.game_time)}` : entry.next_opponent),
    entry.bye_week !== null && !entry.next_opponent ? `Bye Wk ${entry.bye_week}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View style={[styles.row, props.divided && styles.divided]}>
      <Pressable
        disabled={!canEdit}
        onPress={() => {
          void Haptics.selectionAsync();
          props.onEdit(entry);
        }}
        hitSlop={6}
        style={({ pressed }) => [styles.slotPill, canEdit && styles.slotPillEditable, pressed && styles.pressed]}>
        <Text style={[styles.slotText, canEdit && styles.slotTextEditable]}>{slotDisplayLabel(entry.lineup_slot)}</Text>
      </Pressable>

      <Pressable onPress={() => openPlayer(entry.player_id)} style={({ pressed }) => [styles.player, pressed && styles.pressed]}>
        <View style={styles.nameLine}>
          <Text style={styles.playerName} numberOfLines={1}>
            {entry.player_name}
          </Text>
          {entry.injury_status && <Text style={styles.injury}>{entry.injury_status}</Text>}
          {entry.is_locked && <Text style={styles.locked}>Locked</Text>}
        </View>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </Pressable>

      <View style={styles.points}>
        <Text style={styles.pointsValue}>{formatPoints(entry.points)}</Text>
        <Text style={styles.detail}>{formatPoints(entry.live_projected ?? entry.points_projected)}</Text>
      </View>
    </View>
  );
}

// Native bottom sheet listing every legal destination for `entry`.
// An empty slot is a move; an occupied one swaps the two players.
function LineupSheet({ entry, team, onClose }: { entry: RosterEntry; team: MyTeam; onClose: () => void }) {
  const change = useLineupChange();
  const options = lineupOptions(entry, team.roster, team.roster_slots ?? {});

  function pick(option: LineupOption) {
    const next: LineupChange =
      option.occupant === null
        ? { kind: 'move', player: entry, toSlot: option.slot }
        : { kind: 'swap', player: entry, other: option.occupant };
    change.mutate(next, {
      onSuccess: () => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onClose();
      },
      onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    });
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View style={styles.sheetTitleWrap}>
            <Text style={styles.sheetKicker}>Move</Text>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {entry.player_name}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        {change.isError && <Text style={styles.error}>{change.error.message}</Text>}

        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Card style={styles.listCard}>
            {options.map((option, i) => {
              const isCurrent = option.occupant?.player_id === entry.player_id;
              return (
                <Pressable
                  key={`${option.slot}-${option.occupant?.player_id ?? 'empty'}-${i}`}
                  disabled={isCurrent || change.isPending}
                  onPress={() => pick(option)}
                  style={({ pressed }) => [styles.optionRow, i > 0 && styles.divided, pressed && styles.optionPressed]}>
                  <Text style={styles.optionSlot}>{slotDisplayLabel(option.slot)}</Text>
                  <Text style={[styles.optionName, !option.occupant && styles.optionEmpty]} numberOfLines={1}>
                    {option.occupant ? option.occupant.player_name : 'Empty'}
                  </Text>
                  <Text style={styles.optionAction}>
                    {isCurrent ? 'Here now' : option.occupant ? 'Swap' : 'Move'}
                  </Text>
                </Pressable>
              );
            })}
          </Card>
          {change.isPending && <ActivityIndicator color={Colors.accent} style={styles.spinner} />}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  viewsRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  viewCell: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  viewSlot: { width: 46, borderRadius: Radius.pill, backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: 2, alignItems: 'center' },
  viewSlotText: { color: Colors.text, fontSize: 10, fontWeight: '600' },
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2 },
  title: { color: Colors.text, fontSize: 28, fontWeight: '800' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  titleText: { flex: 1 },
  invite: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, paddingHorizontal: 12, paddingVertical: 6 },
  inviteText: { color: Colors.text, fontSize: 12, fontWeight: '500' },
  subnav: { gap: Spacing.sm, marginTop: Spacing.md },
  subnavPill: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  subnavActive: { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.3)' },
  subnavText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  subnavTextActive: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  subtitle: { color: Colors.textSecondary, fontSize: 14, marginTop: Spacing.xs },
  listCard: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  slotPill: { backgroundColor: Colors.surface,
    minWidth: 48,
    minHeight: 32,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotPillEditable: { borderColor: Colors.accent },
  slotText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  slotTextEditable: { color: Colors.accent },
  pressed: { opacity: 0.6 },
  player: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  playerName: { color: Colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  injury: { color: Colors.loss, fontSize: 11, fontWeight: '700' },
  locked: { color: Colors.textSecondary, fontSize: 11 },
  detail: { color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  points: { alignItems: 'flex-end', minWidth: 48 },
  pointsValue: { color: Colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sheet: { flex: 1, backgroundColor: Colors.bg },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  sheetTitleWrap: { flex: 1 },
  sheetKicker: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  sheetTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' },
  done: { color: Colors.accent, fontSize: 16, fontWeight: '600' },
  error: { color: Colors.loss, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  sheetContent: { padding: Spacing.lg },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg },
  optionPressed: { backgroundColor: Colors.border },
  optionSlot: { width: 48, color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  optionName: { flex: 1, color: Colors.text, fontSize: 15 },
  optionEmpty: { color: Colors.textSecondary, fontStyle: 'italic' },
  optionAction: { color: Colors.accent, fontSize: 13, fontWeight: '600' },
  spinner: { marginTop: Spacing.lg },
});

export default function TeamScreen() {
  return (
    <TabFrame ticker>
      <TeamScreenContent />
    </TabFrame>
  );
}
