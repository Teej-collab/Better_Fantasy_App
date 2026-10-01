import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ChugFeedCard } from '@/components/home/FeedCards';
import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Radius, SectionColors, Spacing, withAlpha } from '@/constants/theme';
import { api, uploadChugVideo } from '@/lib/api';
import { queryClient, useChugFeed, useChugLeaderboard, useChugSeasons, useMe } from '@/lib/queries';
import type { ChugLeaderboardRow, ChugUploadResult } from '@/lib/types';

// Port of the web's /chug page (frontend/src/app/(app)/chug/page.tsx):
// submit a chug, the rule, recent chugs, and the leaderboard, per
// season or all-time.
export default function ChugScreen() {
  const me = useMe().data;
  const seasons = useChugSeasons().data ?? [];
  const [season, setSeason] = useState<number | undefined>(undefined);
  const leaderboard = useChugLeaderboard(season);
  const feed = useChugFeed(season);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([leaderboard.refetch(), feed.refetch()]);
    setRefreshing(false);
  }

  const rows = leaderboard.data ?? [];
  const isCommissioner = me?.is_commissioner ?? false;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
      <Stack.Screen options={{ title: 'Chug' }} />
      <ChugUpload creditable={isCommissioner ? rows.map((r) => ({ id: r.owner_id, name: r.owner_name })) : undefined} />

      <View style={styles.titleRow}>
        <Display style={styles.title}>🍺 Chug Leaderboard</Display>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {[...seasons].sort((a, b) => b - a).map((s) => (
          <Tab key={s} label={String(s)} active={season === s} onPress={() => setSeason(s)} />
        ))}
        <Tab label="All-Time" active={season === undefined} onPress={() => setSeason(undefined)} />
      </ScrollView>

      <Text style={styles.rule}>
        The rule: any active roster spot (not bench, not IR) that scores 0 or fewer points owes its owner one chug. Not
        paid down by Monday Night Football kickoff? The remaining balance doubles — up to 3 weeks running, after which it
        converts to a $10/chug fine only a commissioner can clear.
      </Text>

      {(feed.data?.length ?? 0) > 0 && <ChugFeedCard chugs={feed.data!} />}

      <View style={styles.section}>
        <Display style={styles.sectionTitle}>Leaderboard</Display>
        {leaderboard.isPending ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <Text style={styles.muted}>No chug data yet.</Text>
        ) : (
          <NeonPanel color={SectionColors.chug} radius={Radius.md} contentStyle={styles.list}>
            {rows.map((row, i) => (
              <LeaderboardRow key={row.owner_id} row={row} rank={i + 1} divided={i > 0} isCommissioner={isCommissioner} />
            ))}
          </NeonPanel>
        )}
      </View>
    </ScrollView>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

// "Submit a Chug": record one now or pick a video, then show the grade.
// Commissioners can credit it to someone else.
function ChugUpload({ creditable }: { creditable?: { id: number; name: string }[] }) {
  const [creditTo, setCreditTo] = useState<{ id: number; name: string } | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<ChugUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(source: 'camera' | 'library') {
    if (source === 'camera') {
      const camera = await ImagePicker.requestCameraPermissionsAsync();
      if (!camera.granted) return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['videos'],
      // Phone video is huge; medium quality keeps uploads reasonable
      // while leaving the grader plenty to work with.
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    };
    const picked =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];

    setStatus('uploading');
    setError(null);
    setResult(null);
    try {
      const graded = await uploadChugVideo(asset.uri, asset.mimeType ?? 'video/quicktime', creditTo?.id);
      setResult(graded);
      setStatus('done');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ['chug-leaderboard'] });
      void queryClient.invalidateQueries({ queryKey: ['chug-feed'] });
      void queryClient.invalidateQueries({ queryKey: ['chug-deadline'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setStatus('error');
    }
  }

  function chooseCredit() {
    if (!creditable) return;
    const names = ['Me', ...creditable.map((c) => c.name)];
    const apply = (index: number) => setCreditTo(index === 0 ? null : creditable[index - 1]);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: [...names, 'Cancel'], cancelButtonIndex: names.length }, (i) => {
        if (i < names.length) apply(i);
      });
    } else {
      Alert.alert('Credit to', undefined, names.map((n, i) => ({ text: n, onPress: () => apply(i) })));
    }
  }

  const uploading = status === 'uploading';
  return (
    <NeonPanel color={SectionColors.chug} contentStyle={styles.upload}>
      <Text style={styles.kicker}>Submit a Chug</Text>
      <Text style={styles.soft}>Record or upload a video and it&apos;ll be graded automatically — time, smoothness, and hype.</Text>
      {creditable && creditable.length > 0 && (
        <Pressable onPress={chooseCredit} disabled={uploading} hitSlop={6}>
          <Text style={styles.soft}>
            Credit to <Text style={styles.link}>{creditTo?.name ?? 'Me'} ▾</Text>
          </Text>
        </Pressable>
      )}
      <View style={styles.uploadButtons}>
        <Pressable disabled={uploading} onPress={() => pick('camera')} style={({ pressed }) => [styles.uploadButton, (pressed || uploading) && styles.pressed]}>
          <Text style={styles.uploadButtonText}>Record</Text>
        </Pressable>
        <Pressable disabled={uploading} onPress={() => pick('library')} style={({ pressed }) => [styles.uploadButton, styles.uploadSecondary, (pressed || uploading) && styles.pressed]}>
          <Text style={styles.uploadButtonText}>Choose video</Text>
        </Pressable>
      </View>
      {uploading && (
        <View style={styles.analyzing}>
          <View style={styles.liveDot} />
          <Text style={styles.soft}>Analyzing your chug…</Text>
        </View>
      )}
      {status === 'error' && error && <Text style={styles.error}>{error}</Text>}
      {status === 'done' && result && !result.can_to_mouth && <Text style={styles.soft}>{result.message}</Text>}
      {status === 'done' && result && result.can_to_mouth && (
        <View style={styles.grade}>
          <Text style={styles.gradeTitle}>🍺 Grade: {result.final_score}/10</Text>
          <Text style={styles.small}>
            {result.duration_seconds}s · smoothness {result.smoothness_score}/10 · hype {result.hype_score}/10
          </Text>
          <Text style={styles.gradeNote}>
            {result.chugs_owed_before > 0
              ? `Paid down a chug — ${result.chugs_owed_after} still owed.`
              : 'Nothing owed — logged as a bonus chug for the lifetime count.'}
          </Text>
          {result.roast && <Text style={styles.roast}>{result.roast}</Text>}
        </View>
      )}
    </NeonPanel>
  );
}

function LeaderboardRow(props: { row: ChugLeaderboardRow; rank: number; divided: boolean; isCommissioner: boolean }) {
  const { row } = props;

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ['chug-leaderboard'] });
    } catch (e) {
      Alert.alert("Couldn't do that", e instanceof Error ? e.message : 'Try again.');
    }
  }

  // The web's ChugCommishActions and ChugFineButton, as one menu.
  function commishMenu() {
    const actions: { label: string; run: () => void }[] = [];
    if (row.outstanding_owed > 0) actions.push({ label: 'Record a paid chug', run: () => run(() => api.recordChugPayment(row.owner_id)) });
    if (row.fined_owed > 0) actions.push({ label: `Clear $${row.fine_amount} fine`, run: () => run(() => api.clearChugFine(row.owner_id)) });
    for (const d of row.doubled_weeks) {
      actions.push({ label: `Waive week ${d.week} doubling`, run: () => run(() => api.waiveChugDoubling(row.owner_id, d.week)) });
    }
    if (actions.length === 0) return;
    Alert.alert(row.owner_name, undefined, [
      ...actions.map((a) => ({ text: a.label, onPress: a.run })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  return (
    <Pressable
      disabled={!props.isCommissioner}
      onLongPress={commishMenu}
      style={[styles.row, props.divided && styles.divided]}>
      <View style={styles.rowTop}>
        <View style={styles.rowLeft}>
          <Text style={styles.rank}>{props.rank}</Text>
          <Text style={styles.name}>{row.owner_name}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.value}>
            {row.completed}/{row.owed} done
          </Text>
          {row.avg_grade !== null && <Text style={styles.small}>avg {row.avg_grade}/10</Text>}
        </View>
      </View>
      <View style={styles.badges}>
        {row.outstanding_owed > 0 && (
          <View style={[styles.badge, styles.owedBadge]}>
            <Text style={styles.owedText}>{row.outstanding_owed} owed right now</Text>
          </View>
        )}
        {row.fined_owed > 0 && (
          <View style={[styles.badge, styles.fineBadge]}>
            <Text style={styles.fineText}>
              ${row.fine_amount} fine ({row.fined_owed} chugs)
            </Text>
          </View>
        )}
        <Text style={styles.small}>Lifetime: {row.lifetime_completed}</Text>
        {props.isCommissioner && (row.outstanding_owed > 0 || row.fined_owed > 0 || row.doubled_weeks.length > 0) && (
          <Pressable onPress={commishMenu} hitSlop={6}>
            <Text style={styles.link}>Manage</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 24, textTransform: 'none', letterSpacing: 0 },
  tabs: { gap: Spacing.sm },
  tab: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  tabActive: { backgroundColor: SectionColors.chug, borderColor: SectionColors.chug },
  tabText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#000' },
  rule: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  section: { gap: Spacing.sm },
  sectionTitle: { fontSize: 18, textTransform: 'none', letterSpacing: 0 },
  muted: { color: Colors.textSecondary, fontSize: 14 },
  list: { padding: 0, backgroundColor: withAlpha(Colors.surface, 0.92) },
  upload: { gap: Spacing.sm },
  kicker: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  soft: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  link: { color: Colors.accent, fontWeight: '600' },
  uploadButtons: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  uploadButton: { backgroundColor: '#d97706', borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  uploadSecondary: { backgroundColor: 'rgba(217,119,6,0.35)' },
  uploadButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  analyzing: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.live },
  error: { color: Colors.loss, fontSize: 14 },
  grade: {
    gap: 4,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    backgroundColor: 'rgba(245,158,11,0.06)',
  },
  gradeTitle: { color: Colors.text, fontSize: 18, fontWeight: '600' },
  gradeNote: { color: '#fbbf24', fontSize: 12, fontWeight: '500' },
  roast: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 19, marginTop: 4 },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  row: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: 6 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.05)' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rank: { width: 20, color: 'rgba(255,255,255,0.5)', fontSize: 14, fontVariant: ['tabular-nums'] },
  name: { color: Colors.text, fontSize: 14, fontWeight: '500', flexShrink: 1 },
  value: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontVariant: ['tabular-nums'] },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm, marginLeft: 32 },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  owedBadge: { backgroundColor: 'rgba(245,158,11,0.15)' },
  owedText: { color: '#fbbf24', fontSize: 12, fontWeight: '500' },
  fineBadge: { backgroundColor: 'rgba(239,68,68,0.15)' },
  fineText: { color: '#f87171', fontSize: 12, fontWeight: '500' },
});
