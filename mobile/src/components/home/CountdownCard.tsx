import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { Fonts, Radius, SectionColors, Spacing } from '@/constants/theme';

type Remaining = { days: number; hours: number; minutes: number; seconds: number };

function remainingUntil(targetMs: number): Remaining | null {
  const diff = targetMs - Date.now();
  if (diff <= 0) return null;
  const total = Math.floor(diff / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (n: number) => n.toString().padStart(2, '0');

// Ticks once a second; null once the target has passed.
function useRemaining(iso: string): Remaining | null {
  const targetMs = new Date(iso).getTime();
  const [remaining, setRemaining] = useState<Remaining | null>(() => remainingUntil(targetMs));
  useEffect(() => {
    const tick = () => setRemaining(remainingUntil(targetMs));
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  return remaining;
}

function Tiles({ remaining }: { remaining: Remaining | null }) {
  const tiles: [string, string][] = [
    ['Days', remaining ? pad(remaining.days) : '--'],
    ['Hours', remaining ? pad(remaining.hours) : '--'],
    ['Minutes', remaining ? pad(remaining.minutes) : '--'],
    ['Seconds', remaining ? pad(remaining.seconds) : '--'],
  ];
  return (
    <View style={styles.tiles}>
      {tiles.map(([label, value]) => (
        <NeonPanel key={label} radius={Radius.md} style={styles.tileOuter} contentStyle={styles.tile}>
          <Text style={styles.tileValue}>{value}</Text>
          <Text style={styles.tileLabel}>{label}</Text>
        </NeonPanel>
      ))}
    </View>
  );
}

// Port of the web's ChugCountdownCard: Jeffrey's Rule, counting down
// to Monday Night Football kickoff, with the upload button always in
// the corner (relabeled once it's actually chug time).
export function ChugCountdownCard({ deadline, isPast }: { deadline: string; isPast: boolean }) {
  const remaining = useRemaining(deadline);
  const reached = isPast || remaining === null;
  return (
    <NeonPanel color={SectionColors.chug} contentStyle={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.kicker}>Chug Countdown</Text>
        <Pressable onPress={() => router.push('/chug')} style={({ pressed }) => [styles.chugButton, pressed && styles.pressed]}>
          <Text style={styles.chugButtonText}>{reached ? 'Chug Time! 🍺' : 'Upload 🍺'}</Text>
        </Pressable>
      </View>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>🍺 Jeffrey&apos;s Rule</Text>
        <Text style={styles.subtitle}>Chugs due by Monday Night Football kickoff</Text>
      </View>
      {!reached && <Tiles remaining={remaining} />}
    </NeonPanel>
  );
}

function formatScheduledStart(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

// Port of the web's DraftCountdownCard, which takes the same top slot
// before the draft. Tapping it opens the draft room.
export function DraftCountdownCard({ teamName, scheduledStart }: { teamName: string; scheduledStart: string }) {
  const remaining = useRemaining(scheduledStart);
  return (
    <Pressable onPress={() => router.push('/draft')}>
      <NeonPanel color={SectionColors.draft} contentStyle={styles.card}>
        <Text style={styles.kicker}>Draft Countdown</Text>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{teamName}</Text>
          <Text style={styles.subtitle}>Snake Draft · {formatScheduledStart(scheduledStart)}</Text>
        </View>
        {remaining === null ? (
          <View style={styles.reached}>
            <Text style={styles.reachedText}>Draft time! 🏈</Text>
          </View>
        ) : (
          <Tiles remaining={remaining} />
        )}
      </NeonPanel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md, backgroundColor: '#0a0a0a' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  chugButton: { backgroundColor: '#fbbf24', borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  chugButtonText: { color: '#000', fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  titleBlock: { gap: 2 },
  title: { color: '#fff', fontSize: 16, fontWeight: '500' },
  subtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  tiles: { flexDirection: 'row', gap: Spacing.sm },
  tileOuter: { flex: 1 },
  tile: { alignItems: 'center', paddingVertical: Spacing.md, paddingHorizontal: 0, backgroundColor: 'rgba(255,255,255,0.05)' },
  tileValue: { color: '#fff', fontSize: 24, fontFamily: Fonts.monoBold, fontVariant: ['tabular-nums'] },
  tileLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  reached: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center' },
  reachedText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
