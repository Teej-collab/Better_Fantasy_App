import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { useHouseRules } from '@/lib/queries';
import { Colors, Fonts, Radius, SectionColors, Spacing } from '@/constants/theme';

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
export function ChugCountdownCard({
  deadline,
  isPast,
  mine,
}: {
  deadline: string;
  isPast: boolean;
  // Your own balance (backend /chug/deadline's "mine"), so you can see at
  // a glance how many you owe without opening the Chug screen.
  mine?: { outstanding_owed: number; fined_owed: number; fine_amount: number } | null;
}) {
  // The league's own name for the rule (Commissioner Tools → House Rules).
  const ruleName = useHouseRules().data?.chugRuleName ?? 'Chug Rule';
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
        <Text style={styles.title}>🍺 {ruleName}</Text>
        <Text style={styles.subtitle}>Chugs due by Monday Night Football kickoff</Text>
      </View>
      {mine && (
        <View style={styles.owedRow}>
          <View style={[styles.owedPill, mine.outstanding_owed > 0 ? styles.owedPillDue : styles.owedPillClear]}>
            <Text style={[styles.owedText, mine.outstanding_owed > 0 ? styles.owedTextDue : styles.owedTextClear]}>
              {mine.outstanding_owed > 0
                ? `You owe ${mine.outstanding_owed} chug${mine.outstanding_owed === 1 ? '' : 's'}`
                : 'You’re all square 🍻'}
            </Text>
          </View>
          {mine.fined_owed > 0 && (
            <View style={[styles.owedPill, styles.finePill]}>
              <Text style={[styles.owedText, styles.fineText]}>${mine.fine_amount} fine</Text>
            </View>
          )}
        </View>
      )}
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
  owedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  owedPill: { borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  owedPillDue: { backgroundColor: 'rgba(251,191,36,0.15)' },
  owedPillClear: { backgroundColor: 'rgba(34,197,94,0.15)' },
  finePill: { backgroundColor: 'rgba(239,68,68,0.15)' },
  owedText: { fontSize: 14, fontWeight: '800' },
  owedTextDue: { color: '#fcd34d' },
  owedTextClear: { color: '#4ade80' },
  fineText: { color: '#f87171' },
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
  tile: { alignItems: 'center', paddingVertical: Spacing.md, paddingHorizontal: 0, backgroundColor: Colors.tileRaised },
  tileValue: { color: '#fff', fontSize: 24, fontFamily: Fonts.monoBold, fontVariant: ['tabular-nums'] },
  tileLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  reached: { backgroundColor: Colors.tileRaised, borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center' },
  reachedText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
