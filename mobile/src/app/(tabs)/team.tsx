import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabFrame, useTabScrollRef } from '@/components/TabFrame';
import { LineupAdviceCard, LineupEditor, MoveBar, UndoBar, useDragAutoScroll } from '@/components/team/LineupEditor';
import { PlayerViewTable, PlayerViewsPill, usePlayerView } from '@/components/players/PlayerViews';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { PositionStripe } from '@/components/PositionStripe';
import { WeekStepper } from '@/components/WeekStepper';
import { Text } from '@/components/Text';
import { LoadingState, MessageState, TeamAvatar } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { trackTap } from '@/lib/analytics';
import { api, WEB_BASE_URL } from '@/lib/api';
import { undoChange, type MoveTarget } from '@/lib/lineupMoves';
import { openPlayer, useLineupChange, useMyTeam, useMyWeek, type LineupChange } from '@/lib/queries';
import { BENCH_SLOT_LABEL, IR_SLOT_LABEL, slotDisplayLabel, starterSortIndex, TAXI_SLOT_LABEL } from '@/lib/rosterSlots';
import { formatPoints } from '@/lib/format';
import type { RosterEntry } from '@/lib/types';
import { TAB_BAR_HEIGHT, useTabBarScroll } from '@/lib/tabBar';

const UNDO_MS = 10_000;

function describe(change: LineupChange): string {
  return change.kind === 'swap'
    ? `Swapped ${change.player.player_name} and ${change.other.player_name}.`
    : `Moved ${change.player.player_name} to ${slotDisplayLabel(change.toSlot)}.`;
}

function TeamScreenContent() {
  const scrollRef = useTabScrollRef<ScrollView>();
  const tabBarScroll = useTabBarScroll();
  const { ref: dragRef, onContentSizeChange, autoScroll } = useDragAutoScroll();
  // The tab's scroll-to-top ref and the drag auto-scroll's both point at the list.
  const setScrollRef = useCallback(
    (node: Animated.ScrollView | null) => {
      dragRef(node);
      scrollRef.current = node as unknown as ScrollView | null;
    },
    [dragRef, scrollRef],
  );
  // null = the live week (the editable lineup); any other week is a
  // read-only look at that week's roster and projections.
  const [week, setWeek] = useState<number | null>(null);
  const team = useMyTeam(week);
  const [moving, setMoving] = useState<RosterEntry | null>(null);
  const [dragging, setDragging] = useState(false);
  const [undo, setUndo] = useState<{ label: string; changes: LineupChange[] } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = usePlayerView('wl:player-view:roster');
  const change = useLineupChange();
  const insets = useSafeAreaInsets();
  const barBottom = Math.max(insets.bottom - 14, 12) + TAB_BAR_HEIGHT + 12;

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  // Each change applies on screen at once (lib/queries.ts's useLineupChange);
  // several run one after another so each sees the last one's result.
  async function run(changes: LineupChange[], label: string | null) {
    setMoving(null);
    setUndo(null);
    try {
      for (const c of changes) await change.mutateAsync(c);
      haptics.success();
      if (label) setUndo({ label, changes });
    } catch (e) {
      haptics.error();
      Alert.alert("Couldn't make that move", e instanceof Error ? e.message : undefined);
    }
  }
  const apply = (target: MoveTarget) => void run([target.change], describe(target.change));
  const undoLast = () => {
    if (!undo) return;
    trackTap('lineup.undo');
    void run([...undo.changes].reverse().map(undoChange), null);
  };

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
    .filter((e) => e.lineup_slot !== BENCH_SLOT_LABEL && e.lineup_slot !== IR_SLOT_LABEL && e.lineup_slot !== TAXI_SLOT_LABEL)
    .sort((a, b) => starterSortIndex(a.lineup_slot) - starterSortIndex(b.lineup_slot));
  const bench = data.roster.filter((e) => e.lineup_slot === BENCH_SLOT_LABEL);
  const ir = data.roster.filter((e) => e.lineup_slot === IR_SLOT_LABEL);
  const taxi = data.roster.filter((e) => e.lineup_slot === TAXI_SLOT_LABEL);
  // Only the live week's lineup can change, and only once there are
  // slot capacities to plan against.
  // Best ball (2026-10) sets the lineup itself.
  const editable = data.is_editable && data.roster_slots !== null && !data.lineup_auto;
  const starterPoints = starters.reduce((sum, e) => sum + (e.points ?? 0), 0);
  const starterProjected = starters.reduce((sum, e) => sum + (e.live_projected ?? e.points_projected ?? 0), 0);
  const currentWeek = data.current_week;
  const shownWeek = data.week;


  return (
    <>
      <Animated.ScrollView
        style={styles.screen}
        ref={setScrollRef}
        onContentSizeChange={onContentSizeChange}
        scrollEnabled={!dragging}
        {...tabBarScroll}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
        <View style={styles.titleRow}>
          <TeamAvatar name={data.owner_name ?? data.team_name} logoUrl={data.logo_url ?? null} size={44} />
          <Text style={[styles.title, styles.titleText]} numberOfLines={1}>
            {data.team_name}
          </Text>
          <InviteCoOwner />
        </View>
        {data.lineup_auto && <Text style={styles.subtitle}>Best ball: your best lineup is set for you every week.</Text>}
        {shownWeek !== null && (
          <View style={styles.weekRow}>
            <WeekStepper
              week={shownWeek}
              currentWeek={currentWeek}
              onChange={(next) => setWeek(next === currentWeek ? null : next)}
              loading={team.isFetching && week !== null}
            />
          </View>
        )}
        <Text style={styles.subtitle}>
          {currentWeek !== null && shownWeek !== null && shownWeek !== currentWeek
            ? `${shownWeek < currentWeek ? 'Past week' : 'Upcoming week'} · view only · `
            : ''}
          {formatPoints(starterPoints)} pts · Proj {formatPoints(starterProjected)}
        </Text>

        <TeamSubNav />

        <View style={styles.viewsRow}>
          <PlayerViewsPill view={view} onChange={setView} />
        </View>

        {view !== 'matchup' ? (
          <PlayerViewTable
            view={view}
            rows={[...starters, ...bench, ...ir, ...taxi].map((e) => ({
              id: e.player_id,
              position: e.position,
              cell: (
                <View style={styles.viewCell}>
                  <PositionStripe position={e.position} />
                  {/* Moves work from every view, not just Matchup Stats
                      (2026-10-15: stuck on Rankings, a tester couldn't move anyone). */}
                  <Pressable
                    disabled={!editable || e.is_locked}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setView('matchup');
                      setMoving(e);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${e.player_name}`}
                    style={({ pressed }) => [styles.viewSlot, editable && !e.is_locked && styles.slotPillEditable, pressed && styles.pressed]}>
                    <Text style={[styles.viewSlotText, editable && !e.is_locked && styles.slotTextEditable]}>{slotDisplayLabel(e.lineup_slot)}</Text>
                  </Pressable>
                  <PlayerHeadshot url={e.headshot_url} position={e.position} size={30} />
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
            {editable && !moving && (
              <LineupAdviceCard
                team={data}
                onApply={(advice) => void run(advice.map((a) => a.change), advice.map((a) => describe(a.change)).join(' '))}
              />
            )}
            <LineupEditor team={data} editable={editable} moving={moving} onMove={setMoving} onApply={apply} onDragChange={setDragging} autoScroll={autoScroll} />
          </>
        )}
      </Animated.ScrollView>

      {moving && !dragging && <MoveBar entry={moving} onCancel={() => setMoving(null)} bottom={barBottom} />}
      {!moving && undo && <UndoBar label={undo.label} onUndo={undoLast} bottom={barBottom} />}
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
        message: `Help me run my team on The Weekend — open this after you sign up and you'll be able to manage it with me: ${link}`,
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
// Keepers, Free Agents and Trades — plus this week's Matchup up front,
// which on the web is a nav item of its own (2026-10 navigation pass).
function TeamSubNav() {
  const matchupId = useMyWeek().data?.matchup?.matchup_id ?? null;
  const links = [
    ...(matchupId !== null
      ? [{ label: 'Matchup', go: () => router.push({ pathname: '/matchup/[id]', params: { id: String(matchupId) } }) }]
      : []),
    { label: 'Draft', go: () => router.push('/draft') },
    { label: 'Keepers', go: () => router.push('/keepers') },
    { label: 'Free Agents', go: () => router.push('/players' as Href) },
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

const styles = StyleSheet.create({
  viewsRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  viewCell: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  viewSlot: { width: 46, minHeight: 28, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  viewSlotText: { color: Colors.text, fontSize: 10, fontWeight: '600' },
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2 },
  title: { color: Colors.text, fontSize: 28, fontWeight: '800' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  titleText: { flex: 1 },
  weekRow: { marginTop: Spacing.md },
  invite: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, paddingHorizontal: 12, paddingVertical: 6 },
  inviteText: { color: Colors.text, fontSize: 12, fontWeight: '500' },
  subnav: { gap: Spacing.sm, marginTop: Spacing.md },
  subnavPill: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  subnavActive: { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.3)' },
  subnavText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  subnavTextActive: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  subtitle: { color: Colors.textSecondary, fontSize: 14, marginTop: Spacing.xs },
  slotPillEditable: { borderColor: Colors.accent },
  slotTextEditable: { color: Colors.accent },
  pressed: { opacity: 0.6 },
  player: { flex: 1, minWidth: 0, gap: 2 },
  playerName: { color: Colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  detail: { color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
});

export default function TeamScreen() {
  return (
    <TabFrame ticker>
      <TeamScreenContent />
    </TabFrame>
  );
}
