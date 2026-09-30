import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import type { ChugFeedEntry, LeagueActivityItem } from '@/lib/types';

// Section colors not in SectionColors' nav set (frontend/src/lib/
// navDestinations.ts: activity).
const ACTIVITY_COLOR = '#64748b';
const CHUG_COLOR = '#d97706';

// "just now", "5m ago", "3h ago", "2d ago", else a date — the web's
// relativeTime (frontend/src/lib/adminFormat.ts).
export function relativeTime(iso: string): string {
  const diffSeconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSeconds < 60) return 'just now';
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ChugVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => p.play());
  return <VideoView player={player} nativeControls contentFit="contain" style={styles.video} fullscreenOptions={{ enable: true }} />;
}

// One graded chug. Tapping a chug with a video expands it and plays it
// (a short-lived signed URL from GET /chug/{id}/video), like the web's
// ChugFeed.
function ChugRow({ chug, divided }: { chug: ChugFeedEntry; divided: boolean }) {
  const [open, setOpen] = useState(false);
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

  return (
    <View style={divided && styles.divided}>
      <Pressable onPress={toggle} disabled={!chug.has_video} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <View style={styles.rowLeft}>
          {chug.has_video && <Text style={[styles.play, open && styles.playOpen]}>▶</Text>}
          <Text style={styles.nameBold}>{chug.owner_name}</Text>
          {chug.week !== null && <Text style={styles.small}>Wk {chug.week}</Text>}
          {!chug.has_video && <Text style={styles.faint}>no video</Text>}
        </View>
        <Text style={styles.value}>{chug.final_score}/10</Text>
      </Pressable>
      {chug.roast && <Text style={styles.roast}>{chug.roast}</Text>}
      {open && (
        <View style={styles.videoWrap}>
          {url ? (
            <ChugVideo url={url} />
          ) : status === 'error' ? (
            <Text style={styles.error}>Couldn&apos;t load the video — try again.</Text>
          ) : (
            <Text style={styles.small}>Loading…</Text>
          )}
        </View>
      )}
    </View>
  );
}

export function ChugFeedCard({ chugs }: { chugs: ChugFeedEntry[] }) {
  return (
    <View style={styles.section}>
      <Display style={styles.title}>Recent Chugs</Display>
      <NeonPanel color={CHUG_COLOR} radius={Radius.md} contentStyle={styles.list}>
        {chugs.map((c, i) => (
          <ChugRow key={c.id} chug={c} divided={i > 0} />
        ))}
      </NeonPanel>
    </View>
  );
}

const SOURCE_ICON = { free_agent: '➕', waiver: '🎯', commissioner: '🛠️' } as const;

function rosterSummary(item: Extract<LeagueActivityItem, { kind: 'roster' }>): string {
  if (item.added_player_name && item.dropped_player_name) {
    return `added ${item.added_player_name}, dropped ${item.dropped_player_name}`;
  }
  if (item.added_player_name) return `added ${item.added_player_name}`;
  return `dropped ${item.dropped_player_name}`;
}

export function ActivityRow({ item, divided }: { item: LeagueActivityItem; divided: boolean }) {
  return (
    <View style={[styles.activityRow, divided && styles.divided]}>
      <Text>{item.kind === 'roster' ? SOURCE_ICON[item.source] : '🔁'}</Text>
      <View style={styles.activityBody}>
        {item.kind === 'roster' ? (
          <>
            <Text style={styles.name}>
              <Text style={styles.nameBold}>{item.owner_name}</Text> <Text style={styles.soft}>{rosterSummary(item)}</Text>
            </Text>
            <Text style={styles.small}>{item.team_name}</Text>
          </>
        ) : (
          <>
            <Text style={styles.name}>
              <Text style={styles.nameBold}>{item.proposing_owner_name}</Text> <Text style={styles.soft}>traded with</Text>{' '}
              <Text style={styles.nameBold}>{item.receiving_owner_name}</Text>
            </Text>
            <Text style={styles.small}>{item.assets.map((a) => a.player_name).join(', ')}</Text>
          </>
        )}
      </View>
      <Text style={styles.time}>{relativeTime(item.timestamp)}</Text>
    </View>
  );
}

export function ActivityCard({ items }: { items: LeagueActivityItem[] }) {
  return (
    <View style={styles.section}>
      <Display style={styles.title}>League Activity</Display>
      <NeonPanel color={ACTIVITY_COLOR} radius={Radius.md} contentStyle={styles.list}>
        {items.map((item, i) => (
          <ActivityRow key={`${item.kind}-${item.timestamp}-${i}`} item={item} divided={i > 0} />
        ))}
      </NeonPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  title: { fontSize: 18, textTransform: 'none', letterSpacing: 0 },
  list: { padding: 0, backgroundColor: 'rgba(18,22,28,0.92)' },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.05)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  play: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  playOpen: { transform: [{ rotate: '90deg' }] },
  name: { color: Colors.text, fontSize: 14 },
  nameBold: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  soft: { color: 'rgba(255,255,255,0.7)' },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  faint: { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
  value: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontVariant: ['tabular-nums'] },
  roast: { color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 18, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, marginTop: -6 },
  videoWrap: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  video: { width: '100%', height: 320, borderRadius: Radius.md, backgroundColor: '#000' },
  error: { color: Colors.loss, fontSize: 12 },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  activityBody: { flex: 1, gap: 2 },
  time: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
});
