import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ChugBreakdown } from '@/components/ChugBreakdown';
import { ANTON, Elite, EliteCard, EliteChips, EliteLabel, eliteText, EliteTitle, Hex, SATISFY } from '@/components/elite/Elite';
import { ChugVideo } from '@/components/home/FeedCards';
import { ShareableCard } from '@/components/ShareableCard';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api, uploadChugVideo } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient, useChugDeadline, useChugFeed, useChugLeaderboard, useChugLedger, useChugSeasons, useMe } from '@/lib/queries';
import type { ChugFeedEntry, ChugLeaderboardRow, ChugUploadResult, ChugLedgerEvent } from '@/lib/types';

// Port of the web's /chug page (frontend/src/app/(app)/chug/page.tsx):
// submit a chug, the rule, recent chugs, and the leaderboard, per
// season or all-time. Elite pass (2026-10-31): the Chug Board — what you
// owe as a lit orange cell with the doubling countdown, The Tab with
// owed chugs as cells, and each chug's score in a hex with its quote.
export default function ChugScreen() {
  const me = useMe().data;
  const seasons = useChugSeasons().data ?? [];
  const [season, setSeason] = useState<number | undefined>(undefined);
  const leaderboard = useChugLeaderboard(season);
  const feed = useChugFeed(season);
  // Each row's "Why?" history — this season's when All-Time is picked.
  const ledger = useChugLedger(season);
  const deadline = useChugDeadline(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showRule, setShowRule] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([leaderboard.refetch(), feed.refetch(), ledger.refetch(), deadline.refetch()]);
    setRefreshing(false);
  }

  const rows = leaderboard.data ?? [];
  // Chug balance tools (Paid, Correction, Remove doubling): commissioner or site admin.
  const isCommissioner = (me?.is_commissioner || me?.is_site_owner) ?? false;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Elite.green} />}>
      <Stack.Screen options={{ title: 'Chug' }} />
      <EliteTitle kicker="The" title="Chug Board" />
      {deadline.data?.mine && <YouOwe deadline={deadline.data.deadline} isPast={deadline.data.is_past} mine={deadline.data.mine} />}
      <ChugUpload creditable={isCommissioner ? rows.map((r) => ({ id: r.owner_id, name: r.owner_name })) : undefined} />

      <EliteChips
        seasons={[...seasons].sort((a, b) => b - a)}
        active={season ?? null}
        onSelect={setSeason}
        extra={{ label: 'All-Time', active: season === undefined, onPress: () => setSeason(undefined) }}
      />

      <View style={styles.section}>
        <View style={styles.spread}>
          <EliteLabel>THE TAB</EliteLabel>
          <Pressable onPress={() => setShowRule(!showRule)} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: showRule }}>
            <Text style={eliteText.link}>{showRule ? 'Hide house rules' : 'House rules'}</Text>
          </Pressable>
        </View>
        {showRule && (
          <Text style={eliteText.small}>
            The rule: any active roster spot (not bench, not IR) that scores 0 or fewer points owes its owner one chug. Not paid down by Monday Night
            Football kickoff? The remaining balance doubles — up to 3 weeks running, after which it converts to a $10/chug fine only a commissioner can
            clear.
          </Text>
        )}
        {leaderboard.isPending ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <Text style={styles.muted}>No chug data yet.</Text>
        ) : (
          <ShareableCard title={`${season ?? 'All-time'} Chug leaderboard`}>
            <EliteCard>
              {rows.map((row, i) => (
                <LeaderboardRow
                  key={row.owner_id}
                  row={row}
                  divided={i > 0}
                  isCommissioner={isCommissioner}
                  history={ledger.data?.owners[String(row.owner_id)] ?? []}
                />
              ))}
            </EliteCard>
          </ShareableCard>
        )}
      </View>

      {(feed.data?.length ?? 0) > 0 && <RecentChugs chugs={feed.data!} />}
    </ScrollView>
  );
}

// What you owe right now, as a lit cell, with a countdown to Monday
// Night kickoff when the balance doubles.
function YouOwe({ deadline, isPast, mine }: { deadline: string | null; isPast: boolean; mine: { outstanding_owed: number; fined_owed: number; fine_amount: number } }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const owes = mine.outstanding_owed > 0;
  if (!owes && mine.fined_owed === 0) {
    return (
      <EliteCard tone="green" style={styles.owe}>
        <Hex width={56} color={Elite.green} glow>
          <Text style={[styles.oweCount, { color: Elite.green, fontSize: 24 }]}>0</Text>
        </Hex>
        <View style={styles.flex}>
          <Text style={[eliteText.kickerCaps, { color: Elite.green }]}>PAID UP</Text>
          <Text style={eliteText.small}>Nothing owed right now. Keep it that way.</Text>
        </View>
      </EliteCard>
    );
  }
  const left = deadline && !isPast ? Math.max(0, new Date(deadline).getTime() - now) : null;
  const dd = left !== null ? Math.floor(left / 86_400_000) : 0;
  const hh = left !== null ? Math.floor((left % 86_400_000) / 3_600_000) : 0;
  const mm = left !== null ? Math.floor((left % 3_600_000) / 60_000) : 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <EliteCard tone="deep" style={styles.owe}>
      <Hex width={70} color={Elite.peach} fill={Elite.orange} glow>
        <Text style={styles.oweCount}>{mine.outstanding_owed}</Text>
        <Text style={styles.oweLabel}>YOU OWE</Text>
      </Hex>
      <View style={styles.flex}>
        <Text style={eliteText.kickerCaps}>{owes ? (left !== null ? 'DOUBLES AT MNF KICKOFF' : 'DUE BY MNF KICKOFF') : 'FINE OWED'}</Text>
        {owes && left !== null && (
          <Text style={styles.led} accessibilityLabel={`${dd} days ${hh} hours ${mm} minutes until it doubles`}>
            {pad(dd)} : {pad(hh)} : {pad(mm)}
          </Text>
        )}
        {mine.fined_owed > 0 && (
          <Text style={styles.fineLine}>
            ${mine.fine_amount} fine · {mine.fined_owed} chug{mine.fined_owed === 1 ? '' : 's'}
          </Text>
        )}
      </View>
    </EliteCard>
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
      // Library picks used to go up as the untouched original (a 10s 1080p60
      // clip is ~28 MB), which a weak cell signal couldn't finish sending
      // (2026-10-14: four tries at ~60-120 KB/s, all dropped). The grader
      // works at 1280px at most and reads 540p the same (IMG_6085 6.72s vs
      // 6.88s, IMG_1527 10.83 vs 10.77, IMG_9992 10.90 vs 10.77) — ~3.5 MB.
      videoExportPreset: ImagePicker.VideoExportPreset.H264_960x540,
    };
    const picked =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];

    setStatus('uploading');
    setError(null);
    setResult(null);
    try {
      const graded = await uploadChugVideo(asset.uri, creditTo?.id);
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
    <EliteCard tone="green" style={styles.upload}>
      <View style={styles.spread}>
        <Text style={styles.uploadTitle}>SUBMIT A CHUG</Text>
        {creditable && creditable.length > 0 && (
          <Pressable onPress={chooseCredit} disabled={uploading} hitSlop={6} accessibilityRole="button">
            <Text style={eliteText.small}>
              Credit to <Text style={eliteText.link}>{creditTo?.name ?? 'Me'} ▾</Text>
            </Text>
          </Pressable>
        )}
      </View>
      <View style={styles.grades}>
        <GradeTile title="TIME" caption="Can to mouth" color={Elite.green} />
        <GradeTile title="SMOOTH" caption="Glass handling" color={Elite.green} />
        <GradeTile title="HYPE" caption="Roast yourself" color={Elite.peach} />
      </View>
      <Text style={eliteText.small}>
        Record or upload a video and it&apos;s graded automatically. Hype is what you say and do, not how loud the room is: roast yourself for the
        player who put you here.
      </Text>
      <View style={styles.uploadButtons}>
        <Pressable
          disabled={uploading}
          onPress={() => pick('camera')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.recordButton, (pressed || uploading) && styles.pressed]}>
          <View style={styles.recordDot} />
          <Text style={styles.recordText}>Record</Text>
        </Pressable>
        <Pressable
          disabled={uploading}
          onPress={() => pick('library')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.chooseButton, (pressed || uploading) && styles.pressed]}>
          <Text style={styles.chooseText}>Choose video</Text>
        </Pressable>
      </View>
      {uploading && (
        <View style={styles.analyzing}>
          <View style={styles.liveDot} />
          <Text style={eliteText.small}>Analyzing your chug…</Text>
        </View>
      )}
      {status === 'error' && error && <Text style={styles.error}>{error}</Text>}
      {status === 'done' && result && !result.can_to_mouth && <Text style={eliteText.small}>{result.message}</Text>}
      {status === 'done' && result && result.can_to_mouth && (
        // The grade and the roast, for the group chat (2026-10-24).
        <ShareableCard title={`Chug graded ${result.final_score}/10`}>
          <View style={styles.grade}>
            <View style={styles.gradeTop}>
              <Hex width={58} color={Elite.green} glow>
                <Text style={styles.scoreText}>{result.final_score}</Text>
              </Hex>
              <View style={styles.flex}>
                <Text style={eliteText.name}>Graded {result.final_score}/10</Text>
                <Text style={eliteText.small}>
                  {result.duration_seconds}s · smoothness {result.smoothness_score}/10 · hype {result.hype_score}/10
                </Text>
              </View>
            </View>
            <Text style={styles.gradeNote}>
              {result.chugs_owed_before > 0
                ? `Paid down a chug — ${result.chugs_owed_after} still owed.`
                : 'Nothing owed — logged as a bonus chug for the lifetime count.'}
            </Text>
            {result.hype_detail && (
              <>
                <HypeBars detail={result.hype_detail} />
                {result.hype_detail.quote && <Text style={styles.quote}>“{result.hype_detail.quote}”</Text>}
                {result.hype_detail.verdict && <Text style={eliteText.small}>{result.hype_detail.verdict}</Text>}
              </>
            )}
            {result.roast && <Text style={eliteText.body}>{result.roast}</Text>}
          </View>
        </ShareableCard>
      )}
    </EliteCard>
  );
}

function GradeTile({ title, caption, color }: { title: string; caption: string; color: string }) {
  return (
    <View style={styles.gradeTile}>
      <Text style={[styles.gradeTileTitle, { color }]}>{title}</Text>
      <Text style={styles.gradeTileCaption}>{caption}</Text>
    </View>
  );
}

// The hype grade's parts (self-roast out of 4, comedy and the bit out of 3).
function HypeBars({ detail }: { detail: { self_roast: number; comedy: number; commitment: number } }) {
  const bars = [
    { label: 'Self-roast', value: detail.self_roast, max: 4 },
    { label: 'Comedy', value: detail.comedy, max: 3 },
    { label: 'Commitment', value: detail.commitment, max: 3 },
  ];
  return (
    <View style={styles.hypeBars}>
      {bars.map((b) => (
        <View key={b.label} style={styles.flex} accessible accessibilityLabel={`${b.label} ${b.value} of ${b.max}`}>
          <Text style={styles.hypeLabel}>
            {b.label} {b.value}/{b.max}
          </Text>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.max(0, Math.min(1, b.value / b.max)) * 100}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const PIPS_SHOWN = 8;

function LeaderboardRow(props: { row: ChugLeaderboardRow; divided: boolean; isCommissioner: boolean; history: ChugLedgerEvent[] }) {
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

  const [correcting, setCorrecting] = useState(false);

  // The web's ChugCommishActions and ChugFineButton, as one menu. Each
  // is recorded as what it was in the owner's "Why?" history.
  function commishMenu() {
    const actions: { label: string; run: () => void }[] = [];
    if (row.outstanding_owed > 0) actions.push({ label: 'Paid', run: () => run(() => api.recordChugPayment(row.owner_id)) });
    actions.push({ label: 'Correction…', run: () => setCorrecting(true) });
    for (const d of row.doubled_weeks) {
      actions.push({ label: `Remove week ${d.week} doubling`, run: () => run(() => api.waiveChugDoubling(row.owner_id, d.week)) });
    }
    if (row.fined_owed > 0) actions.push({ label: `Clear $${row.fine_amount} fine`, run: () => run(() => api.clearChugFine(row.owner_id)) });
    Alert.alert(row.owner_name, undefined, [
      ...actions.map((a) => ({ text: a.label, onPress: a.run })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  const owed = row.outstanding_owed;
  const sub = [`${row.completed}/${row.owed} done`, row.avg_grade !== null ? `avg ${row.avg_grade}` : null, `lifetime ${row.lifetime_completed}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable disabled={!props.isCommissioner} onLongPress={commishMenu} style={[styles.row, props.divided && styles.divided]}>
      <View style={styles.rowTop}>
        <View style={styles.flex}>
          <Text style={eliteText.name}>{row.owner_name}</Text>
          <Text style={eliteText.small}>{sub}</Text>
        </View>
        {owed > 0 ? (
          <View style={styles.pips} accessible accessibilityLabel={`${owed} owed right now`}>
            {Array.from({ length: Math.min(owed, PIPS_SHOWN) }, (_, i) => (
              <Hex key={i} width={12} color={Elite.orange} fill={Elite.orange} strokeWidth={1} />
            ))}
            {owed > PIPS_SHOWN && <Text style={styles.morePips}>+{owed - PIPS_SHOWN}</Text>}
          </View>
        ) : row.fined_owed === 0 ? (
          <Text style={styles.paidUp}>Paid up</Text>
        ) : null}
        {row.doubled_weeks.length > 0 && owed > 0 && (
          <View style={styles.doubled}>
            <Text style={styles.doubledText}>×2</Text>
          </View>
        )}
      </View>
      {(row.fined_owed > 0 || props.isCommissioner) && (
        <View style={styles.badges}>
          {row.fined_owed > 0 && (
            <View style={styles.fineBadge}>
              <Text style={styles.fineText}>
                ${row.fine_amount} fine ({row.fined_owed} chugs)
              </Text>
            </View>
          )}
          {props.isCommissioner && (
            <Pressable onPress={commishMenu} hitSlop={6} accessibilityRole="button">
              <Text style={eliteText.link}>Manage</Text>
            </Pressable>
          )}
        </View>
      )}
      <ChugBreakdown events={props.history} />
      {correcting && (
        <CorrectionSheet
          ownerName={row.owner_name}
          onClose={() => setCorrecting(false)}
          onSave={async (amount, note) => {
            await run(() => api.correctChugBalance(row.owner_id, amount, note));
            void queryClient.invalidateQueries({ queryKey: ['chug-ledger'] });
            setCorrecting(false);
          }}
        />
      )}
    </Pressable>
  );
}

// The newest few show; the rest wait behind "Show more", like the web's
// ChugFeed.
const CHUGS_SHOWN = 4;

function RecentChugs({ chugs }: { chugs: ChugFeedEntry[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? chugs : chugs.slice(0, CHUGS_SHOWN);
  const best = Math.max(...chugs.map((c) => c.final_score));
  return (
    <View style={styles.section}>
      <EliteLabel>RECENT CHUGS</EliteLabel>
      {shown.map((c) => (
        <ChugCard key={c.id} chug={c} lit={c.final_score === best} />
      ))}
      {chugs.length > CHUGS_SHOWN && (
        <Pressable
          onPress={() => {
            haptics.tap();
            setAll(!all);
          }}
          style={({ pressed }) => [styles.moreBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ expanded: all }}>
          <Text style={styles.moreText}>{all ? 'Show fewer' : `Show ${chugs.length - CHUGS_SHOWN} more`}</Text>
        </Pressable>
      )}
    </View>
  );
}

// One graded chug: its score in a cell, the quote, the hype grade and the
// roast. Play opens the video (a short-lived signed URL from GET
// /chug/{id}/video).
function ChugCard({ chug, lit }: { chug: ChugFeedEntry; lit: boolean }) {
  const [open, setOpen] = useState(false);
  const [readAll, setReadAll] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  async function toggle() {
    if (!chug.has_video) return;
    const next = !open;
    setOpen(next);
    if (next && !url && status !== 'loading') {
      setStatus('loading');
      try {
        setUrl((await api.chugVideoUrl(chug.id)).url);
        setStatus('idle');
      } catch {
        setStatus('error');
      }
    }
  }

  const color = lit ? Elite.green : 'rgba(245,244,236,0.4)';
  return (
    <EliteCard tone={lit ? 'green' : 'plain'} style={styles.chug}>
      <View style={styles.chugTop}>
        <Hex width={56} color={color} fill={lit ? '#0f1a12' : Elite.cell} glow={lit}>
          <Text style={[styles.scoreText, { color: lit ? Elite.green : Elite.cream }]}>{chug.final_score}</Text>
        </Hex>
        <View style={styles.flex}>
          <Text style={eliteText.name}>{chug.owner_name}</Text>
          <Text style={eliteText.small}>{[chug.week !== null ? `Week ${chug.week}` : null, chug.has_video ? null : 'no video'].filter(Boolean).join(' · ')}</Text>
        </View>
        {chug.has_video && (
          <Pressable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={`${open ? 'Hide' : 'Play'} ${chug.owner_name}'s chug`}
            style={({ pressed }) => [styles.play, lit && { borderColor: 'rgba(57,255,20,0.5)' }, pressed && styles.pressed]}>
            <Text style={[styles.playText, { color: lit ? Elite.green : Elite.cream }]}>{open ? '■' : '▶'}</Text>
          </Pressable>
        )}
      </View>
      {open && (
        <View style={styles.videoWrap}>
          {url ? (
            <ChugVideo url={url} />
          ) : status === 'error' ? (
            <Text style={styles.error}>Couldn&apos;t load the video — try again.</Text>
          ) : (
            <Text style={eliteText.small}>Loading…</Text>
          )}
        </View>
      )}
      {chug.hype_detail?.quote && <Text style={styles.quote}>“{chug.hype_detail.quote}”</Text>}
      {chug.hype_detail && <HypeBars detail={chug.hype_detail} />}
      {chug.roast && (
        <>
          <Text style={eliteText.body} numberOfLines={readAll ? undefined : 3}>
            {chug.roast}
          </Text>
          {chug.roast.length > 160 && (
            <Pressable onPress={() => setReadAll(!readAll)} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: readAll }}>
              <Text style={eliteText.link}>{readAll ? 'Show less' : 'Read the whole roast'}</Text>
            </Pressable>
          )}
        </>
      )}
    </EliteCard>
  );
}

// "Correction": add or remove chugs from someone's balance, with a note
// that shows in their history — kept apart from a real payment ("Paid").
function CorrectionSheet(props: { ownerName: string; onClose: () => void; onSave: (amount: number, note: string | null) => Promise<void> }) {
  const [amount, setAmount] = useState(1);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={props.onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>Correction · {props.ownerName}</Text>
          <Text style={styles.small}>Add or remove chugs. This shows as a Correction in their history.</Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => setAmount((a) => Math.max(-50, a - 1))} style={styles.stepButton} accessibilityRole="button" accessibilityLabel="One fewer">
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.stepValue} accessibilityLabel={`${amount} chugs`}>
              {amount > 0 ? `+${amount}` : amount}
            </Text>
            <Pressable onPress={() => setAmount((a) => Math.min(50, a + 1))} style={styles.stepButton} accessibilityRole="button" accessibilityLabel="One more">
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={200}
            placeholder="Why? (shows in their history)"
            placeholderTextColor={Colors.textSecondary}
            style={styles.noteInput}
          />
          <View style={styles.sheetButtons}>
            <Pressable onPress={props.onClose} style={styles.sheetCancel} accessibilityRole="button">
              <Text style={styles.small}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={saving || amount === 0}
              onPress={async () => {
                setSaving(true);
                await props.onSave(amount, note.trim() || null);
                setSaving(false);
              }}
              style={[styles.sheetSave, (saving || amount === 0) && styles.dimmed]}
              accessibilityRole="button">
              <Text style={styles.sheetSaveText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: Spacing.lg },
  sheet: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md },
  sheetTitle: { color: Colors.text, fontSize: 17, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.lg },
  stepButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: Colors.text, fontSize: 22, fontWeight: '600' },
  stepValue: { color: Colors.text, fontSize: 28, fontWeight: '800', minWidth: 56, textAlign: 'center' },
  noteInput: { backgroundColor: Colors.tile, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.text, fontSize: 15, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  sheetButtons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.md },
  sheetCancel: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  sheetSave: { backgroundColor: '#fbbf24', borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: 10 },
  sheetSaveText: { color: '#1a1205', fontSize: 15, fontWeight: '700' },
  dimmed: { opacity: 0.5 },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  flex: { flex: 1 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  section: { gap: Spacing.md },
  muted: { color: Elite.soft, fontSize: 14 },
  pressed: { opacity: 0.6 },
  // You owe
  owe: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  oweCount: { fontFamily: ANTON, fontSize: 30, lineHeight: 34, color: '#2a1102' },
  oweLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5, color: '#2a1102' },
  led: { fontFamily: ANTON, fontSize: 28, lineHeight: 34, letterSpacing: 2, color: Elite.peach, textShadowColor: 'rgba(255,122,26,0.8)', textShadowRadius: 10 },
  fineLine: { color: '#f87171', fontSize: 13, fontWeight: '700' },
  // Submit
  upload: { padding: 16, gap: 12 },
  uploadTitle: { fontFamily: ANTON, fontSize: 22, lineHeight: 28, color: Elite.cream },
  grades: { flexDirection: 'row', gap: 8 },
  gradeTile: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, backgroundColor: '#0f141b' },
  gradeTileTitle: { fontFamily: ANTON, fontSize: 17, lineHeight: 22 },
  gradeTileCaption: { color: Elite.soft, fontSize: 11 },
  uploadButtons: { flexDirection: 'row', gap: 10 },
  recordButton: { flex: 1.3, minHeight: 52, borderRadius: 16, backgroundColor: Elite.orange, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: Elite.orange, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  recordDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#1a0b00' },
  recordText: { color: '#1a0b00', fontSize: 16, fontWeight: '800' },
  chooseButton: { flex: 1, minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  chooseText: { color: Elite.cream, fontSize: 15, fontWeight: '700' },
  analyzing: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.live },
  error: { color: Colors.loss, fontSize: 14 },
  grade: { gap: 8, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(57,255,20,0.35)', backgroundColor: '#0f141b' },
  gradeTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gradeNote: { color: Elite.peach, fontSize: 12, fontWeight: '600' },
  // Hype
  hypeBars: { flexDirection: 'row', gap: 10 },
  hypeLabel: { color: Elite.soft, fontSize: 11, marginBottom: 4 },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(245,244,236,0.12)', overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: Elite.orange },
  quote: { fontFamily: SATISFY, fontSize: 19, lineHeight: 25, color: '#ffd0a0' },
  // The Tab
  row: { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pips: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  morePips: { color: Elite.peach, fontSize: 12, fontWeight: '800', marginLeft: 2 },
  paidUp: { color: Elite.green, fontSize: 12, fontWeight: '700' },
  doubled: { borderRadius: 6, backgroundColor: Elite.peach, paddingHorizontal: 6, paddingVertical: 2 },
  doubledText: { color: '#1a0b00', fontSize: 11, fontWeight: '800' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  fineBadge: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(239,68,68,0.15)' },
  fineText: { color: '#f87171', fontSize: 12, fontWeight: '500' },
  // Recent chugs
  chug: { padding: 16, gap: 12 },
  chugTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scoreText: { fontFamily: ANTON, fontSize: 19, lineHeight: 24, color: Elite.green },
  play: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: '#0f141b', alignItems: 'center', justifyContent: 'center' },
  playText: { fontSize: 15 },
  videoWrap: { borderRadius: 14, overflow: 'hidden' },
  moreBtn: { alignSelf: 'center', minHeight: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', justifyContent: 'center' },
  moreText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '600' },
});
